/**
 * NFD Agents Storage Key Constants
 *
 * Site-scoped localStorage key construction and site ID management.
 * Used by useNfdAgentsWebSocket, archiveConversation, and ChatHistoryList.
 */

/**
 * Get the cached site ID from localStorage.
 * Returns '' if not yet cached (backwards compatible with pre-migration keys).
 *
 * @return {string} Cached site ID or empty string
 */
export const getSiteId = () => {
	try {
		return localStorage.getItem('nfd-ai-chat-site-id') || '';
	} catch (e) {
		return '';
	}
};

/**
 * Cache the site ID in localStorage.
 *
 * @param {string} id Site ID to cache
 */
export const setSiteId = (id) => {
	try {
		localStorage.setItem('nfd-ai-chat-site-id', id);
	} catch (e) {
		// ignore storage errors
	}
};

/**
 * Migrate localStorage data from old-prefix keys to new-prefix keys.
 * Only copies if the new key doesn't already have data. Removes old keys after copying.
 *
 * @param {string} oldSiteId Previous site ID ('' for pre-migration keys)
 * @param {string} newSiteId New site ID from config
 * @param {string} consumer Consumer identifier (must match useNfdAgentsWebSocket for same surface)
 */
export const migrateStorageKeys = (oldSiteId, newSiteId, consumer) => {
	const suffixes = ['history', 'conversation-id', 'session-id', 'archive'];
	const oldPrefix = oldSiteId
		? `nfd-ai-chat-${oldSiteId}-${consumer}`
		: `nfd-ai-chat-${consumer}`;
	const newPrefix = `nfd-ai-chat-${newSiteId}-${consumer}`;

	try {
		for (const suffix of suffixes) {
			const oldKey = `${oldPrefix}-${suffix}`;
			const newKey = `${newPrefix}-${suffix}`;
			const oldData = localStorage.getItem(oldKey);
			if (oldData && !localStorage.getItem(newKey)) {
				localStorage.setItem(newKey, oldData);
			}
			if (oldData) {
				localStorage.removeItem(oldKey);
			}
		}
	} catch (e) {
		// ignore storage errors
	}
};

/**
 * Get localStorage keys for chat history and archive for a given consumer.
 * Includes the cached site ID in the key prefix for multisite isolation.
 * Must match the keys used in useNfdAgentsWebSocket for the same consumer.
 *
 * @param {string} consumer - Consumer identifier (must match useNfdAgentsWebSocket for same surface)
 * @return {{ history: string, conversationId: string, sessionId: string, archive: string }}
 */
export const getChatHistoryStorageKeys = (consumer) => {
	const siteId = getSiteId();
	const prefix = siteId
		? `nfd-ai-chat-${siteId}-${consumer}`
		: `nfd-ai-chat-${consumer}`;
	return {
		history: `${prefix}-history`,
		conversationId: `${prefix}-conversation-id`,
		sessionId: `${prefix}-session-id`,
		archive: `${prefix}-archive`,
	};
};
