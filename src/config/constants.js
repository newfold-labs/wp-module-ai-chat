/**
 * Constants Configuration
 * 
 * Centralized constants for the AI Chat module.
 * All magic numbers, timeouts, and UI values should be defined here.
 */

/**
 * NFD Agents WebSocket Configuration
 * Constants for WebSocket connection, reconnection, and storage
 */
export const NFD_AGENTS_WEBSOCKET = {
	MAX_RECONNECT_ATTEMPTS: 5,
	RECONNECT_DELAY: 1000, // Base delay in milliseconds
	TYPING_TIMEOUT: 60000, // 60 seconds - timeout to hide typing indicator if no response
	STORAGE_KEY_PATTERN: 'nfd-ai-chat-{storageNamespace}-history',
	CONVERSATION_STORAGE_KEY_PATTERN: 'nfd-ai-chat-{storageNamespace}-conversation-id',
	SESSION_STORAGE_KEY_PATTERN: 'nfd-ai-chat-{storageNamespace}-session-id',
	ARCHIVE_STORAGE_KEY_PATTERN: 'nfd-ai-chat-{storageNamespace}-archive',
};

/**
 * Get localStorage keys for chat history and archive for a given storage namespace.
 * Must match the keys used in useNfdAgentsWebSocket for the same consumer.
 *
 * @param {string} storageNamespace - e.g. 'help_center', 'editor_chat'
 * @return {{ history: string, conversationId: string, sessionId: string, archive: string }}
 */
export const getChatHistoryStorageKeys = (storageNamespace) => ({
	history: `nfd-ai-chat-${storageNamespace}-history`,
	conversationId: `nfd-ai-chat-${storageNamespace}-conversation-id`,
	sessionId: `nfd-ai-chat-${storageNamespace}-session-id`,
	archive: `nfd-ai-chat-${storageNamespace}-archive`,
});

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
