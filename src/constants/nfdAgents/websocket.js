/**
 * NFD Agents WebSocket Configuration
 *
 * Constants for WebSocket connection, reconnection, typing indicator timeout,
 * and JWT refresh. Storage key construction lives in storageKeys.js (getChatHistoryStorageKeys).
 */

/** WebSocket close code: authentication failed (e.g. expired token). */
export const WS_CLOSE_AUTH_FAILED = 4000;

/** WebSocket close code: missing authentication token. */
export const WS_CLOSE_MISSING_TOKEN = 4001;

/**
 * WebSocket close code: rate-limited by the gateway.
 * Backend (app/gateway/routers/proxies/websocket_proxy.py) sends a structured
 * `rate_limited` text frame, then closes with this code. Reconnecting will only
 * hit the same limit again until the reset window passes, so the client must
 * treat this as terminal and not auto-retry.
 */
export const WS_CLOSE_RATE_LIMITED = 4008;

/** Buffer (ms) before JWT exp at which to proactively refresh (e.g. 5 min). */
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** Never schedule proactive refresh sooner than this (ms). */
const FIVE_MINUTES_MIN_DELAY_MS = 5 * 60 * 1000;

/** Don't schedule another proactive refresh sooner than this after the last one (ms). */
const ONE_HOUR_MS = 60 * 60 * 1000;

/** Don't clear config + reset attempts on 4000/4001 more than once per this window (ms). */
const AUTH_REFRESH_COOLDOWN_MS = 3 * 60 * 1000;

/** Consider token expired if exp is within this many ms from now (pre-connect check). */
const JWT_EXPIRED_BUFFER_MS = 60 * 1000;

/** When proactive refresh fires during an in-flight reply, reschedule after this many ms. */
const JWT_PROACTIVE_REFRESH_DEFER_MS = 30 * 1000;

export const NFD_AGENTS_WEBSOCKET = {
	MAX_RECONNECT_ATTEMPTS: 5,
	RECONNECT_DELAY: 1000, // Base delay between reconnect attempts (ms)
	MAX_RECONNECT_DELAY: 30000, // Cap exponential backoff so high attempt counts don't push waits into minutes (ms)
	RECONNECT_JITTER_RATIO: 0.2, // Apply ±20% jitter to backoff so multiple tabs don't reconnect in lockstep
	// Hide typing indicator if backend goes silent (no event of any kind) for this long.
	// Any incoming WS event refreshes this window (see messageHandler), so the timer only
	// fires when the backend has truly stopped emitting — not while a long tool call is in flight.
	TYPING_TIMEOUT: 180000,
	// Reliable-delivery (client_message_id ACK) tuning. Each outbound chat frame carries a
	// client_message_id; the backend replies with a `message_received` ACK. Until a message is
	// acknowledged (or the turn completes), it stays in the in-memory outbox and is resent when
	// the socket reopens. Resends reuse the same client_message_id so the backend can de-dupe.
	//
	// MAX_ACK_RESEND_ATTEMPTS counts TOTAL sends (initial + resends), so 3 = initial + 2 resends.
	// ACK_RESEND_TTL_MS bounds how long an unacked message stays eligible for resend.
	// MAX_OUTBOX_SIZE caps outbox growth during a long disconnected streak (oldest dropped first).
	MAX_ACK_RESEND_ATTEMPTS: 3,
	ACK_RESEND_TTL_MS: 60000,
	MAX_OUTBOX_SIZE: 50,
	WS_CLOSE_AUTH_FAILED,
	WS_CLOSE_MISSING_TOKEN,
	WS_CLOSE_RATE_LIMITED,
	JWT_REFRESH_BUFFER_MS: FIVE_MINUTES_MS,
	JWT_REFRESH_MIN_DELAY_MS: FIVE_MINUTES_MIN_DELAY_MS,
	JWT_PROACTIVE_REFRESH_COOLDOWN_MS: ONE_HOUR_MS,
	AUTH_REFRESH_COOLDOWN_MS,
	JWT_EXPIRED_BUFFER_MS,
	JWT_PROACTIVE_REFRESH_DEFER_MS,
};
