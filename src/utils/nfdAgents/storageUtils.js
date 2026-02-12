/**
 * NFD Agents Storage Utilities
 *
 * localStorage persistence operations for chat history, conversation ID,
 * and session ID. Extracted from useNfdAgentsWebSocket for reuse and testability.
 */

/**
 * Check if a messages array contains at least one user message with non-empty content.
 *
 * @param {Array} msgs Messages array
 * @return {boolean}
 */
export const hasMeaningfulUserMessage = (msgs) =>
	Array.isArray(msgs) &&
	msgs.some(
		(m) =>
			(m.role === 'user' || m.type === 'user') &&
			m.content &&
			String(m.content).trim()
	);

/**
 * Restore chat history, conversation ID, and session ID from localStorage.
 *
 * @param {string} storageKey       Key for messages
 * @param {string} conversationKey  Key for conversation ID
 * @param {string} sessionKey       Key for session ID
 * @return {{ messages: Array, conversationId: string|null, sessionId: string|null }}
 */
export const restoreChat = (storageKey, conversationKey, sessionKey) => {
	try {
		const storedMessages = localStorage.getItem(storageKey);
		const storedConversationId = localStorage.getItem(conversationKey);
		const storedSessionId = localStorage.getItem(sessionKey);

		if (storedMessages) {
			const parsedMessages = JSON.parse(storedMessages);
			if (Array.isArray(parsedMessages) && parsedMessages.length > 0) {
				const restoredMessages = parsedMessages.map((msg) => ({
					...msg,
					timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
					animateTyping: false,
				}));
				return {
					messages: restoredMessages,
					conversationId: storedConversationId || null,
					sessionId: storedSessionId || null,
				};
			}
		}
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn('[AI Chat] Failed to restore chat history from localStorage:', err);
	}
	return { messages: [], conversationId: null, sessionId: null };
};

/**
 * Persist messages to localStorage. Removes the key if messages are not meaningful.
 *
 * @param {string} storageKey Key for messages
 * @param {Array}  messages   Messages array
 */
export const persistMessages = (storageKey, messages) => {
	try {
		if (hasMeaningfulUserMessage(messages)) {
			localStorage.setItem(storageKey, JSON.stringify(messages));
		} else {
			localStorage.removeItem(storageKey);
		}
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn('[AI Chat] Failed to save messages to localStorage:', err);
	}
};

/**
 * Persist conversation ID to localStorage. Removes the key when null.
 *
 * @param {string}      conversationKey Key for conversation ID
 * @param {string|null} conversationId  Conversation ID or null
 */
export const persistConversationId = (conversationKey, conversationId) => {
	try {
		if (conversationId) {
			localStorage.setItem(conversationKey, conversationId);
		} else {
			localStorage.removeItem(conversationKey);
		}
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn('[AI Chat] Failed to save conversation ID to localStorage:', err);
	}
};

/**
 * Clear all chat-related keys from localStorage.
 *
 * @param {string} storageKey       Key for messages
 * @param {string} conversationKey  Key for conversation ID
 * @param {string} sessionKey       Key for session ID
 */
export const clearChatStorage = (storageKey, conversationKey, sessionKey) => {
	try {
		localStorage.removeItem(storageKey);
		localStorage.removeItem(conversationKey);
		localStorage.removeItem(sessionKey);
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn('[AI Chat] Failed to clear chat storage:', err);
	}
};
