/**
 * Archive a conversation to localStorage for later retrieval in chat history.
 * Called when user clicks "New Chat" to preserve the current conversation.
 *
 * @param {Array}  messages           - Array of message objects
 * @param {string} sessionId          - Session ID for the conversation
 * @param {string} conversationId    - Conversation ID from backend
 * @param {string} storageNamespace   - e.g. 'help_center', 'editor_chat'
 * @param {Object} [options]         - Optional settings
 * @param {number} [options.maxHistoryItems=3] - Max number of chats to keep in archive
 */
import { getChatHistoryStorageKeys } from '../../config/constants';

export function archiveConversation(
	messages,
	sessionId,
	conversationId,
	storageNamespace,
	options = {}
) {
	if (!messages || messages.length === 0) {
		return;
	}

	const hasMeaningful = messages.some(
		(m) =>
			(m.role === 'user' || m.type === 'user') &&
			m.content &&
			String(m.content).trim()
	);
	if (!hasMeaningful) {
		return;
	}

	const maxHistoryItems = options.maxHistoryItems ?? 3;
	const keys = getChatHistoryStorageKeys(storageNamespace);

	try {
		const archive = JSON.parse(
			localStorage.getItem(keys.archive) || '[]'
		);
		archive.unshift({
			sessionId,
			conversationId,
			messages: messages.map((m) => ({
				...m,
				timestamp:
					m.timestamp instanceof Date
						? m.timestamp.toISOString()
						: m.timestamp,
			})),
			archivedAt: new Date().toISOString(),
		});
		localStorage.setItem(
			keys.archive,
			JSON.stringify(archive.slice(0, maxHistoryItems))
		);
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn('[Chat History] Failed to archive conversation:', err);
	}
}
