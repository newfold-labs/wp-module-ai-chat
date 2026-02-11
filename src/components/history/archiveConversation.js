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

	// Never archive with both ids null; avoids dedupe removing existing entries
	if (sessionId == null && conversationId == null) {
		return;
	}

	const maxHistoryItems = options.maxHistoryItems ?? 3;
	const keys = getChatHistoryStorageKeys(storageNamespace);

	try {
		const archive = JSON.parse(
			localStorage.getItem(keys.archive) || '[]'
		);
		const newEntry = {
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
		};
		// Dedupe so the same conversation doesn't appear multiple times: by conversationId when set, else by sessionId.
		// This keeps the latest 3 distinct chats and avoids wiping older history when conversationId is null.
		const filtered =
			conversationId != null
				? archive.filter(
						(entry) => entry.conversationId !== conversationId
					)
				: archive.filter((entry) => entry.sessionId !== sessionId);
		filtered.unshift(newEntry);
		localStorage.setItem(
			keys.archive,
			JSON.stringify(filtered.slice(0, maxHistoryItems))
		);
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn('[Chat History] Failed to archive conversation:', err);
	}
}

/**
 * Remove a conversation from the archive (e.g. when user clears the chat).
 *
 * @param {string} conversationId - Conversation ID to remove (can be null)
 * @param {string} sessionId      - Session ID to remove (can be null)
 * @param {string} storageNamespace - e.g. 'help_center', 'editor_chat'
 */
export function removeConversationFromArchive(
	conversationId,
	sessionId,
	storageNamespace
) {
	const keys = getChatHistoryStorageKeys(storageNamespace);
	try {
		const archive = JSON.parse(
			localStorage.getItem(keys.archive) || '[]'
		);
		const filtered = archive.filter(
			(entry) =>
				entry.conversationId !== conversationId ||
				entry.sessionId !== sessionId
		);
		if (filtered.length !== archive.length) {
			localStorage.setItem(keys.archive, JSON.stringify(filtered));
		}
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn('[Chat History] Failed to remove conversation from archive:', err);
	}
}
