/**
 * WebSocket Hook for NFD Agents Backend
 *
 * Connects to the NFD Agents backend via WebSocket and handles message streaming.
 * Shared hook for use across Help Center, Editor Chat, and other AI chat interfaces.
 *
 * This hook is a thin orchestrator — heavy logic lives in:
 *   utils/nfdAgents/messageHandler.js  — WebSocket message protocol
 *   utils/nfdAgents/configFetcher.js   — REST config fetching
 *   utils/nfdAgents/storageUtils.js    — localStorage persistence
 *   utils/nfdAgents/urlUtils.js        — WebSocket URL construction
 */

import { useState, useEffect, useRef, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { NFD_AGENTS_WEBSOCKET } from '../constants/nfdAgents/websocket';
import { getSiteId, setSiteId, migrateStorageKeys } from '../constants/nfdAgents/storageKeys';
import { buildWebSocketUrl } from '../utils/nfdAgents/urlUtils';
import { createMessageHandler } from '../utils/nfdAgents/messageHandler';
import { fetchAgentConfig } from '../utils/nfdAgents/configFetcher';
import {
	restoreChat,
	persistMessages,
	persistConversationId,
	clearChatStorage,
	hasMeaningfulUserMessage,
} from '../utils/nfdAgents/storageUtils';
import { generateSessionId } from '../utils/helpers';

/**
 * useNfdAgentsWebSocket Hook
 *
 * Manages WebSocket connection to NFD Agents backend with automatic reconnection
 * and message handling.
 *
 * @param {Object} options Hook options
 * @param {string} options.configEndpoint REST API endpoint for fetching config
 * @param {string} [options.storageNamespace] Client-only: used for localStorage keys
 *   `nfd-ai-chat-${storageNamespace}-history` and `-conversation-id`. Not sent to backend.
 *   Optional; defaults to 'default' when omitted.
 * @param {boolean} [options.autoConnect=false] Whether to connect automatically
 * @param {string} [options.consumerType] Consumer type ('help_center' or 'editor_chat').
 *   Used to construct consumer parameter: `wordpress_${consumerType}`. Defaults to 'editor_chat'.
 * @param {boolean} [options.autoLoadHistory=true] Whether to auto-load chat history from localStorage on mount.
 *   Set to false to start with empty chat but keep history in storage for later access.
 * @param {Function} [options.getConnectionFailedFallbackMessage] Optional. When connection has failed (e.g. after max
 *   retries) and the user sends a message, the hook will add an assistant message with the returned string.
 *   Called as getConnectionFailedFallbackMessage(userMessage). Use for exact copy (e.g. NoResults-style) with i18n.
 * @return {Object} Hook return value with connection state and methods
 */
const useNfdAgentsWebSocket = ({ configEndpoint, storageNamespace = 'default', autoConnect = false, consumerType = 'editor_chat', autoLoadHistory = true, getConnectionFailedFallbackMessage } = {}) => {
	// ---------------------------------------------------------------------------
	// Storage keys (site-scoped)
	// ---------------------------------------------------------------------------
	const siteId = getSiteId();
	const keyPrefix = siteId
		? `nfd-ai-chat-${siteId}-${storageNamespace}`
		: `nfd-ai-chat-${storageNamespace}`;
	const STORAGE_KEY = `${keyPrefix}-history`;
	const CONVERSATION_STORAGE_KEY = `${keyPrefix}-conversation-id`;
	const SESSION_STORAGE_KEY = `${keyPrefix}-session-id`;

	// ---------------------------------------------------------------------------
	// State (lazy-init from localStorage)
	// ---------------------------------------------------------------------------
	const [messages, setMessages] = useState(() => {
		if (!autoLoadHistory) return [];
		return restoreChat(STORAGE_KEY, CONVERSATION_STORAGE_KEY, SESSION_STORAGE_KEY).messages;
	});
	const [conversationId, setConversationId] = useState(() => {
		if (!autoLoadHistory) return null;
		return restoreChat(STORAGE_KEY, CONVERSATION_STORAGE_KEY, SESSION_STORAGE_KEY).conversationId;
	});

	const [isConnected, setIsConnected] = useState(false);
	const [isConnecting, setIsConnecting] = useState(false);
	const [error, setError] = useState(null);
	const [isTyping, setIsTyping] = useState(false);
	const [status, setStatus] = useState(null);
	const [currentResponse, setCurrentResponse] = useState('');
	const [approvalRequest, setApprovalRequest] = useState(null);
	const [connectionState, setConnectionState] = useState(() => {
		try {
			if (sessionStorage.getItem(`${keyPrefix}-connection-failed`) === '1') {
				return 'failed';
			}
		} catch (e) {
			// ignore
		}
		return 'disconnected';
	});
	const [retryAttempt, setRetryAttempt] = useState(0);

	// ---------------------------------------------------------------------------
	// Refs
	// ---------------------------------------------------------------------------
	const wsRef = useRef(null);
	const reconnectTimeoutRef = useRef(null);
	const reconnectAttempts = useRef(0);
	const configRef = useRef(null);
	const previousAutoConnectRef = useRef(null);
	const connectingRef = useRef(false);
	const sessionIdRef = useRef(() => {
		if (autoLoadHistory) {
			return restoreChat(STORAGE_KEY, CONVERSATION_STORAGE_KEY, SESSION_STORAGE_KEY).sessionId;
		}
		return null;
	});
	// Unwrap lazy initializer for ref (refs don't support lazy init like useState)
	if (typeof sessionIdRef.current === 'function') {
		sessionIdRef.current = sessionIdRef.current();
	}
	const hasUserMessageRef = useRef(false);
	const isStoppedRef = useRef(false);
	const typingTimeoutRef = useRef(null);
	const isInitialMount = useRef(true);
	const messagesRef = useRef([]);
	const connectionStateRef = useRef(connectionState);
	const prevConnectionStateRef = useRef(connectionState);

	const MAX_RECONNECT_ATTEMPTS = NFD_AGENTS_WEBSOCKET.MAX_RECONNECT_ATTEMPTS;
	const RECONNECT_DELAY = NFD_AGENTS_WEBSOCKET.RECONNECT_DELAY;
	const TYPING_TIMEOUT = NFD_AGENTS_WEBSOCKET.TYPING_TIMEOUT;

	// ---------------------------------------------------------------------------
	// Callbacks for messageHandler deps (save to ref + localStorage)
	// ---------------------------------------------------------------------------
	const saveSessionId = useCallback((sid) => {
		sessionIdRef.current = sid;
		try {
			localStorage.setItem(SESSION_STORAGE_KEY, sid);
		} catch (err) {
			// eslint-disable-next-line no-console
			console.warn('[AI Chat] Failed to save session ID to localStorage:', err);
		}
	}, [SESSION_STORAGE_KEY]);

	const saveConversationId = useCallback((cid) => {
		try {
			localStorage.setItem(CONVERSATION_STORAGE_KEY, cid);
		} catch (err) {
			// eslint-disable-next-line no-console
			console.warn('[AI Chat] Failed to save conversation ID to localStorage:', err);
		}
	}, [CONVERSATION_STORAGE_KEY]);

	// ---------------------------------------------------------------------------
	// connect()
	// ---------------------------------------------------------------------------
	const connect = useCallback(async () => {
		if (wsRef.current?.readyState === WebSocket.OPEN) return;
		if (wsRef.current?.readyState === WebSocket.CONNECTING) return;
		if (connectingRef.current) return;

		// Clear "connection failed" flag
		try {
			sessionStorage.removeItem(`${keyPrefix}-connection-failed`);
		} catch (e) {
			// ignore
		}
		connectingRef.current = true;
		setIsConnecting(true);
		setConnectionState('connecting');
		setError(null);

		try {
			// Fetch config if not cached
			if (!configRef.current) {
				configRef.current = await fetchAgentConfig({ configEndpoint, storageNamespace });
			}

			const config = configRef.current;
			if (!config) {
				throw new Error(__('No configuration available', 'wp-module-ai-chat'));
			}

			// Cache site ID and migrate old storage keys if needed
			if (config.site_id) {
				const currentSiteId = getSiteId();
				if (currentSiteId !== config.site_id) {
					setSiteId(config.site_id);
					migrateStorageKeys(currentSiteId, config.site_id, storageNamespace);
				}
			}

			// Generate or reuse session ID
			if (!sessionIdRef.current) {
				sessionIdRef.current = generateSessionId();
			}

			// Build WebSocket URL
			const wsUrl = buildWebSocketUrl(config, sessionIdRef.current, consumerType);

			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;

			ws.onopen = () => {
				connectingRef.current = false;
				setIsConnected(true);
				setIsConnecting(false);
				setConnectionState('connected');
				setRetryAttempt(0);
				setError(null);
				reconnectAttempts.current = 0;
				hasUserMessageRef.current = (messagesRef.current && messagesRef.current.length > 0);
				isStoppedRef.current = false;
				setCurrentResponse('');
			};

			// Wire message handler
			const handleMessage = createMessageHandler({
				isStoppedRef,
				hasUserMessageRef,
				typingTimeoutRef,
				typingTimeout: TYPING_TIMEOUT,
				setIsTyping,
				setStatus,
				setCurrentResponse,
				setMessages,
				setConversationId,
				setError,
				saveSessionId,
				saveConversationId,
			});

			ws.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					handleMessage(data);
				} catch (err) {
					// eslint-disable-next-line no-console
					console.error('[AI Chat] Error parsing WebSocket message:', err);
				}
			};

			ws.onerror = () => {
				connectingRef.current = false;
				setIsConnecting(false);
				setConnectionState('failed');
				try {
					sessionStorage.setItem(`${keyPrefix}-connection-failed`, '1');
				} catch (e) {
					// ignore
				}
			};

			ws.onclose = (event) => {
				connectingRef.current = false;
				setIsConnected(false);
				setIsConnecting(false);
				setIsTyping(false);
				setStatus(null);
				if (wsRef.current === ws) {
					wsRef.current = null;
				}

				if (event.code !== 1000 && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
					reconnectAttempts.current++;
					setRetryAttempt(reconnectAttempts.current);
					setConnectionState('reconnecting');
					const delay = RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current - 1);
					reconnectTimeoutRef.current = setTimeout(() => {
						connect();
					}, delay);
				} else if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
					setConnectionState('failed');
					try {
						sessionStorage.setItem(`${keyPrefix}-connection-failed`, '1');
					} catch (e) {
						// ignore
					}
				} else {
					setConnectionState('disconnected');
				}
			};
		} catch (connectError) {
			connectingRef.current = false;
			// Log at debug level; config/token failures are expected when Hiive is unavailable or NFD_AGENTS_CHAT_DEBUG_TOKEN is not set
			if (typeof console !== 'undefined' && console.warn) {
				// eslint-disable-next-line no-console
				console.warn('[AI Chat] Connection failed:', connectError?.message || connectError);
			}
			setIsConnecting(false);
			setConnectionState('failed');
			try {
				sessionStorage.setItem(`${keyPrefix}-connection-failed`, '1');
			} catch (e) {
				// ignore
			}
		}
	}, [configEndpoint, storageNamespace, consumerType, saveSessionId, saveConversationId]);

	// ---------------------------------------------------------------------------
	// Ref sync effects
	// ---------------------------------------------------------------------------
	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	useEffect(() => {
		connectionStateRef.current = connectionState;
	}, [connectionState]);

	// ---------------------------------------------------------------------------
	// Connection-failed fallback effect
	// ---------------------------------------------------------------------------
	useEffect(() => {
		if (connectionState !== 'failed' || prevConnectionStateRef.current === 'failed') {
			prevConnectionStateRef.current = connectionState;
			return;
		}
		prevConnectionStateRef.current = connectionState;

		const defaultFallback = __(
			'Sorry, we couldn\'t connect. Please try again later or contact support.',
			'wp-module-ai-chat'
		);
		setMessages((prev) => {
			const last = prev.length > 0 ? prev[prev.length - 1] : null;
			const isLastUser = last && (last.role === 'user' || last.type === 'user');
			const fallbackContent =
				typeof getConnectionFailedFallbackMessage === 'function'
					? getConnectionFailedFallbackMessage(isLastUser ? last.content : '')
					: defaultFallback;
			return [
				...prev,
				{
					id: `msg-${Date.now()}-fallback`,
					role: 'assistant',
					type: 'assistant',
					content: fallbackContent,
					timestamp: new Date(),
				},
			];
		});
		setError(null);
		setCurrentResponse('');
		setIsTyping(false);
		setStatus(null);
		if (typingTimeoutRef.current) {
			clearTimeout(typingTimeoutRef.current);
			typingTimeoutRef.current = null;
		}
	}, [connectionState, getConnectionFailedFallbackMessage]);

	// ---------------------------------------------------------------------------
	// sendMessage
	// ---------------------------------------------------------------------------
	const sendMessage = useCallback(
		(message, convId = null) => {
			isStoppedRef.current = false;
			hasUserMessageRef.current = true;

			const isFailed =
				connectionStateRef.current === 'failed' ||
				(reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS &&
					(!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN));
			if (isFailed && !convId) {
				const userMessage = {
					id: `msg-${Date.now()}`,
					role: 'user',
					type: 'user',
					content: message,
					timestamp: new Date(),
					sessionId: sessionIdRef.current,
				};
				const fallbackContent =
					typeof getConnectionFailedFallbackMessage === 'function'
						? getConnectionFailedFallbackMessage(message)
						: __(
								'Sorry, we couldn\'t connect. Please try again later or contact support.',
								'wp-module-ai-chat'
						  );
				setMessages((prev) => [
					...prev,
					userMessage,
					{
						id: `msg-${Date.now()}-fallback`,
						role: 'assistant',
						type: 'assistant',
						content: fallbackContent,
						timestamp: new Date(),
					},
				]);
				setError(null);
				setCurrentResponse('');
				setIsTyping(false);
				setStatus(null);
				return;
			}

			if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
				if (!convId) {
					const userMessage = {
						id: `msg-${Date.now()}`,
						role: 'user',
						type: 'user',
						content: message,
						timestamp: new Date(),
						sessionId: sessionIdRef.current,
					};
					setMessages((prev) => [...prev, userMessage]);
				}
				if (connectionStateRef.current === 'disconnected') {
					connect();
				}
				return;
			}

			if (!convId) {
				const userMessage = {
					id: `msg-${Date.now()}`,
					role: 'user',
					type: 'user',
					content: message,
					timestamp: new Date(),
					sessionId: sessionIdRef.current,
				};
				setMessages((prev) => [...prev, userMessage]);
				setCurrentResponse('');
				setIsTyping(true);

				if (typingTimeoutRef.current) {
					clearTimeout(typingTimeoutRef.current);
				}
				typingTimeoutRef.current = setTimeout(() => {
					setIsTyping(false);
					setStatus(null);
					typingTimeoutRef.current = null;
				}, TYPING_TIMEOUT);
			}

			const payload = { type: 'chat', message };

			if (convId) {
				payload.conversationId = convId;
			} else if (conversationId) {
				payload.conversationId = conversationId;
			}

			wsRef.current.send(JSON.stringify(payload));
		},
		[conversationId, getConnectionFailedFallbackMessage]
	);

	// ---------------------------------------------------------------------------
	// sendSystemMessage
	// ---------------------------------------------------------------------------
	const sendSystemMessage = useCallback(
		(message) => {
			if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
				// eslint-disable-next-line no-console
				console.warn('[AI Chat] Cannot send system message - not connected');
				return;
			}

			const payload = { type: 'chat', message };

			if (conversationId) {
				payload.conversationId = conversationId;
			}

			setIsTyping(true);
			setCurrentResponse('');

			if (typingTimeoutRef.current) {
				clearTimeout(typingTimeoutRef.current);
			}
			typingTimeoutRef.current = setTimeout(() => {
				setIsTyping(false);
				setStatus(null);
				typingTimeoutRef.current = null;
			}, TYPING_TIMEOUT);

			wsRef.current.send(JSON.stringify(payload));
		},
		[conversationId, connect]
	);

	// ---------------------------------------------------------------------------
	// disconnect
	// ---------------------------------------------------------------------------
	const disconnect = useCallback(() => {
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
		}
		if (typingTimeoutRef.current) {
			clearTimeout(typingTimeoutRef.current);
			typingTimeoutRef.current = null;
		}
		if (wsRef.current) {
			wsRef.current.close(1000, 'User disconnected');
			wsRef.current = null;
		}
		setIsConnected(false);
		setIsConnecting(false);
		setConnectionState('disconnected');
	}, []);

	// ---------------------------------------------------------------------------
	// setSessionId / getSessionId
	// ---------------------------------------------------------------------------
	const setSessionId = useCallback((sid) => {
		sessionIdRef.current = sid ?? null;
	}, []);

	const getSessionId = useCallback(() => sessionIdRef.current ?? null, []);

	// ---------------------------------------------------------------------------
	// loadConversation
	// ---------------------------------------------------------------------------
	const loadConversation = useCallback((msgs, convId, sessId) => {
		if (Array.isArray(msgs)) {
			const withTimestamps = msgs.map((msg) => ({
				...msg,
				timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
				animateTyping: false,
			}));
			setMessages(withTimestamps);
		}
		setConversationId(convId ?? null);
		sessionIdRef.current = sessId ?? null;
		setError(null);
		setIsTyping(false);
		setStatus(null);
		setCurrentResponse('');

		if (sessId != null && wsRef.current?.readyState === WebSocket.OPEN) {
			try {
				localStorage.setItem(SESSION_STORAGE_KEY, sessId);
				if (convId != null) {
					localStorage.setItem(CONVERSATION_STORAGE_KEY, convId);
				}
			} catch (err) {
				// eslint-disable-next-line no-console
				console.warn('[AI Chat] Failed to persist session for history load:', err);
			}
			disconnect();
			connect();
		}
	}, [connect, disconnect, SESSION_STORAGE_KEY, CONVERSATION_STORAGE_KEY]);

	// ---------------------------------------------------------------------------
	// stopRequest
	// ---------------------------------------------------------------------------
	const stopRequest = useCallback(() => {
		isStoppedRef.current = true;
		setIsTyping(false);
		setStatus(null);
		setCurrentResponse('');
		if (typingTimeoutRef.current) {
			clearTimeout(typingTimeoutRef.current);
			typingTimeoutRef.current = null;
		}
	}, []);

	// ---------------------------------------------------------------------------
	// clearApprovalRequest / clearTyping
	// ---------------------------------------------------------------------------
	const clearApprovalRequest = useCallback(() => {
		setApprovalRequest(null);
	}, []);

	const clearTyping = useCallback(() => {
		setIsTyping(false);
		setStatus(null);
		if (typingTimeoutRef.current) {
			clearTimeout(typingTimeoutRef.current);
			typingTimeoutRef.current = null;
		}
	}, []);

	// ---------------------------------------------------------------------------
	// addAssistantMessage
	// ---------------------------------------------------------------------------
	const addAssistantMessage = useCallback((content) => {
		let contentString;
		if (content === null || content === undefined) {
			contentString = __('No content provided.', 'wp-module-ai-chat');
		} else if (typeof content === 'object') {
			try {
				contentString = JSON.stringify(content, null, 2);
			} catch (e) {
				// eslint-disable-next-line no-console
				console.warn('[useNfdAgentsWebSocket] Failed to stringify content object:', e);
				contentString = String(content);
			}
		} else {
			contentString = String(content);
		}

		setMessages((prev) => [
			...prev,
			{
				id: `msg-${Date.now()}`,
				role: 'assistant',
				type: 'assistant',
				content: contentString,
				timestamp: new Date(),
			},
		]);
		setIsTyping(false);
		setStatus(null);
		if (typingTimeoutRef.current) {
			clearTimeout(typingTimeoutRef.current);
			typingTimeoutRef.current = null;
		}
	}, []);

	// ---------------------------------------------------------------------------
	// updateMessage
	// ---------------------------------------------------------------------------
	const updateMessage = useCallback((messageIdOrPredicate, updater) => {
		setMessages((prev) =>
			prev.map((msg) => {
				const shouldUpdate = typeof messageIdOrPredicate === 'function'
					? messageIdOrPredicate(msg)
					: msg.id === messageIdOrPredicate;
				return shouldUpdate ? updater(msg) : msg;
			})
		);
	}, []);

	// ---------------------------------------------------------------------------
	// clearChatHistory
	// ---------------------------------------------------------------------------
	const clearChatHistory = useCallback(() => {
		try {
			clearChatStorage(STORAGE_KEY, CONVERSATION_STORAGE_KEY, SESSION_STORAGE_KEY);

			setMessages([]);
			setConversationId(null);
			setApprovalRequest(null);
			setIsTyping(false);
			setStatus(null);
			setCurrentResponse('');
			setError(null);

			sessionIdRef.current = null;

			if (wsRef.current) {
				wsRef.current.close();
				wsRef.current = null;
				setIsConnected(false);
			}

			hasUserMessageRef.current = false;
			isStoppedRef.current = false;

			if (typingTimeoutRef.current) {
				clearTimeout(typingTimeoutRef.current);
				typingTimeoutRef.current = null;
			}
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
				reconnectTimeoutRef.current = null;
			}

			reconnectAttempts.current = 0;
		} catch (err) {
			// eslint-disable-next-line no-console
			console.warn('[AI Chat] Failed to clear chat history:', err);
		}
	}, [STORAGE_KEY, CONVERSATION_STORAGE_KEY, SESSION_STORAGE_KEY]);

	// ---------------------------------------------------------------------------
	// manualRetry
	// ---------------------------------------------------------------------------
	const manualRetry = useCallback(() => {
		reconnectAttempts.current = 0;
		setRetryAttempt(0);
		setError(null);
		connect();
	}, [connect]);

	// ---------------------------------------------------------------------------
	// Effects: autoConnect
	// ---------------------------------------------------------------------------
	useEffect(() => {
		const previousAutoConnect = previousAutoConnectRef.current;

		if (previousAutoConnect === null) {
			previousAutoConnectRef.current = autoConnect;
			if (autoConnect && connectionState !== 'failed' && !connectingRef.current) {
				if (!wsRef.current || (wsRef.current.readyState !== WebSocket.OPEN && wsRef.current.readyState !== WebSocket.CONNECTING)) {
					connect();
				}
			}
			return;
		}

		if (previousAutoConnect === autoConnect) return;

		previousAutoConnectRef.current = autoConnect;

		if (autoConnect) {
			if (!connectingRef.current && (!wsRef.current || (wsRef.current.readyState !== WebSocket.OPEN && wsRef.current.readyState !== WebSocket.CONNECTING))) {
				connect();
			}
		} else {
			disconnect();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [autoConnect, connectionState]);

	// ---------------------------------------------------------------------------
	// Effects: persist messages
	// ---------------------------------------------------------------------------
	useEffect(() => {
		if (isInitialMount.current) {
			isInitialMount.current = false;
			if (messages.length > 0 && hasMeaningfulUserMessage(messages)) {
				persistMessages(STORAGE_KEY, messages);
			}
			return;
		}
		persistMessages(STORAGE_KEY, messages);
	}, [messages, STORAGE_KEY]);

	// ---------------------------------------------------------------------------
	// Effects: persist conversation ID
	// ---------------------------------------------------------------------------
	useEffect(() => {
		persistConversationId(CONVERSATION_STORAGE_KEY, conversationId);
	}, [conversationId, CONVERSATION_STORAGE_KEY]);

	// ---------------------------------------------------------------------------
	// Return (same public API)
	// ---------------------------------------------------------------------------
	return {
		messages,
		setMessages,
		setConversationId,
		setSessionId,
		loadConversation,
		getSessionId,
		sendMessage,
		sendSystemMessage,
		isConnected,
		isConnecting,
		error,
		isTyping,
		status,
		currentResponse,
		approvalRequest,
		conversationId,
		clearApprovalRequest,
		clearTyping,
		addAssistantMessage,
		updateMessage,
		connect,
		disconnect,
		stopRequest,
		clearChatHistory,
		brandId: configRef.current?.brand_id || null,
		connectionState,
		retryAttempt,
		maxRetries: MAX_RECONNECT_ATTEMPTS,
		manualRetry,
	};
};

export default useNfdAgentsWebSocket;
