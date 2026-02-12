/**
 * NFD Agents WebSocket Configuration
 *
 * Constants for WebSocket connection, reconnection, and typing indicator timeout.
 * Storage key construction lives in storageKeys.js (getChatHistoryStorageKeys).
 */
export const NFD_AGENTS_WEBSOCKET = {
	MAX_RECONNECT_ATTEMPTS: 5,
	RECONNECT_DELAY: 1000, // Base delay between reconnect attempts (ms)
	TYPING_TIMEOUT: 60000, // Hide typing indicator if no response within this time (ms)
};
