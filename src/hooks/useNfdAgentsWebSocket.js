/**
 * WebSocket Hook for NFD Agents Backend
 * 
 * Connects to the NFD Agents backend via WebSocket and handles message streaming.
 * Shared hook for use across Help Center, Editor Chat, and other AI chat interfaces.
 */

import { useState, useEffect, useRef, useCallback } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { NFD_AGENTS_WEBSOCKET } from '../config/constants';
import { convertToWebSocketUrl } from '../utils/nfdAgents/urlUtils';
import { isInitialGreeting } from '../utils/nfdAgents/greetingUtils';

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
 * @return {Object} Hook return value with connection state and methods
 */
const useNfdAgentsWebSocket = ({ configEndpoint, storageNamespace = 'default', autoConnect = false, consumerType = 'editor_chat', autoLoadHistory = true }) => {
	// Storage keys for persisting chat history (client-only, not sent to backend)
	const STORAGE_KEY = `nfd-ai-chat-${storageNamespace}-history`;
	const CONVERSATION_STORAGE_KEY = `nfd-ai-chat-${storageNamespace}-conversation-id`;

	// Restore messages and conversation ID from localStorage on mount
	const restoreFromStorage = () => {
		try {
			const storedMessages = localStorage.getItem(STORAGE_KEY);
			const storedConversationId = localStorage.getItem(CONVERSATION_STORAGE_KEY);
			
			if (storedMessages) {
				const parsedMessages = JSON.parse(storedMessages);
				// Only restore if messages exist and are valid
				if (Array.isArray(parsedMessages) && parsedMessages.length > 0) {
					// Convert timestamp strings back to Date objects
					const restoredMessages = parsedMessages.map(msg => ({
						...msg,
						timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
					}));
					return {
						messages: restoredMessages,
						conversationId: storedConversationId || null,
					};
				}
			}
		} catch (err) {
			// eslint-disable-next-line no-console
			console.warn('[AI Chat] Failed to restore chat history from localStorage:', err);
		}
		return { messages: [], conversationId: null };
	};

	// Restore on mount only (use lazy initialization) - respects autoLoadHistory option
	const [messages, setMessages] = useState(() => {
		if (!autoLoadHistory) {
			return [];
		}
		const restored = restoreFromStorage();
		return restored.messages;
	});
	const [conversationId, setConversationId] = useState(() => {
		if (!autoLoadHistory) {
			return null;
		}
		const restored = restoreFromStorage();
		return restored.conversationId;
	});

	const [isConnected, setIsConnected] = useState(false);
	const [isConnecting, setIsConnecting] = useState(false);
	const [error, setError] = useState(null);
	const [isTyping, setIsTyping] = useState(false);
	const [currentResponse, setCurrentResponse] = useState('');
	const [approvalRequest, setApprovalRequest] = useState(null);

	const wsRef = useRef(null);
	const reconnectTimeoutRef = useRef(null);
	const reconnectAttempts = useRef(0);
	const configRef = useRef(null);
	const previousAutoConnectRef = useRef(null); // Start as null to detect first render
	const connectingRef = useRef(false); // Prevents overlapping connect() calls before wsRef is set
	const sessionIdRef = useRef(null);
	const hasUserMessageRef = useRef(false); // Track if user has sent a message
	const isStoppedRef = useRef(false); // Track if user has stopped generation
	const typingTimeoutRef = useRef(null); // Timeout to auto-hide typing indicator if no response
	const isInitialMount = useRef(true); // Track initial mount for localStorage persistence
	const messagesRef = useRef([]); // Ref for messages to avoid stale closure in connect's onopen

	const MAX_RECONNECT_ATTEMPTS = NFD_AGENTS_WEBSOCKET.MAX_RECONNECT_ATTEMPTS;
	const RECONNECT_DELAY = NFD_AGENTS_WEBSOCKET.RECONNECT_DELAY;
	const TYPING_TIMEOUT = NFD_AGENTS_WEBSOCKET.TYPING_TIMEOUT;

	/**
	 * Generate a UUID v4 session ID
	 */
	const generateSessionId = useCallback(() => {
		// Use crypto.randomUUID if available (modern browsers)
		if (typeof crypto !== 'undefined' && crypto.randomUUID) {
			return crypto.randomUUID();
		}
		// Fallback UUID v4 generator
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
			const r = (Math.random() * 16) | 0;
			const v = c === 'x' ? r : (r & 0x3) | 0x8;
			return v.toString(16);
		});
	}, []);


	/**
	 * Fetch configuration from backend
	 */
	const fetchConfig = useCallback(async () => {
		try {
			// Extract namespace and route from configEndpoint if it's a full URL
			// Otherwise, assume it's already in the format 'nfd-agents/chat/v1/config'
			let path = configEndpoint;
			
			// If configEndpoint is a full URL, extract the REST API path
			if (configEndpoint.startsWith('http://') || configEndpoint.startsWith('https://')) {
				// Extract path from URL - look for rest_route or wp-json
				const urlObj = new URL(configEndpoint);
				if (urlObj.searchParams.has('rest_route')) {
					path = urlObj.searchParams.get('rest_route');
				} else if (urlObj.pathname.includes('/wp-json/')) {
					path = urlObj.pathname.replace('/wp-json/', '');
				} else {
					// Fallback: use the pathname
					path = urlObj.pathname.replace(/^\//, '');
				}
			}
			
		// Use apiFetch which handles permalinks and nonce automatically
		// apiFetch expects path without leading slash for REST routes
		const cleanPath = path.startsWith('/') ? path.slice(1) : path;
		
		// For GET requests, append query parameters to the path
		// apiFetch with 'data' option sends POST, but this endpoint is GET
		const pathWithParams = `${cleanPath}?storage_namespace=${encodeURIComponent(storageNamespace)}`;
		
		const config = await apiFetch({
			path: pathWithParams,
			parse: true,
		});
			
			configRef.current = config;
			return config;
		} catch (err) {
			// Error logging kept for debugging connection issues
			// eslint-disable-next-line no-console
			console.error('[AI Chat] Failed to fetch config:', err);
			// eslint-disable-next-line no-console
			console.error('[AI Chat] Error details:', {
				message: err.message,
				code: err.code,
				data: err.data,
				status: err.data?.status,
				statusText: err.data?.statusText,
			});
			
			// Handle apiFetch errors
			let errorMessage = err.message || __('Failed to connect', 'wp-module-ai-chat');
			
			// Check for REST API error message in err.data.message or err.message
			if (err.data?.message) {
				errorMessage = err.data.message;
			} else if (err.message && err.message !== 'Could not get a valid response from the server.') {
				errorMessage = err.message;
			}
			
			if (err.code === 'rest_forbidden' || err.data?.status === 403) {
				errorMessage = __('Access denied. Please check your capabilities.', 'wp-module-ai-chat');
			} else if (err.code === 'rest_no_route' || err.data?.status === 404) {
				errorMessage = __('Config endpoint not found. Please ensure the backend is deployed.', 'wp-module-ai-chat');
			} else if (err.code === 'gateway_url_not_configured') {
				errorMessage = __('Gateway URL not configured. Set NFD_AGENTS_CHAT_GATEWAY_URL in wp-config.php.', 'wp-module-ai-chat');
			} else if (err.code === 'huapi_token_fetch_failed') {
				errorMessage = __('Failed to fetch authentication token from Hiive. Check your connection or set NFD_AGENTS_CHAT_DEBUG_TOKEN for local development.', 'wp-module-ai-chat');
			} else if (err.data?.status) {
				errorMessage = sprintf(
					/* translators: %1$s: HTTP status, %2$s: status text */
					__('Failed to fetch config: %1$s %2$s', 'wp-module-ai-chat'),
					err.data.status,
					err.data.statusText || errorMessage
				);
			}
			
			setError(sprintf(
				/* translators: %s: error message */
				__('Failed to connect: %s', 'wp-module-ai-chat'),
				errorMessage
			));
			throw new Error(errorMessage);
		}
	}, [configEndpoint, storageNamespace]);

	/**
	 * Connect to WebSocket
	 */
	const connect = useCallback(async () => {
		// Check if already connected or connecting
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			return;
		}
		if (wsRef.current?.readyState === WebSocket.CONNECTING) {
			return;
		}
		// Prevent overlapping connect() calls (e.g. React Strict Mode, effect double-run)
		// wsRef is only set after creating the WebSocket, so a second call can pass the above guards
		if (connectingRef.current) {
			return;
		}
		connectingRef.current = true;
		setIsConnecting(true);
		setError(null);

		try {
			// Fetch config if not already cached
			if (!configRef.current) {
				await fetchConfig();
			}

			const config = configRef.current;
			if (!config) {
				throw new Error(__('No configuration available', 'wp-module-ai-chat'));
			}

			// Generate or reuse session ID
			if (!sessionIdRef.current) {
				sessionIdRef.current = generateSessionId();
			}

			// Convert HTTP/HTTPS URL to WebSocket protocol
			const wsBaseUrl = convertToWebSocketUrl(config.gateway_url);

			// Agent type: backend/gateway expects 'blu'; 'nfd-agents' is a legacy alias that is not in the agent registry
			const agentType = (config.agent_type === 'nfd-agents' ? 'blu' : config.agent_type) || 'blu';

			// Build WebSocket URL with session_id, token, and consumer
			let wsUrl = `${wsBaseUrl}/${config.brand_id}/agents/${agentType}/v1/ws?session_id=${sessionIdRef.current}&token=${encodeURIComponent(config.huapi_token)}`;

			// Add consumer parameter: construct wordpress_${consumerType}
			// This triggers site_url derivation from Referer/Origin headers in the gateway
			const consumer = `wordpress_${consumerType}`;
			wsUrl += `&consumer=${encodeURIComponent(consumer)}`;

			// Deprecated: site_url parameter (ignored by gateway, but kept for backward compatibility)
			// The gateway now derives site_url from request headers when consumer contains "wordpress"
			if (config.site_url) {
				// Log deprecation warning but don't add to URL (gateway will ignore it)
				// eslint-disable-next-line no-console
				console.warn('[AI Chat] site_url parameter is deprecated. Use consumerType instead.');
			}

			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;
			// Note: Don't reset connectingRef here - wait until onopen/onerror to prevent race conditions

			ws.onopen = () => {
				connectingRef.current = false; // Now safe to allow new connections
				setIsConnected(true);
				setIsConnecting(false);
				setError(null);
				reconnectAttempts.current = 0;
				// Reset user message flag on new connection
				// Set to true if we have restored messages (user has already sent messages)
				hasUserMessageRef.current = (messagesRef.current && messagesRef.current.length > 0);
				// Reset stopped flag on new connection
				isStoppedRef.current = false;
				// Don't clear messages on reconnect - preserve chat history
				setCurrentResponse('');
			};

			ws.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);

					// If user has stopped generation, ignore all messages except session_established
					// This prevents any further processing after stop is clicked
					if (isStoppedRef.current && data.type !== 'session_established') {
						return;
					}

					// Handle different message types
					if (data.type === 'session_established') {
						// Session established - backend may return a different session_id
						if (data.session_id) {
							sessionIdRef.current = data.session_id;
						}
					} else if (data.type === 'typing_start') {
						// Backend signals agent is processing; show typing indicator
						setIsTyping(true);
						if (typingTimeoutRef.current) {
							clearTimeout(typingTimeoutRef.current);
							typingTimeoutRef.current = null;
						}
					} else if (data.type === 'typing_stop') {
						// Backend signals agent finished; hide typing indicator
						setIsTyping(false);
						setCurrentResponse('');
						if (typingTimeoutRef.current) {
							clearTimeout(typingTimeoutRef.current);
							typingTimeoutRef.current = null;
						}
					} else if (data.type === 'streaming_chunk' || data.type === 'chunk') {
						// Ignore streaming chunks if user has stopped generation
						if (isStoppedRef.current) {
							return;
						}
						
						// Streaming response chunk
						const content = data.content || data.chunk || data.text || '';
						if (content) {
							setCurrentResponse((prev) => {
								const newContent = prev + content;
								// Only filter greetings if we haven't received any user message AND
								// the content is still very short (likely just the greeting start)
								// Once content gets longer, it's probably a real response
								if (!hasUserMessageRef.current && newContent.length < 100 && isInitialGreeting(newContent)) {
									// Don't show initial greetings - clear any partial we may have accumulated
									// eslint-disable-next-line no-console
									console.debug('[AI Chat] Filtering initial greeting:', newContent.substring(0, 50));
									return '';
								}
								// Only set typing if we're actually showing content (not filtered greetings)
								setIsTyping(true);
								if (typingTimeoutRef.current) {
									clearTimeout(typingTimeoutRef.current);
								}
								typingTimeoutRef.current = setTimeout(() => {
									setIsTyping(false);
									typingTimeoutRef.current = null;
								}, TYPING_TIMEOUT);
								return newContent;
							});
						}
					} else if (data.type === 'structured_output') {
						// Structured output (e.g., approval requests)
						// Handle approval requests (human_input_request)
						const humanInputRequest = data.response_content?.content?.human_input_request;

						if (humanInputRequest) {
							const inputType = (humanInputRequest.input_type || humanInputRequest.inputType || '').toUpperCase();

							// APPROVAL_REQUEST: only persist conversation_id when present; no approval UI (backend always executes tools)
							if (inputType === 'APPROVAL_REQUEST') {
								// Still handle conversation ID if available
								if (data.conversation_id || data.conversationId) {
									const newConversationId = data.conversation_id || data.conversationId;
									setConversationId(newConversationId);
									// Persist conversation ID to localStorage
									try {
										localStorage.setItem(CONVERSATION_STORAGE_KEY, newConversationId);
									} catch (err) {
										// eslint-disable-next-line no-console
										console.warn('[AI Chat] Failed to save conversation ID to localStorage:', err);
									}
								}
								// Return early to prevent duplicate approval dialog
								return;
							}
						}
						
						// Handle structured output messages
						// Check both data.message and data.response_content.message
						const structuredMessage = data.message || data.response_content?.message;
						
						// If there's a message, handle it
						// Filter out system messages that shouldn't be shown to users
						const filteredMessage = structuredMessage?.trim();
						if (filteredMessage && 
							filteredMessage !== 'No content provided' && 
							filteredMessage !== 'sales_requested' &&
							filteredMessage.toLowerCase() !== 'sales_requested') {
								// Only filter greetings if message is short and clearly just a greeting
								// Longer messages are likely real responses, even if they contain greeting words
								if (!hasUserMessageRef.current && filteredMessage.length < 150 && isInitialGreeting(filteredMessage)) {
									// Don't add the message - but keep typing state as is (real response might still be coming)
									// eslint-disable-next-line no-console
									console.debug('[AI Chat] Filtering greeting message:', filteredMessage.substring(0, 50));
									setCurrentResponse('');
									return;
								}
							
							// Finalize any current streaming response first
							setCurrentResponse((prev) => {
								if (prev) {
									setMessages((prevMessages) => [
										...prevMessages,
										{
											id: `msg-${Date.now()}-streaming`,
											role: 'assistant',
											type: 'assistant',
											content: prev,
											timestamp: new Date(),
										},
									]);
								}
								return '';
							});
							
							// Add structured output message
							setMessages((prev) => [
								...prev,
								{
									id: `msg-${Date.now()}`,
									role: 'assistant',
									type: 'assistant',
									content: filteredMessage,
									timestamp: new Date(),
								},
							]);
							setIsTyping(false);
							setCurrentResponse('');
							// Clear typing timeout since we received content
							if (typingTimeoutRef.current) {
								clearTimeout(typingTimeoutRef.current);
								typingTimeoutRef.current = null;
							}
						} else {
							// No message - might be an empty response; don't set isTyping(false) yet
						}
					} else if (data.type === 'tool_result') {
						// Persist conversation_id when present (backend always executes tools; no approval UI)
						if (data.conversation_id || data.conversationId) {
							const newConversationId = data.conversation_id || data.conversationId;
							setConversationId(newConversationId);
							try {
								localStorage.setItem(CONVERSATION_STORAGE_KEY, newConversationId);
							} catch (err) {
								// eslint-disable-next-line no-console
								console.warn('[AI Chat] Failed to save conversation ID to localStorage:', err);
							}
						}
					} else if (data.type === 'message' || data.type === 'complete') {
						// Complete message - finalize current streaming response, or use payload message
						let hasContent = false;
						setCurrentResponse((prev) => {
							if (prev) {
								// Filter out system messages that shouldn't be shown
								const trimmedContent = prev.trim();
								if (trimmedContent === 'No content provided' || 
									trimmedContent === 'sales_requested' ||
									trimmedContent.toLowerCase() === 'sales_requested') {
									// Don't set isTyping(false) - actual response might still be coming
									return '';
								}
								
								// Only filter greetings if message is short and clearly just a greeting
								if (!hasUserMessageRef.current && prev.length < 150 && isInitialGreeting(prev)) {
									// Clear the response - but keep typing state (real response might still be coming)
									// eslint-disable-next-line no-console
									console.debug('[AI Chat] Filtering greeting in complete message:', prev.substring(0, 50));
									return '';
								}
								
								// Save current streaming response as a message
								setMessages((prevMessages) => [
									...prevMessages,
									{
										id: `msg-${Date.now()}`,
										role: 'assistant',
										type: 'assistant',
										content: prev,
										timestamp: new Date(),
									},
								]);
								hasContent = true;
							}
							return '';
						});
						// If no content from streaming buffer, use message from payload (backend may send full message in type: message)
						if (!hasContent) {
							const payloadMessage = data.message || data.response_content?.message;
							const trimmedPayload = payloadMessage?.trim();
							if (trimmedPayload &&
								trimmedPayload !== 'No content provided' &&
								trimmedPayload !== 'sales_requested' &&
								trimmedPayload.toLowerCase() !== 'sales_requested') {
								if (!hasUserMessageRef.current && trimmedPayload.length < 150 && isInitialGreeting(trimmedPayload)) {
									// eslint-disable-next-line no-console
									console.debug('[AI Chat] Filtering greeting in message payload:', trimmedPayload.substring(0, 50));
								} else {
									setMessages((prev) => [
										...prev,
										{
											id: `msg-${Date.now()}`,
											role: 'assistant',
											type: 'assistant',
											content: trimmedPayload,
											timestamp: new Date(),
										},
									]);
									hasContent = true;
								}
							}
						}
						// Only set isTyping(false) if we actually added content
						if (hasContent) {
							setIsTyping(false);
							setCurrentResponse('');
							// Clear typing timeout since we received content
							if (typingTimeoutRef.current) {
								clearTimeout(typingTimeoutRef.current);
								typingTimeoutRef.current = null;
							}
						}
					} else if (data.type === 'handoff_request') {
						// Handle handoff requests - filter out system messages
						const messageContent = data.message || data.response_content?.message;
						const trimmedMessage = messageContent?.trim();
						
						// Filter out system messages that shouldn't be shown
						if (!trimmedMessage || 
							trimmedMessage === 'No content provided' || 
							trimmedMessage === 'sales_requested' ||
							trimmedMessage.toLowerCase() === 'sales_requested') {
							// Don't set isTyping(false) - actual response might still be coming
							setCurrentResponse('');
							return;
						}
						
						// Only add message if it has actual content
						setMessages((prev) => [
							...prev,
							{
								id: `msg-${Date.now()}`,
								role: 'assistant',
								type: 'assistant',
								content: trimmedMessage,
								timestamp: new Date(),
							},
						]);
						setIsTyping(false);
						setCurrentResponse('');
						// Clear typing timeout since we received content
						if (typingTimeoutRef.current) {
							clearTimeout(typingTimeoutRef.current);
							typingTimeoutRef.current = null;
						}
					} else if (data.type === 'error') {
						setError(data.message || data.error || __('An error occurred', 'wp-module-ai-chat'));
						setIsTyping(false);
						setCurrentResponse('');
					} else if (data.message || data.response_content?.message) {
						// Generic message with content (handles handoff_request, etc.)
						// Check both data.message and data.response_content.message
						const messageContent = data.message || data.response_content?.message;
						
						// Filter out system messages that shouldn't be shown
						const trimmedMessage = messageContent?.trim();
						if (!trimmedMessage || 
							trimmedMessage === 'No content provided' || 
							trimmedMessage === 'sales_requested' ||
							trimmedMessage.toLowerCase() === 'sales_requested') {
							// Don't set isTyping(false) - actual response might still be coming
							setCurrentResponse('');
							return;
						}
						
						// Only filter greetings if message is short and clearly just a greeting
						if (!hasUserMessageRef.current && trimmedMessage.length < 150 && isInitialGreeting(trimmedMessage)) {
							// Don't add the message - but keep typing state (real response might still be coming)
							// eslint-disable-next-line no-console
							console.debug('[AI Chat] Filtering greeting in generic message:', trimmedMessage.substring(0, 50));
							setCurrentResponse('');
							return;
						}

						setMessages((prev) => [
							...prev,
							{
								id: `msg-${Date.now()}`,
								role: 'assistant',
								type: 'assistant',
								content: trimmedMessage,
								timestamp: new Date(),
							},
						]);
						setIsTyping(false);
						setCurrentResponse('');
						// Clear typing timeout since we received content
						if (typingTimeoutRef.current) {
							clearTimeout(typingTimeoutRef.current);
							typingTimeoutRef.current = null;
						}
					}
				} catch (err) {
					// eslint-disable-next-line no-console
					console.error('[AI Chat] Error parsing WebSocket message:', err);
				}
			};

			ws.onerror = (error) => {
				// eslint-disable-next-line no-console
				console.error('[AI Chat] WebSocket error:', error);
				connectingRef.current = false; // Reset so new connections can be attempted
				setError(__('Connection error. Please check server status and configuration.', 'wp-module-ai-chat'));
				setIsConnecting(false);
			};

			ws.onclose = (event) => {
				connectingRef.current = false; // Reset so new connections can be attempted
				setIsConnected(false);
				setIsConnecting(false);
				setIsTyping(false);
				// Clear ref only if this is still the active socket (avoid clearing a newer one)
				if (wsRef.current === ws) {
					wsRef.current = null;
				}

				// Attempt to reconnect if not a normal closure
				if (event.code !== 1000 && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
					reconnectAttempts.current++;
					const delay = RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current - 1);
					reconnectTimeoutRef.current = setTimeout(() => {
						connect();
					}, delay);
				} else if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
					setError(__('Failed to reconnect. Please refresh the page.', 'wp-module-ai-chat'));
				}
			};
		} catch (error) {
			connectingRef.current = false;
			// eslint-disable-next-line no-console
			console.error('[AI Chat] Error creating WebSocket:', error);
			setError(error.message || __('Failed to connect. Please check configuration and server status.', 'wp-module-ai-chat'));
			setIsConnecting(false);
		}
	}, [fetchConfig, generateSessionId]);

	// Keep messagesRef in sync with messages for use in connect's onopen (avoids stale closure)
	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	/**
	 * Send a message via WebSocket
	 */
	const sendMessage = useCallback(
		(message, convId = null) => {
			// Reset stopped flag when sending a new message
			isStoppedRef.current = false;

			// Mark that user has sent a message (so we don't filter subsequent greetings)
			hasUserMessageRef.current = true;
			if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
				setError(__('Not connected. Please wait for connection.', 'wp-module-ai-chat'));
				return;
			}

			// If this is a user message (not a tool result), add to state
			if (!convId) {
				const userMessage = {
					id: `msg-${Date.now()}`,
					role: 'user',
					type: 'user',
					content: message,
					timestamp: new Date(),
				};

				setMessages((prev) => [...prev, userMessage]);
				setCurrentResponse(''); // Clear any previous response
				setIsTyping(true);

				// Set a timeout to hide typing indicator if no response comes
				// Clear any existing timeout first
				if (typingTimeoutRef.current) {
					clearTimeout(typingTimeoutRef.current);
				}
				typingTimeoutRef.current = setTimeout(() => {
					// Hide typing indicator if timeout expires (no response received)
					setIsTyping(false);
					typingTimeoutRef.current = null;
				}, TYPING_TIMEOUT);
			}

			// Send message via WebSocket
			const payload = {
				type: 'chat',
				message: message,
			};

			// Only send conversationId if explicitly provided (for tool results)
			// If conversationId was cleared (null), don't send it to prevent backend from using old context
			if (convId) {
				payload.conversationId = convId;
			} else if (conversationId) {
				payload.conversationId = conversationId;
			}
			// If conversationId is null/undefined, intentionally don't include it in payload
			// This ensures backend uses the session's conversation_id, not an old one

			wsRef.current.send(JSON.stringify(payload));
		},
		[conversationId]
	);

	/**
	 * Send a system message via WebSocket (hidden from UI)
	 * Used for tool execution results that the agent needs to process
	 * but shouldn't be shown directly to the user in the chat
	 */
	const sendSystemMessage = useCallback(
		(message) => {
			if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
				// eslint-disable-next-line no-console
				console.warn('[AI Chat] Cannot send system message - not connected');
				return;
			}

			// Send message via WebSocket WITHOUT adding to UI
			// The agent will process this and respond naturally
			const payload = {
				type: 'chat',
				message: message,
			};

			// Include conversationId if available
			if (conversationId) {
				payload.conversationId = conversationId;
			}

			// Set typing indicator since we expect a response
			setIsTyping(true);
			setCurrentResponse('');

			// Set a timeout to hide typing indicator if no response comes
			if (typingTimeoutRef.current) {
				clearTimeout(typingTimeoutRef.current);
			}
			typingTimeoutRef.current = setTimeout(() => {
				setIsTyping(false);
				typingTimeoutRef.current = null;
			}, TYPING_TIMEOUT);

			wsRef.current.send(JSON.stringify(payload));
		},
		[conversationId]
	);

	/**
	 * Disconnect WebSocket
	 */
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
	}, []);

	/**
	 * Stop the current generation request
	 * Immediately stops typing but keeps connection open for next message
	 */
	const stopRequest = useCallback(() => {
		// Set stopped flag to prevent processing any more messages
		isStoppedRef.current = true;
		
		// Immediately stop typing state to provide instant feedback
		setIsTyping(false);
		setCurrentResponse('');
		
		// Clear typing timeout
		if (typingTimeoutRef.current) {
			clearTimeout(typingTimeoutRef.current);
			typingTimeoutRef.current = null;
		}
		
		// Note: We don't close the WebSocket connection here
		// This allows the user to immediately send another message
		// The connection will remain open and ready for the next request
	}, []);

	/**
	 * Clear approval request (after approval/rejection)
	 */
	const clearApprovalRequest = useCallback(() => {
		setApprovalRequest(null);
	}, []);

	/**
	 * Clear typing indicator
	 * Used when tool execution completes to allow user to send next message
	 */
	const clearTyping = useCallback(() => {
		setIsTyping(false);
		// Clear typing timeout if it exists
		if (typingTimeoutRef.current) {
			clearTimeout(typingTimeoutRef.current);
			typingTimeoutRef.current = null;
		}
	}, []);

	/**
	 * Add assistant message programmatically
	 * Used to display tool results as AI messages
	 * 
	 * @param {string|Object} content Message content to display (will be converted to string if object)
	 */
	const addAssistantMessage = useCallback((content) => {
		// Ensure content is always a string to prevent React rendering errors
		let contentString;
		if (content === null || content === undefined) {
			contentString = __('No content provided.', 'wp-module-ai-chat');
		} else if (typeof content === 'object') {
			// If content is an object, stringify it
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
		if (typingTimeoutRef.current) {
			clearTimeout(typingTimeoutRef.current);
			typingTimeoutRef.current = null;
		}
	}, []);

	/**
	 * Update a specific message in the messages array
	 * Used to modify approval messages when cancelled/approved
	 * 
	 * @param {string|Function} messageIdOrPredicate Message ID or predicate function to find message
	 * @param {Function} updater Function that receives message and returns updated message
	 */
	const updateMessage = useCallback((messageIdOrPredicate, updater) => {
		setMessages((prev) =>
			prev.map((msg) => {
				// Check if this is the message to update
				const shouldUpdate = typeof messageIdOrPredicate === 'function'
					? messageIdOrPredicate(msg)
					: msg.id === messageIdOrPredicate;
				
				if (shouldUpdate) {
					return updater(msg);
				}
				return msg;
			})
		);
	}, []);

	/**
	 * Connect/disconnect based on autoConnect prop
	 * This ensures we only fetch token and connect when sidebar is actually open
	 */
	useEffect(() => {
		const previousAutoConnect = previousAutoConnectRef.current;

		// On first render, just store the value and return (don't connect yet if false)
		if (previousAutoConnect === null) {
			previousAutoConnectRef.current = autoConnect;
			if (autoConnect && !connectingRef.current) {
				if (!wsRef.current || (wsRef.current.readyState !== WebSocket.OPEN && wsRef.current.readyState !== WebSocket.CONNECTING)) {
					connect();
				}
			}
			return;
		}

		// Only act if autoConnect actually changed
		if (previousAutoConnect === autoConnect) {
			return;
		}

		previousAutoConnectRef.current = autoConnect;

		if (autoConnect) {
			if (!connectingRef.current && (!wsRef.current || (wsRef.current.readyState !== WebSocket.OPEN && wsRef.current.readyState !== WebSocket.CONNECTING))) {
				connect();
			}
		} else {
			disconnect();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [autoConnect]); // Only depend on autoConnect - connect/disconnect are stable

	/**
	 * Persist messages to localStorage whenever they change
	 * Skip on initial mount if messages are empty (to avoid overwriting with empty array)
	 */
	useEffect(() => {
		// Skip saving on initial mount if messages are empty (they were just restored or are truly empty)
		if (isInitialMount.current) {
			isInitialMount.current = false;
			// Only save if we have messages (don't overwrite with empty on first render)
			if (messages.length > 0) {
				try {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
				} catch (err) {
					// eslint-disable-next-line no-console
					console.warn('[AI Chat] Failed to save messages to localStorage:', err);
				}
			}
			return;
		}

		// Save messages to localStorage on every change after initial mount
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
		} catch (err) {
			// eslint-disable-next-line no-console
			console.warn('[AI Chat] Failed to save messages to localStorage:', err);
		}
	}, [messages]);

	/**
	 * Persist conversation ID to localStorage whenever it changes
	 */
	useEffect(() => {
		try {
			if (conversationId) {
				localStorage.setItem(CONVERSATION_STORAGE_KEY, conversationId);
			} else {
				// Clear conversation ID from storage if it's null
				localStorage.removeItem(CONVERSATION_STORAGE_KEY);
			}
		} catch (err) {
			// eslint-disable-next-line no-console
			console.warn('[AI Chat] Failed to save conversation ID to localStorage:', err);
		}
	}, [conversationId]);

	/**
	 * Clear chat history from localStorage and reset all state
	 */
	const clearChatHistory = useCallback(() => {
		try {
			// Clear localStorage
			localStorage.removeItem(STORAGE_KEY);
			localStorage.removeItem(CONVERSATION_STORAGE_KEY);

			// Reset React state
			setMessages([]);
			setConversationId(null);
			setApprovalRequest(null);
			setIsTyping(false);
			setCurrentResponse('');
			setError(null);

			// RESET SESSION ID FIRST - This is critical to prevent old context from being restored
			// When sessionIdRef is null, connect() will generate a new session_id on next connection
			// This forces the backend to create a completely new session with no conversation history
			sessionIdRef.current = null;

			// Disconnect WebSocket to force fresh connection
			if (wsRef.current) {
				wsRef.current.close();
				wsRef.current = null;
				setIsConnected(false);
			}
			
			// Reset refs
			hasUserMessageRef.current = false;
			isStoppedRef.current = false;
			
			// Clear typing timeout
			if (typingTimeoutRef.current) {
				clearTimeout(typingTimeoutRef.current);
				typingTimeoutRef.current = null;
			}
			
			// Clear reconnect timeout if any
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
				reconnectTimeoutRef.current = null;
			}
			
			// Reset reconnect attempts
			reconnectAttempts.current = 0;
			
			// If autoConnect is enabled, reconnect after clearing
			// (This will be handled by the autoConnect useEffect)
		} catch (err) {
			// eslint-disable-next-line no-console
			console.warn('[AI Chat] Failed to clear chat history:', err);
		}
	}, []);

	return {
		messages,
		sendMessage,
		sendSystemMessage,
		isConnected,
		isConnecting,
		error,
		isTyping,
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
	};
};

export default useNfdAgentsWebSocket;
