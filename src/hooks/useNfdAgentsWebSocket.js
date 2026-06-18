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
import { generateSessionId, generateClientMessageId } from "../utils/helpers";

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
	// Outbox of messages awaiting a backend `message_received` ACK, keyed by client_message_id.
	// Each entry: { payload, createdAt, attempts, lastSentAt }. Entries are resent on reconnect
	// (flushOutbox) and on ack-timeout (the sweep), and removed on explicit ACK or when the turn
	// completes (see confirmMessageDelivery).
	const pendingAcksRef = useRef(new Map());
	// True once we've seen any `message_received` ACK this session. Gates the ack-timeout sweep so
	// it never resends/false-fails against a backend that doesn't emit ACKs (feature detection).
	const hasSeenAckRef = useRef(false);
	// setInterval handle for the ack-timeout sweep; non-null only while it's actively watching.
	const ackSweepRef = useRef(null);
	// client_message_id of the user message currently awaiting an assistant response, or null.
	// Drives the response-silence retry affordance (Part 2). Distinct from the outbox, which tracks
	// delivery: a message can be ACKed (out of the outbox) yet still awaiting a response.
	const awaitingResponseRef = useRef(null);

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
	const MAX_ACK_RESEND_ATTEMPTS = NFD_AGENTS_WEBSOCKET.MAX_ACK_RESEND_ATTEMPTS;
	const ACK_RESEND_TTL_MS = NFD_AGENTS_WEBSOCKET.ACK_RESEND_TTL_MS;
	const MAX_OUTBOX_SIZE = NFD_AGENTS_WEBSOCKET.MAX_OUTBOX_SIZE;
	const ACK_TIMEOUT_MS = NFD_AGENTS_WEBSOCKET.ACK_TIMEOUT_MS;
	const ACK_SWEEP_INTERVAL_MS = NFD_AGENTS_WEBSOCKET.ACK_SWEEP_INTERVAL_MS;

	// ---------------------------------------------------------------------------
	// Callbacks passed to messageHandler (persist session/conversation ID to ref + localStorage)
	// ---------------------------------------------------------------------------
	const saveSessionId = useCallback(
		(sid) => {
			sessionIdRef.current = sid;
			try {
				localStorage.setItem(SESSION_STORAGE_KEY, sid);
			} catch (err) {
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
				console.warn("[AI Chat] Failed to save conversation ID to localStorage:", err);
			}
		},
		[CONVERSATION_STORAGE_KEY]
	);

	// ---------------------------------------------------------------------------
	// Reliable delivery (client_message_id + ACK)
	// ---------------------------------------------------------------------------

	// Surface the per-message Retry affordance on a user message (by client_message_id). Pure
	// state mutation; reuses the existing "failed" treatment (retryFailedMessage re-sends the
	// content as a fresh message, which the backend won't de-dupe).
	const markMessageRetryable = useCallback((clientMessageId) => {
		setMessages((prev) => {
			let changed = false;
			const next = prev.map((m) => {
				if (m.clientMessageId === clientMessageId && m.status !== "failed") {
					changed = true;
					return { ...m, status: "failed" };
				}
				return m;
			});
			return changed ? next : prev;
		});
	}, []);

	// Retire a pending message that cannot be delivered: surface Retry, drop it from the outbox,
	// and — if it was the message we were actively awaiting a response for — stop awaiting and clear
	// the typing indicator/watchdog (that turn is dead). This is the single path for EVERY
	// otherwise-silent drop site (ack-timeout exhaustion, reconnect TTL/budget retirement, and
	// full-outbox eviction), so none of them discard a message without UI feedback. Keying the
	// typing/await teardown on the awaited id means evicting an OLD queued message never disturbs
	// the in-flight turn.
	const retireOutboxEntry = useCallback(
		(clientMessageId) => {
			markMessageRetryable(clientMessageId);
			if (awaitingResponseRef.current === clientMessageId) {
				awaitingResponseRef.current = null;
				setIsTyping(false);
				setStatus(null);
				if (typingTimeoutRef.current) {
					clearTimeout(typingTimeoutRef.current);
					typingTimeoutRef.current = null;
				}
			}
			pendingAcksRef.current.delete(clientMessageId);
		},
		[markMessageRetryable]
	);

	// Add a sent/queued message to the outbox so it can be resent until acknowledged.
	// Bounds the outbox so a long disconnected streak can't grow it without limit.
	const enqueuePendingAck = useCallback(
		(clientMessageId, payload) => {
			if (!clientMessageId) {
				return;
			}
			const outbox = pendingAcksRef.current;
			while (outbox.size >= MAX_OUTBOX_SIZE && outbox.size > 0) {
				const oldestKey = outbox.keys().next().value;
				// Don't silently discard an evicted message — surface Retry so a queued-but-undelivered
				// send can't vanish without the user being able to recover it.
				retireOutboxEntry(oldestKey);
			}
			// lastSentAt: wall-clock of the last successful send (null until first delivery). Drives
			// the ack-timeout sweep (resend if no ACK within ACK_TIMEOUT_MS of lastSentAt).
			outbox.set(clientMessageId, {
				payload,
				createdAt: Date.now(),
				attempts: 0,
				lastSentAt: null,
			});
		},
		[MAX_OUTBOX_SIZE, retireOutboxEntry]
	);

	// Send a payload over the open socket and count it against the message's resend budget.
	// attempts/lastSentAt are updated only on a successful send: a throwing send (rare on an OPEN
	// socket, but possible if it half-closes) must not silently burn the budget and strand the
	// message undelivered. Returns whether the frame was handed to the socket.
	const sendTrackedPayload = useCallback((clientMessageId, payload) => {
		const ws = wsRef.current;
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			return false;
		}
		try {
			ws.send(JSON.stringify(payload));
			const entry = pendingAcksRef.current.get(clientMessageId);
			if (entry) {
				entry.attempts += 1;
				entry.lastSentAt = Date.now();
			}
			return true;
		} catch (err) {
			console.warn("[AI Chat] Failed to send message:", err);
			return false;
		}
	}, []);

	// Response-silence failure: the message WAS delivered but the turn produced no response within
	// the silence window. Surface Retry and hide the indicator, but deliberately leave
	// awaitingResponseRef set so a late reply can still un-flag it (resolveAwaitingResponse). Unlike
	// retireOutboxEntry, it does not touch the outbox (the entry was already cleared on ACK / turn).
	const flagMessageNeedsRetry = useCallback(
		(clientMessageId) => {
			markMessageRetryable(clientMessageId);
			setIsTyping(false);
			setStatus(null);
			if (typingTimeoutRef.current) {
				clearTimeout(typingTimeoutRef.current);
				typingTimeoutRef.current = null;
			}
		},
		[markMessageRetryable]
	);

	// Response-silence watchdog callback. Fires when no assistant event has arrived for the silence
	// window (TYPING_TIMEOUT). Hides the typing indicator and, if a user message is still awaiting a
	// response, surfaces Retry on it. It is bumped by every inbound event (bumpTypingTimeout) and
	// (re)started on the first typing_start, so it only fires on genuine silence — not during long
	// tool calls. We do NOT clear awaitingResponseRef here, so a late reply can still un-flag the
	// message (resolveAwaitingResponse).
	const onResponseSilenceTimeout = useCallback(() => {
		typingTimeoutRef.current = null;
		const awaiting = awaitingResponseRef.current;
		if (awaiting) {
			flagMessageNeedsRetry(awaiting);
			return;
		}
		setIsTyping(false);
		setStatus(null);
	}, [flagMessageNeedsRetry]);

	// (Re)arm the response-silence watchdog. Used by the send path, by flushOutbox when delivering a
	// queued message, and by the message handler on the first typing_start — so the watchdog is
	// consistently active for online sends AND for sends that were queued while offline and
	// delivered later by the reconnect flush (which otherwise never armed it).
	const armResponseTimeout = useCallback(() => {
		if (typingTimeoutRef.current) {
			clearTimeout(typingTimeoutRef.current);
		}
		typingTimeoutRef.current = setTimeout(onResponseSilenceTimeout, TYPING_TIMEOUT);
	}, [onResponseSilenceTimeout, TYPING_TIMEOUT]);

	const stopAckSweep = useCallback(() => {
		if (ackSweepRef.current) {
			clearInterval(ackSweepRef.current);
			ackSweepRef.current = null;
		}
	}, []);

	// One sweep of the outbox for ack-timed-out messages. Resends any whose ACK hasn't arrived
	// within ACK_TIMEOUT_MS of their last send; once the per-message budget is spent, gives up and
	// flags the message for retry. Self-stops when there's nothing to watch or the socket isn't
	// open (a reconnect's flush restarts it), so the interval never runs at idle.
	const ackSweepTick = useCallback(() => {
		const outbox = pendingAcksRef.current;
		const ws = wsRef.current;
		if (outbox.size === 0 || !ws || ws.readyState !== WebSocket.OPEN) {
			stopAckSweep();
			return;
		}
		const now = Date.now();
		outbox.forEach((entry, id) => {
			// Not yet sent (queued while offline): the reconnect flush owns its first delivery.
			if (entry.attempts === 0 || entry.lastSentAt === null) {
				return;
			}
			if (now - entry.lastSentAt < ACK_TIMEOUT_MS) {
				return;
			}
			if (entry.attempts >= MAX_ACK_RESEND_ATTEMPTS) {
				// Budget spent with no ACK — retire as undeliverable (surfaces Retry + clears state).
				retireOutboxEntry(id);
				return;
			}
			sendTrackedPayload(id, entry.payload);
		});
	}, [
		ACK_TIMEOUT_MS,
		MAX_ACK_RESEND_ATTEMPTS,
		sendTrackedPayload,
		retireOutboxEntry,
		stopAckSweep,
	]);

	// Start the ack-timeout sweep if not already running. Gated on hasSeenAckRef so we never resend
	// or false-fail against a backend that doesn't emit message_received — the sweep is armed only
	// after we've observed at least one ACK this session (feature detection).
	const startAckSweep = useCallback(() => {
		if (ackSweepRef.current || !hasSeenAckRef.current) {
			return;
		}
		ackSweepRef.current = setInterval(ackSweepTick, ACK_SWEEP_INTERVAL_MS);
	}, [ackSweepTick, ACK_SWEEP_INTERVAL_MS]);

	// Resend any outbox entries over the open socket. Called from ws.onopen so messages
	// that were queued while disconnected — or sent but never acknowledged before the socket
	// dropped — are delivered once the connection is (re)established. Resends reuse the original
	// client_message_id, so a backend with durable de-dupe enabled will not double-process them.
	const flushOutbox = useCallback(() => {
		const ws = wsRef.current;
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			return;
		}
		const now = Date.now();
		pendingAcksRef.current.forEach((entry, id) => {
			// Retire only messages we've already tried at least once: budget exhausted, or aged
			// past the TTL. A message queued while offline (attempts === 0) must still get its
			// first send no matter how long the outage lasted — so it is never TTL-dropped before
			// it has ever left the client.
			const exhausted = entry.attempts >= MAX_ACK_RESEND_ATTEMPTS;
			const expired = entry.attempts > 0 && now - entry.createdAt > ACK_RESEND_TTL_MS;
			if (exhausted || expired) {
				// Retire as undeliverable rather than dropping silently — surfaces Retry and clears
				// the awaited-turn state if this was the in-flight message.
				retireOutboxEntry(id);
				return;
			}
			sendTrackedPayload(id, entry.payload);
		});
		// Resume ack-timeout watching for anything still outstanding after the flush.
		startAckSweep();
		// Prime the response-silence watchdog for a delivered-but-awaited message (e.g. one queued
		// while offline) so a post-delivery stall still auto-hides the indicator and surfaces Retry.
		if (awaitingResponseRef.current && !typingTimeoutRef.current) {
			armResponseTimeout();
		}
	}, [
		ACK_RESEND_TTL_MS,
		MAX_ACK_RESEND_ATTEMPTS,
		sendTrackedPayload,
		retireOutboxEntry,
		startAckSweep,
		armResponseTimeout,
	]);

	// Resolve the outstanding response wait: stop watching the awaited message and undo any
	// response-silence retry flag we may have surfaced on it (the response did arrive after all —
	// the late-reply race). Called both on the FIRST sign of turn activity (so a turn that responds
	// without a typing_start, e.g. an approval request, is never falsely flagged) and on turn
	// completion. No-op when nothing is awaiting.
	const resolveAwaitingResponse = useCallback(() => {
		const awaiting = awaitingResponseRef.current;
		if (!awaiting) {
			return;
		}
		awaitingResponseRef.current = null;
		setMessages((prev) => {
			let changed = false;
			const next = prev.map((m) => {
				if (m.clientMessageId === awaiting && m.status === "failed") {
					changed = true;
					return { ...m, status: undefined };
				}
				return m;
			});
			return changed ? next : prev;
		});
	}, []);

	// Clear delivered messages from the outbox.
	//   - clientMessageId provided: explicit `message_received` ACK — remove just that entry, mark
	//     the matching user message acknowledged, and record that this backend emits ACKs (which
	//     arms the ack-timeout sweep for subsequent sends via hasSeenAckRef).
	//   - clientMessageId null/omitted: implicit confirmation. A turn-completing event (assistant
	//     content or error) proves the backend received and processed the in-flight message(s), so
	//     clear the whole outbox AND resolve the response wait. This is also the backward-compatible
	//     path for backends that don't emit the ACK.
	const confirmMessageDelivery = useCallback(
		(clientMessageId) => {
			if (clientMessageId) {
				hasSeenAckRef.current = true;
				pendingAcksRef.current.delete(clientMessageId);
				setMessages((prev) => {
					let changed = false;
					const next = prev.map((m) => {
						if (m.clientMessageId === clientMessageId && !m.acknowledged) {
							changed = true;
							return { ...m, acknowledged: true };
						}
						return m;
					});
					return changed ? next : prev;
				});
				return;
			}
			if (pendingAcksRef.current.size > 0) {
				pendingAcksRef.current.clear();
			}
			resolveAwaitingResponse();
		},
		[resolveAwaitingResponse]
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

			// Local-dev only: when the backend is serving NFD_AI_CHAT_JARVIS_DEBUG_TOKEN, it sets
			// bypass_jwt_expiry so the client skips all JWT-expiry handling (pre-connect refetch,
			// proactive refresh, on-close expiry refetch). This lets a hand-crafted local test token
			// — possibly expired or with no `exp` claim — be used as-is without "Token expired,
			// please refresh the page." This can only be true when the debug constant is defined in
			// wp-config.php; the gateway still validates the token server-side.
			const bypassJwtExpiry = !!config.bypass_jwt_expiry;

			// Pre-connect: if JWT is already expired or within buffer, refetch config once
			let refetchedForExpiry = false;
			while (!bypassJwtExpiry && config?.jarvis_jwt) {
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
					const restored = restoreChat(newKeys.history, newKeys.conversationId, newKeys.sessionId);
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
			if (!bypassJwtExpiry && config.jarvis_jwt) {
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
				// Deliver anything queued while disconnected and resend any message that was
				// sent but never acknowledged before the socket dropped.
				flushOutbox();
			};

			// Refresh the typing-indicator auto-hide timer. Only acts when a timer is
			// already pending (i.e., an in-flight request) so background events like
			// session_established before the user sends don't spin up a stray timeout.
			const bumpTypingTimeout = () => {
				if (!typingTimeoutRef.current) {
					return;
				}
				clearTimeout(typingTimeoutRef.current);
				typingTimeoutRef.current = setTimeout(onResponseSilenceTimeout, TYPING_TIMEOUT);
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
				confirmMessageDelivery,
				notifyResponseActivity: resolveAwaitingResponse,
				armResponseTimeout,
				bumpTypingTimeout,
			});

			ws.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					handleMessage(data);
				} catch (err) {
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
				// Stop the ack-timeout sweep deterministically on close so a single connection owns
				// it (the reconnect's flushOutbox restarts it). The outbox is preserved for resend.
				stopAckSweep();

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
				// Local debug token: never treat it as expired (see bypassJwtExpiry in connect()).
				const bypassExpiryOnClose = !!configRef.current?.bypass_jwt_expiry;
				const jwt = configRef.current?.jarvis_jwt;
				const expMs = jwt ? getJwtExpirationMs(jwt) : null;
				const tokenExpired =
					!bypassExpiryOnClose && expMs != null && expMs < Date.now() + JWT_EXPIRED_BUFFER_MS;
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
		confirmMessageDelivery,
		resolveAwaitingResponse,
		flushOutbox,
		stopAckSweep,
		onResponseSilenceTimeout,
		armResponseTimeout,
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
			if (ackSweepRef.current) {
				clearInterval(ackSweepRef.current);
				ackSweepRef.current = null;
			}
			// Also clear the response-silence watchdog so it can't fire setState after unmount.
			if (typingTimeoutRef.current) {
				clearTimeout(typingTimeoutRef.current);
				typingTimeoutRef.current = null;
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
			// Also cancel any pending proactive JWT refresh — firing it while offline would
			// disconnect + try to fetchAgentConfig and end up in "failed" with the network
			// just temporarily down. The next successful connect() reschedules the refresh.
			if (jwtRefreshTimeoutRef.current) {
				clearTimeout(jwtRefreshTimeoutRef.current);
				jwtRefreshTimeoutRef.current = null;
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

			// Per-message client ID: lets the backend ACK (`message_received`) and de-dupe this
			// send, and lets us resend the SAME id on reconnect without double-processing.
			const clientMessageId = generateClientMessageId();
			const payload = { type: "chat", message, client_message_id: clientMessageId };
			if (convId) {
				payload.conversationId = convId;
			} else if (conversationId) {
				payload.conversationId = conversationId;
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
						clientMessageId,
						acknowledged: false,
					};
					setMessages((prev) => [...prev, userMessage]);
					// Mark this as the awaited turn so that, once the reconnect flush delivers it, the
					// response-silence watchdog can target it for Retry. We do NOT arm the timer here —
					// there's no connection yet, so it's armed on delivery (flushOutbox) / first
					// typing_start instead, which prevents a premature fire during the outage.
					awaitingResponseRef.current = clientMessageId;
				}
				// Queue for delivery and trigger connect; ws.onopen flushes the outbox once open.
				enqueuePendingAck(clientMessageId, payload);
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
					clientMessageId,
					acknowledged: false,
				};
				setMessages((prev) => [...prev, userMessage]);
				setCurrentResponse("");
				setIsTyping(true);
				// This message is now awaiting a response; the silence watchdog targets it.
				awaitingResponseRef.current = clientMessageId;

				if (typingTimeoutRef.current) {
					clearTimeout(typingTimeoutRef.current);
				}
				typingTimeoutRef.current = setTimeout(onResponseSilenceTimeout, TYPING_TIMEOUT);
			}

			// Track for ACK/resend, then send. sendTrackedPayload counts the send against the
			// resend cap (MAX_ACK_RESEND_ATTEMPTS) only if the frame actually goes out. Start the
			// ack-timeout sweep so a lost (un-ACKed) frame is resent without waiting for a reconnect.
			enqueuePendingAck(clientMessageId, payload);
			sendTrackedPayload(clientMessageId, payload);
			startAckSweep();
		},
		[
			conversationId,
			connect,
			enqueuePendingAck,
			sendTrackedPayload,
			startAckSweep,
			onResponseSilenceTimeout,
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
				console.warn("[AI Chat] Cannot send system message - not connected");
				return;
			}

			const clientMessageId = generateClientMessageId();
			const payload = { type: "chat", message, client_message_id: clientMessageId };

			if (conversationId) {
				payload.conversationId = conversationId;
			}

			setIsTyping(true);
			setCurrentResponse("");

			if (typingTimeoutRef.current) {
				clearTimeout(typingTimeoutRef.current);
			}
			// System messages have no user bubble to flag, so the silence watchdog only hides the
			// indicator here (awaitingResponseRef is left untouched / null).
			typingTimeoutRef.current = setTimeout(onResponseSilenceTimeout, TYPING_TIMEOUT);

			enqueuePendingAck(clientMessageId, payload);
			sendTrackedPayload(clientMessageId, payload);
			startAckSweep();
		},
		[
			conversationId,
			enqueuePendingAck,
			sendTrackedPayload,
			startAckSweep,
			onResponseSilenceTimeout,
			TYPING_TIMEOUT,
		]
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
		// Stop the ack-timeout sweep and the response watchdog. The outbox itself is intentionally
		// preserved so a reconnect can resend; the reconnect flush restarts the sweep.
		if (ackSweepRef.current) {
			clearInterval(ackSweepRef.current);
			ackSweepRef.current = null;
		}
		awaitingResponseRef.current = null;
		if (wsRef.current) {
			// Detach handlers before close so the orphaned onclose can't fire later and
			// clobber state owned by a connect() that was started right after disconnect
			// (proactive JWT refresh, autoConnect toggle).
			wsRef.current.onclose = null;
			wsRef.current.onopen = null;
			wsRef.current.onerror = null;
			wsRef.current.onmessage = null;
			wsRef.current.close(1000, "User disconnected");
			wsRef.current = null;
		}
		reconnectAttempts.current = 0;
		setRetryAttempt(0);
		setNextRetryAt(null);
		setIsConnected(false);
		setIsConnecting(false);
		// Mirror onclose's safety reset: clear the AI typing indicator and status. Because we
		// detach onclose above to prevent the orphaned cleanup race, the indicator would
		// otherwise stay stuck (e.g. on conversation switch while the AI is mid-response)
		// until the next event or the typing timeout fires.
		setIsTyping(false);
		setStatus(null);
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
			// Switching conversation context: drop pending sends so they aren't resent into the
			// newly loaded conversation, and tear down the sweep + response watchdog.
			pendingAcksRef.current.clear();
			if (ackSweepRef.current) {
				clearInterval(ackSweepRef.current);
				ackSweepRef.current = null;
			}
			awaitingResponseRef.current = null;

			// If we're connected, persist the loaded session/conv and reconnect so the backend uses them
			if (sessId !== null && sessId !== undefined && wsRef.current?.readyState === WebSocket.OPEN) {
				try {
					localStorage.setItem(SESSION_STORAGE_KEY, sessId);
					if (convId !== null && convId !== undefined) {
						localStorage.setItem(CONVERSATION_STORAGE_KEY, convId);
					}
				} catch (err) {
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
		// The in-flight message was already sent; the user chose to abandon this turn, so drop any
		// pending entries to avoid resending a stopped message, stop the sweep, and stop awaiting
		// a response (no retry should be surfaced for an intentionally stopped turn).
		pendingAcksRef.current.clear();
		if (ackSweepRef.current) {
			clearInterval(ackSweepRef.current);
			ackSweepRef.current = null;
		}
		awaitingResponseRef.current = null;
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
		// No longer waiting on a response — don't let the silence watchdog flag a stale target.
		awaitingResponseRef.current = null;
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
			pendingAcksRef.current.clear();
			if (ackSweepRef.current) {
				clearInterval(ackSweepRef.current);
				ackSweepRef.current = null;
			}
			awaitingResponseRef.current = null;

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
