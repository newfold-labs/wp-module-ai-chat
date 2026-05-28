/**
 * WebSocket hook for NFD Agents backend.
 *
 * Connects via WebSocket, handles message streaming and reconnection.
 * Used by Help Center, Editor Chat, and other AI chat UIs.
 * Delegates to: messageHandler, configFetcher, storage, url.
 */

/* global WebSocket localStorage sessionStorage navigator */
/* eslint-disable no-console -- Connection and storage warnings only. */

import { useState, useEffect, useRef, useCallback } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import {
	NFD_AGENTS_WEBSOCKET,
	WS_CLOSE_AUTH_FAILED,
	WS_CLOSE_MISSING_TOKEN,
	WS_CLOSE_RATE_LIMITED,
} from "../constants/nfdAgents/websocket";
import { getJwtExpirationMs } from "../utils/nfdAgents/jwtUtils";
import {
	getSiteId,
	setSiteId,
	migrateStorageKeys,
	getChatHistoryStorageKeys,
} from "../constants/nfdAgents/storageKeys";
import { buildWebSocketUrl } from "../utils/nfdAgents/url";
import { createMessageHandler } from "../utils/nfdAgents/messageHandler";
import { fetchAgentConfig } from "../utils/nfdAgents/configFetcher";
import {
	restoreChat,
	persistMessages,
	persistConversationId,
	clearChatStorage,
	hasMeaningfulUserMessage,
} from "../utils/nfdAgents/storage";
import { generateSessionId } from "../utils/helpers";

/**
 * useNfdAgentsWebSocket Hook
 *
 * Manages WebSocket connection to NFD Agents backend with automatic reconnection
 * and message handling.
 *
 * @param {Object}   options                                      Hook options
 * @param {string}   options.configEndpoint                       REST API endpoint for fetching config
 * @param {string}   options.consumer                             Consumer identifier. Required. Used for localStorage keys and sent to backend as query param. Valid values are defined by the backend.
 * @param {boolean}  [options.autoConnect=false]                  Whether to connect automatically
 * @param {string}   [options.consumerType]                       Consumer type; passed to backend as `wordpress_${consumerType}`. Defaults to 'editor_chat'.
 * @param {boolean}  [options.autoLoadHistory=true]               Whether to auto-load chat history from localStorage on mount.
 *                                                                Set to false to start with empty chat but keep history in storage for later access.
 * @param {Function} [options.getConnectionFailedFallbackMessage] Optional. When connection has failed (e.g. after max
 *                                                                retries) and the user sends a message, the hook will add an assistant message with the returned string.
 *                                                                Called as getConnectionFailedFallbackMessage(userMessage). Use for exact copy (e.g. NoResults-style) with i18n.
 * @return {Object} Hook return value with connection state and methods
 */
