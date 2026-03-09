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
	TYPING_TIMEOUT: 60000, // Hide typing indicator if no response within this time (ms)
	WS_CLOSE_AUTH_FAILED,
	WS_CLOSE_MISSING_TOKEN,
	JWT_REFRESH_BUFFER_MS: FIVE_MINUTES_MS,
	JWT_REFRESH_MIN_DELAY_MS: FIVE_MINUTES_MIN_DELAY_MS,
	JWT_PROACTIVE_REFRESH_COOLDOWN_MS: ONE_HOUR_MS,
	AUTH_REFRESH_COOLDOWN_MS,
	JWT_EXPIRED_BUFFER_MS,
	JWT_PROACTIVE_REFRESH_DEFER_MS,
};
