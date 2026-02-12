/**
 * Constants Configuration
 *
 * Centralized constants for the AI Chat module.
 * All magic numbers, timeouts, and UI values should be defined here.
 *
 * NFD Agents-specific constants have been moved to:
 * - src/constants/nfdAgents/websocket.js    (NFD_AGENTS_WEBSOCKET)
 * - src/constants/nfdAgents/storageKeys.js  (getSiteId, setSiteId, migrateStorageKeys, getChatHistoryStorageKeys)
 * - src/constants/nfdAgents/typingStatus.js (TYPING_STATUS, getStatusForEventType)
 */

/**
 * Approval Dialog Configuration
 * Constants for approval request handling
 */
export const APPROVAL = {
	TIMEOUT: 5 * 60 * 1000, // 5 minutes in milliseconds
};

/**
 * UI Constants
 * Z-index, dimensions, font weights, and other UI-related values
 */
export const UI = {
	Z_INDEX_MODAL: 10000,
	MAX_WIDTH_DIALOG: '500px',
	FONT_WEIGHT_MEDIUM: '500',
};

/**
 * Input Component Configuration
 * Constants for chat input behavior
 */
export const INPUT = {
	MAX_HEIGHT: 200, // Maximum textarea height in pixels
	FOCUS_DELAY: 100, // Delay before focusing input in milliseconds
	STOP_DEBOUNCE: 500, // Debounce delay for stop button in milliseconds
};