const useNfdAgentsWebSocket = ({
	configEndpoint,
	consumer,
	autoConnect = false,
	consumerType = "editor_chat",
	autoLoadHistory = true,
	getConnectionFailedFallbackMessage,
} = {}) => {
	// ---------------------------------------------------------------------------
	// Storage keys (site-scoped; single source of truth from storageKeys.js)
	// ---------------------------------------------------------------------------
	const storageKeys = getChatHistoryStorageKeys(consumer);
	const STORAGE_KEY = storageKeys.history;
	const CONVERSATION_STORAGE_KEY = storageKeys.conversationId;
	const SESSION_STORAGE_KEY = storageKeys.sessionId;
	const keyPrefix = STORAGE_KEY.replace(/-history$/, "");

	// ---------------------------------------------------------------------------
	// State (lazy-init from localStorage)
	// ---------------------------------------------------------------------------
	const [messages, setMessages] = useState(() => {
		if (!autoLoadHistory) {
			return [];
		}
		return restoreChat(STORAGE_KEY, CONVERSATION_STORAGE_KEY, SESSION_STORAGE_KEY).messages;
	});
	const [conversationId, setConversationId] = useState(() => {
		if (!autoLoadHistory) {
			return null;
		}
		return restoreChat(STORAGE_KEY, CONVERSATION_STORAGE_KEY, SESSION_STORAGE_KEY).conversationId;
	});

	const [isConnected, setIsConnected] = useState(false);
	const [isConnecting, setIsConnecting] = useState(false);
	const [error, setError] = useState(null);
	const [isTyping, setIsTyping] = useState(false);
	const [status, setStatus] = useState(null);
	const [currentResponse, setCurrentResponse] = useState("");
	const [approvalRequest, setApprovalRequest] = useState(null);
	// Restore "failed" from sessionStorage so UI shows error state across navigations within the tab
	const [connectionState, setConnectionState] = useState(() => {
		try {
			if (sessionStorage.getItem(`${keyPrefix}-connection-failed`) === "1") {
				return "failed";
			}
		} catch (e) {
			// ignore
		}
		return "disconnected";
	});
	const [retryAttempt, setRetryAttempt] = useState(0);
	// Wall-clock ms when the next scheduled reconnect will fire — lets the UI render a countdown
	// instead of just an attempt counter. Null when no reconnect is pending.
	const [nextRetryAt, setNextRetryAt] = useState(null);
	// Mirrors navigator.onLine. The browser fires `online`/`offline` events when the OS
	// network state changes; we surface this as React state so the UI can show an explicit
	// "You're offline" indicator instead of leaving the user to puzzle out why messages
	// won't send. Defaults to "online" in SSR / non-browser environments.
	const [isOffline, setIsOffline] = useState(() => {
		return typeof navigator !== "undefined" && navigator && navigator.onLine === false;
	});

	// ---------------------------------------------------------------------------
	// Refs — wsRef: current WebSocket. reconnectTimeoutRef/Attempts: backoff. configRef: cached config.
	// previousAutoConnectRef/connectingRef: avoid duplicate connect. sessionIdRef: current session (lazy init below).
	// hasUserMessageRef/isStoppedRef: read by messageHandler. typingTimeoutRef: clear on stop/close.
	// messagesRef/connectionStateRef/prevConnectionStateRef: latest state for callbacks.
	// ---------------------------------------------------------------------------
	const wsRef = useRef(null);
	const reconnectTimeoutRef = useRef(null);
	const reconnectAttempts = useRef(0);
	const configRef = useRef(null);
	// Site ID this hook loaded its initial chat state for. Captured at mount so that, on
	// connect(), we can compare against config.site_id and reconcile if the user is actually
	// on a different site than the cached value at mount. Tracked per-hook so a sibling
	// consumer's setSiteId() doesn't race-mask the mismatch we need to detect.
	const initialSiteIdRef = useRef(getSiteId());
	const jwtRefreshTimeoutRef = useRef(null);
	const lastProactiveRefreshAt = useRef(null);
	const justDidProactiveRefreshRef = useRef(false);
	const lastAuthRefreshAt = useRef(null);
	const connectRef = useRef(null);
	const disconnectRef = useRef(null);
	const previousAutoConnectRef = useRef(null);
	const connectingRef = useRef(false);
	const sessionIdRef = useRef(() => {
		if (autoLoadHistory) {
			return restoreChat(STORAGE_KEY, CONVERSATION_STORAGE_KEY, SESSION_STORAGE_KEY).sessionId;
		}
		return null;
	});
	// Unwrap lazy initializer for ref (refs don't support lazy init like useState)
	if (typeof sessionIdRef.current === "function") {
		sessionIdRef.current = sessionIdRef.current();
	}
	const hasUserMessageRef = useRef(false);
	const isStoppedRef = useRef(false);
	const isTypingRef = useRef(false);
	const typingTimeoutRef = useRef(null);
	const isInitialMount = useRef(true);
	const messagesRef = useRef([]);
	const connectionStateRef = useRef(connectionState);
	const prevConnectionStateRef = useRef(connectionState);

	const MAX_RECONNECT_ATTEMPTS = NFD_AGENTS_WEBSOCKET.MAX_RECONNECT_ATTEMPTS;
	const RECONNECT_DELAY = NFD_AGENTS_WEBSOCKET.RECONNECT_DELAY;
	const MAX_RECONNECT_DELAY = NFD_AGENTS_WEBSOCKET.MAX_RECONNECT_DELAY;
	const RECONNECT_JITTER_RATIO = NFD_AGENTS_WEBSOCKET.RECONNECT_JITTER_RATIO;
	const TYPING_TIMEOUT = NFD_AGENTS_WEBSOCKET.TYPING_TIMEOUT;
	const JWT_REFRESH_BUFFER_MS = NFD_AGENTS_WEBSOCKET.JWT_REFRESH_BUFFER_MS;
	const JWT_REFRESH_MIN_DELAY_MS = NFD_AGENTS_WEBSOCKET.JWT_REFRESH_MIN_DELAY_MS;
	const JWT_PROACTIVE_REFRESH_COOLDOWN_MS = NFD_AGENTS_WEBSOCKET.JWT_PROACTIVE_REFRESH_COOLDOWN_MS;
	const AUTH_REFRESH_COOLDOWN_MS = NFD_AGENTS_WEBSOCKET.AUTH_REFRESH_COOLDOWN_MS;
	const JWT_EXPIRED_BUFFER_MS = NFD_AGENTS_WEBSOCKET.JWT_EXPIRED_BUFFER_MS;
	const JWT_PROACTIVE_REFRESH_DEFER_MS = NFD_AGENTS_WEBSOCKET.JWT_PROACTIVE_REFRESH_DEFER_MS;

	// ---------------------------------------------------------------------------
	// Callbacks passed to messageHandler (persist session/conversation ID to ref + localStorage)
	// ---------------------------------------------------------------------------
	const saveSessionId = useCallback(
		(sid) => {
			sessionIdRef.current = sid;
			try {
				localStorage.setItem(SESSION_STORAGE_KEY, sid);
			} catch (err) {
				// eslint-disable-next-line no-console
				console.warn("[AI Chat] Failed to save session ID to localStorage:", err);
			}
		},
		[SESSION_STORAGE_KEY]
	);

	const saveConversationId = useCallback(
		(cid) => {
			try {
				localStorage.setItem(CONVERSATION_STORAGE_KEY, cid);
			} catch (err) {
				// eslint-disable-next-line no-console
				console.warn("[AI Chat] Failed to save conversation ID to localStorage:", err);
			}
		},
		[CONVERSATION_STORAGE_KEY]
	);

	// ---------------------------------------------------------------------------
	// connect() — Idempotent. Fetches config (cached), ensures site ID + storage migration,
	// opens WebSocket, wires message handler. On close, schedules reconnect with backoff.
	// ---------------------------------------------------------------------------
	const connect = useCallback(async () => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			return;
		}
		if (wsRef.current?.readyState === WebSocket.CONNECTING) {
			return;
		}
		if (connectingRef.current) {
			return;
		}

		// Clear "connection failed" flag
		try {
			sessionStorage.removeItem(`${keyPrefix}-connection-failed`);
		} catch (e) {
			// ignore
		}
		connectingRef.current = true;
		setIsConnecting(true);
		setConnectionState("connecting");
		setError(null);

		try {
			// Fetch config if not cached
			if (!configRef.current) {
				configRef.current = await fetchAgentConfig({ configEndpoint, consumer });
			}

			let config = configRef.current;
			if (!config) {
				throw new Error(__("No configuration available", "wp-module-ai-chat"));
			}

			// Pre-connect: if JWT is already expired or within buffer, refetch config once
			let refetchedForExpiry = false;
			while (config?.jarvis_jwt) {
				const expMs = getJwtExpirationMs(config.jarvis_jwt);
				if (expMs == null) {
					break;
				}
				if (expMs >= Date.now() + JWT_EXPIRED_BUFFER_MS) {
					break;
				}
				if (refetchedForExpiry) {
					throw new Error(__("Token expired, please refresh the page.", "wp-module-ai-chat"));
				}
				configRef.current = null;
				configRef.current = await fetchAgentConfig({ configEndpoint, consumer });
				config = configRef.current;
				refetchedForExpiry = true;
				if (!config) {
					throw new Error(__("No configuration available", "wp-module-ai-chat"));
				}
			}

			// Reconcile site-scoped storage when the cached site ID is wrong for this site.
			//
			// localStorage is scoped to origin, not site, so two distinct sites served from the
			// same origin (e.g. domain.com vs domain.com/website_3ec657) share storage and rely
			// on the {siteId} prefix in keys to stay isolated. Two cases to handle when the
			// site ID this hook loaded for differs from what the server confirms:
			//
			//   1. Pre-migration (loaded siteId === ""): legacy data lives under no-siteId keys.
			//      Move it under siteId-scoped keys so it survives future loads. One-time per
			//      browser per consumer; safe because no other site can own those keys.
			//
			//   2. Real site switch (loaded siteId !== ""): the cache was stale at mount and we
			//      already pulled the wrong site's history into React state. Do NOT migrate —
			//      that would cross-contaminate sites. Reload state from the new site's keys
			//      instead, so the persistence effects (which run on the next render with the
			//      updated STORAGE_KEY) write the correct site's data and don't clobber the new
			//      site's stored data with the previous site's state.
			if (config.site_id && initialSiteIdRef.current !== config.site_id) {
				if (!initialSiteIdRef.current) {
					migrateStorageKeys("", config.site_id, consumer);
				} else {
					const newKeys = getChatHistoryStorageKeys(consumer, config.site_id);
					const restored = restoreChat(
						newKeys.history,
						newKeys.conversationId,
						newKeys.sessionId
					);
					setMessages(restored.messages);
					setConversationId(restored.conversationId);
					sessionIdRef.current = restored.sessionId;
				}
				initialSiteIdRef.current = config.site_id;
			}
			// Sync the shared cache (cheap and idempotent — guarded so a no-op skips the write).
			if (config.site_id && getSiteId() !== config.site_id) {
				setSiteId(config.site_id);
			}

			// Generate or reuse session ID
			if (!sessionIdRef.current) {
				sessionIdRef.current = generateSessionId();
			}

			// Schedule proactive JWT refresh only for jarvis_jwt (exclude huapi_token / debug path)
			if (config.jarvis_jwt) {
				if (jwtRefreshTimeoutRef.current) {
					clearTimeout(jwtRefreshTimeoutRef.current);
					jwtRefreshTimeoutRef.current = null;
				}
				const expMs = getJwtExpirationMs(config.jarvis_jwt);
				if (expMs != null) {
					let refreshAt = expMs - JWT_REFRESH_BUFFER_MS;
					refreshAt = Math.max(refreshAt, Date.now() + JWT_REFRESH_MIN_DELAY_MS);
					const now = Date.now();
					const insideCooldown =
						lastProactiveRefreshAt.current != null &&
						refreshAt < lastProactiveRefreshAt.current + JWT_PROACTIVE_REFRESH_COOLDOWN_MS;
					// After a proactive refresh we must reschedule for the new token; cooldown would block that.
					const skipCooldownAfterRefresh = justDidProactiveRefreshRef.current;
					if (skipCooldownAfterRefresh) {
						justDidProactiveRefreshRef.current = false;
					}
					if (!insideCooldown || skipCooldownAfterRefresh) {
						const delay = Math.max(0, refreshAt - now);
						const runRefresh = () => {
							if (isTypingRef.current) {
								jwtRefreshTimeoutRef.current = setTimeout(
									runRefresh,
									JWT_PROACTIVE_REFRESH_DEFER_MS
								);
								return;
							}
							jwtRefreshTimeoutRef.current = null;
							lastProactiveRefreshAt.current = Date.now();
							justDidProactiveRefreshRef.current = true;
							configRef.current = null;
							if (disconnectRef.current) {
								disconnectRef.current();
							}
							if (connectRef.current) {
								connectRef.current();
							}
						};
						jwtRefreshTimeoutRef.current = setTimeout(runRefresh, delay);
					}
				}
			}

			// Build WebSocket URL from config (site_url comes from config endpoint)
			const wsUrl = buildWebSocketUrl(config, sessionIdRef.current, consumerType);

			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;

			// Connected: reset reconnection state and sync "has user message" from current messages
			ws.onopen = () => {
				connectingRef.current = false;
				setIsConnected(true);
				setIsConnecting(false);
				setConnectionState("connected");
				setRetryAttempt(0);
				setNextRetryAt(null);
				setError(null);
				reconnectAttempts.current = 0;
				hasUserMessageRef.current = messagesRef.current && messagesRef.current.length > 0;
				isStoppedRef.current = false;
				setCurrentResponse("");
			};

			// Refresh the typing-indicator auto-hide timer. Only acts when a timer is
			// already pending (i.e., an in-flight request) so background events like
			// session_established before the user sends don't spin up a stray timeout.
			const bumpTypingTimeout = () => {
				if (!typingTimeoutRef.current) {
					return;
				}
				clearTimeout(typingTimeoutRef.current);
				typingTimeoutRef.current = setTimeout(() => {
					setIsTyping(false);
					setStatus(null);
					typingTimeoutRef.current = null;
				}, TYPING_TIMEOUT);
			};

			// Wire message handler
			const handleMessage = createMessageHandler({
				isStoppedRef,
				hasUserMessageRef,
				typingTimeoutRef,
				setIsTyping,
				setStatus,
				setMessages,
				setConversationId,
				setError,
				saveSessionId,
				saveConversationId,
				bumpTypingTimeout,
			});

			ws.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					handleMessage(data);
				} catch (err) {
					// eslint-disable-next-line no-console
					console.error("[AI Chat] Error parsing WebSocket message:", err);
				}
			};

			ws.onerror = () => {
				connectingRef.current = false;
				setIsConnecting(false);
				// Do not set "failed" here; onclose will set "reconnecting" or "failed" after retries.
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

				// Rate-limited (4008): terminal. Backend already sent the structured
				// `rate_limited` text frame (rendered by messageHandler via the generic
				// fallback). Reconnecting would just hit the same limit again until the
				// reset window passes, so cancel any pending backoff and do not retry.
				// manualRetry() remains available if the user explicitly chooses to try
				// after the reset.
				if (event.code === WS_CLOSE_RATE_LIMITED) {
					if (reconnectTimeoutRef.current) {
						clearTimeout(reconnectTimeoutRef.current);
						reconnectTimeoutRef.current = null;
					}
					reconnectAttempts.current = 0;
					setRetryAttempt(0);
					setNextRetryAt(null);
					setConnectionState("rate_limited");
					return;
				}

				// Auth failure (4000/4001) or client-side detected token expiry: clear config so next connect fetches fresh JWT (throttled by cooldown)
				const isAuthClose =
					event.code === WS_CLOSE_AUTH_FAILED || event.code === WS_CLOSE_MISSING_TOKEN;
				const jwt = configRef.current?.jarvis_jwt;
				const expMs = jwt ? getJwtExpirationMs(jwt) : null;
				const tokenExpired = expMs != null && expMs < Date.now() + JWT_EXPIRED_BUFFER_MS;
				if (isAuthClose || tokenExpired) {
					const now = Date.now();
					const outsideAuthCooldown =
						lastAuthRefreshAt.current == null ||
						now - lastAuthRefreshAt.current >= AUTH_REFRESH_COOLDOWN_MS;
					if (outsideAuthCooldown) {
						configRef.current = null;
						reconnectAttempts.current = 0;
						lastAuthRefreshAt.current = now;
					}
				}

				// Exponential backoff with cap + jitter: reconnect only if not normal close and under max attempts.
				// Skip auto-reconnect while the device is offline — the online listener will trigger a
				// reconnect immediately when the network returns, so burning attempts here is wasted.
				// Read navigator directly (not the React state) because state from this closure may be
				// stale by the time onclose fires; navigator.onLine is always the live value.
				const offlineNow =
					typeof navigator !== "undefined" && navigator && navigator.onLine === false;
				if (
					event.code !== 1000 &&
					!offlineNow &&
					reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS
				) {
					reconnectAttempts.current++;
					setRetryAttempt(reconnectAttempts.current);
					setConnectionState("reconnecting");
					const baseDelay = Math.min(
						MAX_RECONNECT_DELAY,
						RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current - 1)
					);
					const jitter = baseDelay * RECONNECT_JITTER_RATIO * (Math.random() * 2 - 1);
					const delay = Math.max(0, Math.round(baseDelay + jitter));
					setNextRetryAt(Date.now() + delay);
					reconnectTimeoutRef.current = setTimeout(() => {
						setNextRetryAt(null);
						reconnectTimeoutRef.current = null;
						connect();
					}, delay);
				} else if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
					setNextRetryAt(null);
					setConnectionState("failed");
					try {
						sessionStorage.setItem(`${keyPrefix}-connection-failed`, "1");
					} catch (e) {
						// ignore
					}
				} else {
					setNextRetryAt(null);
					setConnectionState("disconnected");
				}
			};
		} catch (connectError) {
			connectingRef.current = false;
			// Config/token failures expected when Hiive unavailable or debug token not set
			if (typeof console !== "undefined" && console.warn) {
				// eslint-disable-next-line no-console
				console.warn("[AI Chat] Connection failed:", connectError?.message || connectError);
			}
			setIsConnecting(false);
			setNextRetryAt(null);
			setConnectionState("failed");
			try {
				sessionStorage.setItem(`${keyPrefix}-connection-failed`, "1");
			} catch (e) {
				// ignore
			}
		}
	}, [
		configEndpoint,
		consumer,
		consumerType,
		keyPrefix,
		saveSessionId,
		saveConversationId,
		MAX_RECONNECT_ATTEMPTS,
		RECONNECT_DELAY,
		MAX_RECONNECT_DELAY,
		RECONNECT_JITTER_RATIO,
		TYPING_TIMEOUT,
		JWT_REFRESH_BUFFER_MS,
		JWT_REFRESH_MIN_DELAY_MS,
		JWT_PROACTIVE_REFRESH_COOLDOWN_MS,
		AUTH_REFRESH_COOLDOWN_MS,
		JWT_EXPIRED_BUFFER_MS,
		JWT_PROACTIVE_REFRESH_DEFER_MS,
	]);

	// ---------------------------------------------------------------------------
	// Ref sync effects — Keep refs in sync so callbacks (e.g. sendMessage) see latest
	// values without needing them in dependency arrays.
	// ---------------------------------------------------------------------------
	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	useEffect(() => {
		connectionStateRef.current = connectionState;
	}, [connectionState]);

	useEffect(() => {
		isTypingRef.current = isTyping;
	}, [isTyping]);

	// ---------------------------------------------------------------------------
	// Unmount cleanup — Clear timers so no callbacks run after unmount.
	// ---------------------------------------------------------------------------
	useEffect(() => {
		return () => {
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
				reconnectTimeoutRef.current = null;
			}
			if (jwtRefreshTimeoutRef.current) {
				clearTimeout(jwtRefreshTimeoutRef.current);
				jwtRefreshTimeoutRef.current = null;
			}
		};
	}, []);

	// ---------------------------------------------------------------------------
	// Network + visibility recovery — Watch the device's online state and the document's
	// visibility. When the network comes back or the user returns to the tab, eagerly try
	// to reconnect rather than waiting out the exponential backoff (which can be tens of
	// seconds at high attempt counts) or sitting permanently in "failed" once we've exhausted
	// the retry budget. Only acts when autoConnect is true, so consumers that explicitly
	// manage connection lifecycle aren't surprised by background reconnects.
	//
	// Loop guards: connect() is idempotent (returns early on OPEN/CONNECTING/connectingRef),
	// the offline branch only cancels timers (it does not actively close the socket), and the
	// visibility branch only acts when the socket is provably gone.
	// ---------------------------------------------------------------------------
	useEffect(() => {
		if (!autoConnect) {
			return undefined;
		}
		if (typeof window === "undefined") {
			return undefined;
		}

		const isSocketDead = () =>
			!wsRef.current ||
			(wsRef.current.readyState !== WebSocket.OPEN &&
				wsRef.current.readyState !== WebSocket.CONNECTING);

		const tryReconnect = () => {
			if (connectingRef.current) {
				return;
			}
			if (!isSocketDead()) {
				return;
			}
			// Rate-limited is terminal — online/visibility transitions must not silently
			// reconnect and re-trigger the gateway limit. User can manualRetry() after reset.
			if (connectionStateRef.current === "rate_limited") {
				return;
			}
			// Cancel any pending backoff so we attempt immediately rather than waiting.
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
				reconnectTimeoutRef.current = null;
			}
			reconnectAttempts.current = 0;
			setRetryAttempt(0);
			setNextRetryAt(null);
			if (connectRef.current) {
				connectRef.current();
			}
		};

		const handleOnline = () => {
			setIsOffline(false);
			tryReconnect();
		};

		const handleOffline = () => {
			setIsOffline(true);
			// Stop scheduled reconnects while we know the network is down — they'll burn
			// retry budget and leave the user in "failed" by the time the network returns.
			// The browser will close the socket on its own; we don't force-close here so we
			// don't race with onclose's reconnect bookkeeping.
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
				reconnectTimeoutRef.current = null;
			}
			setNextRetryAt(null);
		};

		const handleVisibilityChange = () => {
			if (typeof document === "undefined") {
				return;
			}
			if (document.visibilityState !== "visible") {
				return;
			}
			// Only act if the network looks healthy — avoids attempting while offline.
			if (typeof navigator !== "undefined" && navigator.onLine === false) {
				return;
			}
			tryReconnect();
		};

		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);
		if (typeof document !== "undefined") {
			document.addEventListener("visibilitychange", handleVisibilityChange);
		}

		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
			if (typeof document !== "undefined") {
				document.removeEventListener("visibilitychange", handleVisibilityChange);
			}
		};
	}, [autoConnect]);

	// ---------------------------------------------------------------------------
	// On transition to "failed", append assistant fallback message so user sees error state.
	// Guard: only inject the fallback when the user has actually engaged (sent a message).
	// Otherwise a connection that fails on initial mount would surface "Sorry, I don't have
	// any information on this yet." even though the user hasn't asked anything — confusing
	// and looks like a hallucination. Pre-engagement failures stay silent here; the welcome
	// screen / connection state UI handles surfacing the issue.
	// ---------------------------------------------------------------------------
	useEffect(() => {
		if (connectionState !== "failed" || prevConnectionStateRef.current === "failed") {
			prevConnectionStateRef.current = connectionState;
			return;
		}
		prevConnectionStateRef.current = connectionState;

		const currentMessages = messagesRef.current || [];
		const hasAnyUserMessage = currentMessages.some(
			(m) => (m.role === "user" || m.type === "user") && m.content && String(m.content).trim()
		);
		if (!hasAnyUserMessage) {
			// Still clean up transient state, but skip appending the fallback message.
			setError(null);
			setCurrentResponse("");
			setIsTyping(false);
			setStatus(null);
			if (typingTimeoutRef.current) {
				clearTimeout(typingTimeoutRef.current);
				typingTimeoutRef.current = null;
			}
			return;
		}

		const defaultFallback = __(
			"Sorry, we couldn't connect. Please try again later or contact support.",
			"wp-module-ai-chat"
		);
		setMessages((prev) => {
			const last = prev.length > 0 ? prev[prev.length - 1] : null;
			const isLastUser = last && (last.role === "user" || last.type === "user");
			const fallbackContent =
				typeof getConnectionFailedFallbackMessage === "function"
					? getConnectionFailedFallbackMessage(isLastUser ? last.content : "")
					: defaultFallback;
			return [
				...prev,
				{
					id: `msg-${Date.now()}-fallback`,
					role: "assistant",
					type: "assistant",
					content: fallbackContent,
					timestamp: new Date(),
					// isFallback distinguishes a connection-failure notice from a real AI reply.
					// The UI uses this to keep the avatar visible (the consecutive-assistant
					// rule otherwise hides it) so the message reads as a system delivery,
					// not a continuation of the previous AI turn.
					isFallback: true,
				},
			];
		});
		setError(null);
		setCurrentResponse("");
		setIsTyping(false);
		setStatus(null);
		if (typingTimeoutRef.current) {
			clearTimeout(typingTimeoutRef.current);
			typingTimeoutRef.current = null;
		}
	}, [connectionState, getConnectionFailedFallbackMessage]);

	// ---------------------------------------------------------------------------
	// sendMessage(message, convId?) — If connection failed: append user + fallback message.
	// If not connected: append user message (if new), then connect. If connected: append
	// user message (if new), set typing, send { type: 'chat', message } with conversationId.
	// ---------------------------------------------------------------------------
	const sendMessage = useCallback(
		(message, convId = null) => {
			isStoppedRef.current = false;
			hasUserMessageRef.current = true;

			// Rate-limited is terminal: appending the user message without auto-connecting
			// avoids re-hitting the gateway limit on every send. The rate_limited assistant
			// message above the user input already explains the reset window.
			if (connectionStateRef.current === "rate_limited" && !convId) {
				const userMessage = {
					id: `msg-${Date.now()}`,
					role: "user",
					type: "user",
					content: message,
					timestamp: new Date(),
					sessionId: sessionIdRef.current,
				};
				setMessages((prev) => [...prev, userMessage]);
				return;
			}

			const isFailed =
				connectionStateRef.current === "failed" ||
				(reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS &&
					(!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN));
			if (isFailed && !convId) {
				const userMsgId = `msg-${Date.now()}`;
				const fallbackId = `${userMsgId}-fallback`;
				const userMessage = {
					id: userMsgId,
					role: "user",
					type: "user",
					content: message,
					timestamp: new Date(),
					sessionId: sessionIdRef.current,
					// status: "failed" lets the UI render a per-message error treatment + Retry
					// affordance. fallbackId points to the assistant fallback so the retry handler
					// can remove both atomically before re-attempting.
					status: "failed",
					fallbackMessageId: fallbackId,
				};
				const fallbackContent =
					typeof getConnectionFailedFallbackMessage === "function"
						? getConnectionFailedFallbackMessage(message)
						: __(
								"Sorry, we couldn't connect. Please try again later or contact support.",
								"wp-module-ai-chat"
							);
				setMessages((prev) => [
					...prev,
					userMessage,
					{
						id: fallbackId,
						role: "assistant",
						type: "assistant",
						content: fallbackContent,
						timestamp: new Date(),
						// See note on isFallback in the connection-state transition effect:
						// keeps the avatar visible so a system notice doesn't visually
						// merge with a previous assistant turn.
						isFallback: true,
					},
				]);
				setError(null);
				setCurrentResponse("");
				setIsTyping(false);
				setStatus(null);
				return;
			}

			if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
				if (!convId) {
					const userMessage = {
						id: `msg-${Date.now()}`,
						role: "user",
						type: "user",
						content: message,
						timestamp: new Date(),
						sessionId: sessionIdRef.current,
					};
					setMessages((prev) => [...prev, userMessage]);
				}
				// Trigger connect when not connected (disconnected or reconnecting) so message can be sent once open
				connect();
				return;
			}

			if (!convId) {
				const userMessage = {
					id: `msg-${Date.now()}`,
					role: "user",
					type: "user",
					content: message,
					timestamp: new Date(),
					sessionId: sessionIdRef.current,
				};
				setMessages((prev) => [...prev, userMessage]);
				setCurrentResponse("");
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

			const payload = { type: "chat", message };

			if (convId) {
				payload.conversationId = convId;
			} else if (conversationId) {
				payload.conversationId = conversationId;
			}

			wsRef.current.send(JSON.stringify(payload));
		},
		[
			conversationId,
			connect,
			getConnectionFailedFallbackMessage,
			MAX_RECONNECT_ATTEMPTS,
			TYPING_TIMEOUT,
		]
	);

	// ---------------------------------------------------------------------------
	// retryFailedMessage(messageId) — Re-attempts a previously failed user send.
	// Strategy: remove the failed user message AND its paired assistant fallback (so the
	// thread doesn't accrete duplicates), then call sendMessage with the original content.
	// If the connection is still down, the new send will hit the same failed branch and
	// re-append a fresh failed pair; if recovery has happened, it sends normally.
	// ---------------------------------------------------------------------------
	const retryFailedMessage = useCallback(
		(messageId) => {
			if (!messageId) {
				return;
			}
			// Resolve the failed message via a ref so the lookup is side-effect-free —
			// the setMessages updater stays a pure function (safe under React strict mode).
			const target = (messagesRef.current || []).find((m) => m.id === messageId);
			if (!target || target.status !== "failed") {
				return;
			}
			const contentToResend = target.content || "";
			const fallbackId = target.fallbackMessageId || null;
			setMessages((prev) => prev.filter((m) => m.id !== messageId && m.id !== fallbackId));
			if (contentToResend) {
				// Defer so the state removal is committed before sendMessage appends the new pair.
				setTimeout(() => sendMessage(contentToResend), 0);
			}
		},
		[sendMessage]
	);

	// ---------------------------------------------------------------------------
	// sendSystemMessage(message) — Sends a system/backend message over the open socket
	// (e.g. for handoff or context). Requires connection; sets typing until response.
	// ---------------------------------------------------------------------------
	const sendSystemMessage = useCallback(
		(message) => {
			if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
				// eslint-disable-next-line no-console
				console.warn("[AI Chat] Cannot send system message - not connected");
				return;
			}

			const payload = { type: "chat", message };

			if (conversationId) {
				payload.conversationId = conversationId;
			}

			setIsTyping(true);
			setCurrentResponse("");

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
		[conversationId, TYPING_TIMEOUT]
	);

	// ---------------------------------------------------------------------------
	// disconnect() — Close WebSocket, clear reconnect and typing timeouts, set state to disconnected.
	// Also zero the reconnect-attempt counter so a subsequent reconnect starts from a clean slate
	// rather than carrying forward retries from a previous lifecycle (which would shorten the
	// effective retry budget and surface "failed" sooner than expected).
	// ---------------------------------------------------------------------------
	const disconnect = useCallback(() => {
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}
		if (jwtRefreshTimeoutRef.current) {
			clearTimeout(jwtRefreshTimeoutRef.current);
			jwtRefreshTimeoutRef.current = null;
		}
		if (typingTimeoutRef.current) {
			clearTimeout(typingTimeoutRef.current);
			typingTimeoutRef.current = null;
		}
		if (wsRef.current) {
			wsRef.current.close(1000, "User disconnected");
			wsRef.current = null;
		}
		reconnectAttempts.current = 0;
		setRetryAttempt(0);
		setNextRetryAt(null);
		setIsConnected(false);
		setIsConnecting(false);
		setConnectionState("disconnected");
	}, []);

	// Ref sync — Keep connect/disconnect refs in sync so callbacks see latest without dependency arrays.
	useEffect(() => {
		connectRef.current = connect;
	}, [connect]);
	useEffect(() => {
		disconnectRef.current = disconnect;
	}, [disconnect]);

	// ---------------------------------------------------------------------------
	// setSessionId(sid) / getSessionId() — Update or read current session ID (used by messageHandler and history).
	// ---------------------------------------------------------------------------
	const setSessionId = useCallback((sid) => {
		sessionIdRef.current = sid ?? null;
	}, []);

	const getSessionId = useCallback(() => sessionIdRef.current ?? null, []);

	// ---------------------------------------------------------------------------
	// loadConversation(msgs, convId, sessId) — Replace messages, conversationId, sessionId
	// with loaded history. If already connected, persist new ids and reconnect so backend uses them.
	// ---------------------------------------------------------------------------
	const loadConversation = useCallback(
		(msgs, convId, sessId) => {
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
			setCurrentResponse("");

			// If we're connected, persist the loaded session/conv and reconnect so the backend uses them
			if (sessId !== null && sessId !== undefined && wsRef.current?.readyState === WebSocket.OPEN) {
				try {
					localStorage.setItem(SESSION_STORAGE_KEY, sessId);
					if (convId !== null && convId !== undefined) {
						localStorage.setItem(CONVERSATION_STORAGE_KEY, convId);
					}
				} catch (err) {
					// eslint-disable-next-line no-console
					console.warn("[AI Chat] Failed to persist session for history load:", err);
				}
				disconnect();
				connect();
			}
		},
		[connect, disconnect, SESSION_STORAGE_KEY, CONVERSATION_STORAGE_KEY]
	);

	// ---------------------------------------------------------------------------
	// stopRequest() — Set stopped flag and clear typing; messageHandler checks isStoppedRef and stops appending.
	// ---------------------------------------------------------------------------
	const stopRequest = useCallback(() => {
		isStoppedRef.current = true;
		setIsTyping(false);
		setStatus(null);
		setCurrentResponse("");
		if (typingTimeoutRef.current) {
			clearTimeout(typingTimeoutRef.current);
			typingTimeoutRef.current = null;
		}
	}, []);

	// ---------------------------------------------------------------------------
	// clearApprovalRequest() — Clear any pending tool-approval UI. clearTyping() — Clear typing state and timeout.
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
	// addAssistantMessage(content) — Append an assistant message (e.g. error or notice).
	// Normalizes content to string (handles object/undefined).
	// ---------------------------------------------------------------------------
	const addAssistantMessage = useCallback((content) => {
		let contentString;
		if (content === null || content === undefined) {
			contentString = __("No content provided.", "wp-module-ai-chat");
		} else if (typeof content === "object") {
			try {
				contentString = JSON.stringify(content, null, 2);
			} catch (e) {
				// eslint-disable-next-line no-console
				console.warn("[useNfdAgentsWebSocket] Failed to stringify content object:", e);
				contentString = String(content);
			}
		} else {
			contentString = String(content);
		}

		setMessages((prev) => [
			...prev,
			{
				id: `msg-${Date.now()}`,
				role: "assistant",
				type: "assistant",
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
	// updateMessage(messageIdOrPredicate, updater) — Update message(s): pass id or (msg) => boolean, then (msg) => newMsg.
	// ---------------------------------------------------------------------------
	const updateMessage = useCallback((messageIdOrPredicate, updater) => {
		setMessages((prev) =>
			prev.map((msg) => {
				const shouldUpdate =
					typeof messageIdOrPredicate === "function"
						? messageIdOrPredicate(msg)
						: msg.id === messageIdOrPredicate;
				return shouldUpdate ? updater(msg) : msg;
			})
		);
	}, []);

	// ---------------------------------------------------------------------------
	// clearChatHistory() — Clear localStorage, reset all state/refs, close socket, cancel timeouts.
	// ---------------------------------------------------------------------------
	const clearChatHistory = useCallback(() => {
		try {
			clearChatStorage(STORAGE_KEY, CONVERSATION_STORAGE_KEY, SESSION_STORAGE_KEY);

			setMessages([]);
			setConversationId(null);
			setApprovalRequest(null);
			setIsTyping(false);
			setStatus(null);
			setCurrentResponse("");
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
			if (jwtRefreshTimeoutRef.current) {
				clearTimeout(jwtRefreshTimeoutRef.current);
				jwtRefreshTimeoutRef.current = null;
			}

			reconnectAttempts.current = 0;
		} catch (err) {
			// eslint-disable-next-line no-console
			console.warn("[AI Chat] Failed to clear chat history:", err);
		}
	}, [STORAGE_KEY, CONVERSATION_STORAGE_KEY, SESSION_STORAGE_KEY]);

	// ---------------------------------------------------------------------------
	// manualRetry() — Reset reconnect count and call connect() (e.g. after "Retry" button).
	// ---------------------------------------------------------------------------
	const manualRetry = useCallback(() => {
		reconnectAttempts.current = 0;
		setRetryAttempt(0);
		setError(null);
		connect();
	}, [connect]);

	// ---------------------------------------------------------------------------
	// Effects: autoConnect — On mount or when autoConnect/connectionState changes, connect or disconnect.
	// Skips connect when already failed or connecting; uses ref to avoid running connect on every state change.
	// ---------------------------------------------------------------------------
	useEffect(() => {
		const previousAutoConnect = previousAutoConnectRef.current;

		if (previousAutoConnect === null) {
			previousAutoConnectRef.current = autoConnect;
			if (autoConnect && connectionState !== "failed" && !connectingRef.current) {
				if (
					!wsRef.current ||
					(wsRef.current.readyState !== WebSocket.OPEN &&
						wsRef.current.readyState !== WebSocket.CONNECTING)
				) {
					connect();
				}
			}
			return;
		}

		if (previousAutoConnect === autoConnect) {
			return;
		}

		previousAutoConnectRef.current = autoConnect;

		if (autoConnect) {
			if (
				!connectingRef.current &&
				(!wsRef.current ||
					(wsRef.current.readyState !== WebSocket.OPEN &&
						wsRef.current.readyState !== WebSocket.CONNECTING))
			) {
				connect();
			}
		} else {
			disconnect();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [autoConnect, connectionState]);

	// ---------------------------------------------------------------------------
	// Effects: persist messages — On messages change, write to localStorage. Skip full persist on first
	// mount (initial load already in state) but do persist if there are meaningful user messages.
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
	// Effects: persist conversation ID — Sync conversationId to localStorage when it changes.
	// ---------------------------------------------------------------------------
	useEffect(() => {
		persistConversationId(CONVERSATION_STORAGE_KEY, conversationId);
	}, [conversationId, CONVERSATION_STORAGE_KEY]);

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------
	return {
		messages,
		setMessages,
		setConversationId,
		setSessionId,
		loadConversation,
		getSessionId,
		sendMessage,
		retryFailedMessage,
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
		// Wall-clock ms timestamp of the next scheduled reconnect attempt. Null when no
		// reconnect is pending. Consumers can render a countdown by subtracting Date.now().
		nextRetryAt,
		manualRetry,
		// True when the OS reports the device is offline (navigator.onLine === false).
		// Updated in real time from window `online`/`offline` events. Distinct from
		// `connectionState === "disconnected"`, which can also occur for non-network reasons
		// (clean close, initial mount). Use this to render an offline-specific UI.
		isOffline,
	};
};

export default useNfdAgentsWebSocket;
