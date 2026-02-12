/**
 * NFD Agents WebSocket Configuration
 *
 * Constants for WebSocket connection, reconnection, and storage key patterns.
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
