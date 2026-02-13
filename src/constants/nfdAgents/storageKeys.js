/**
 * NFD Agents Storage Key Constants
 *
 * Site-scoped localStorage key construction and site ID management.
 * Used by useNfdAgentsWebSocket, archiveConversation, and ChatHistoryList.
 * Key format: nfd-ai-chat-{siteId}-{consumer}-{suffix} (or nfd-ai-chat-{consumer}-{suffix} when siteId is empty).
 */

/* global localStorage */

const SITE_ID_KEY = "nfd-ai-chat-site-id";

/** Suffixes for consumer-scoped keys. Single source of truth for migrateStorageKeys and getChatHistoryStorageKeys. */
const STORAGE_KEY_SUFFIXES = {
	history: "history",
	conversationId: "conversation-id",
	sessionId: "session-id",
	archive: "archive",
};

/**
 * Get the cached site ID from localStorage.
 * Returns '' if not yet cached (backwards compatible with pre-migration keys).
 *
 * @return {string} Cached site ID or empty string
 */
export const getSiteId = () => {
	try {
		return localStorage.getItem(SITE_ID_KEY) || "";
	} catch {
		return "";
	}
};

/**
 * Cache the site ID in localStorage.
 *
 * @param {string} id Site ID to cache
 */
export const setSiteId = (id) => {
	try {
		localStorage.setItem(SITE_ID_KEY, id);
	} catch {
		// Ignore storage errors (e.g. private mode, quota).
	}
};

/**
 * Build key prefix for a consumer (with or without site ID).
 *
 * @param {string} siteId   Site ID or '' for pre-migration keys
 * @param {string} consumer Consumer identifier
 * @return {string} Key prefix for consumer-scoped keys (e.g. nfd-ai-chat-{siteId}-{consumer}).
 */
const getKeyPrefix = (siteId, consumer) =>
	siteId ? `nfd-ai-chat-${siteId}-${consumer}` : `nfd-ai-chat-${consumer}`;

/**
 * Migrate localStorage data from old-prefix keys to new-prefix keys.
 * Only copies when the new key has no data; then removes the old key.
 *
 * @param {string} oldSiteId Previous site ID ('' for pre-migration keys)
 * @param {string} newSiteId New site ID from config
 * @param {string} consumer  Consumer identifier (must match useNfdAgentsWebSocket for same surface)
 */
export const migrateStorageKeys = (oldSiteId, newSiteId, consumer) => {
	const oldPrefix = getKeyPrefix(oldSiteId, consumer);
	const newPrefix = getKeyPrefix(newSiteId, consumer);

	try {
		for (const suffix of Object.values(STORAGE_KEY_SUFFIXES)) {
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
	} catch {
		// Ignore storage errors.
	}
};

/**
 * Get localStorage keys for chat history and related data for a given consumer.
 * Includes the cached site ID in the key prefix for multisite isolation.
 * Must match the keys used in useNfdAgentsWebSocket for the same consumer.
 *
 * @param {string} consumer Consumer identifier (must match useNfdAgentsWebSocket for same surface)
 * @return {{ history: string, conversationId: string, sessionId: string, archive: string }} Object with localStorage key strings for history, conversationId, sessionId, and archive.
 */
export const getChatHistoryStorageKeys = (consumer) => {
	const prefix = getKeyPrefix(getSiteId(), consumer);
	const keys = {};
	for (const [name, suffix] of Object.entries(STORAGE_KEY_SUFFIXES)) {
		keys[name] = `${prefix}-${suffix}`;
	}
	return keys;
};
