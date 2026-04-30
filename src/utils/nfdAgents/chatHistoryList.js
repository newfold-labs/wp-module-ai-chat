/**
 * Pure helpers for ChatHistoryList: conversation filtering and extraction.
 * No React or i18n; safe to unit test.
 */

/**
 * True if the conversation has at least one user message with non-empty content.
 *
 * @param {Object} conversation - Conversation with messages array
 * @return {boolean} True if at least one meaningful user message exists.
 */
export function hasMeaningfulUserMessage(conversation) {
	const msgs = conversation.messages || conversation;
	return (
		Array.isArray(msgs) &&
		msgs.some(
			(m) => (m.role === "user" || m.type === "user") && m.content && String(m.content).trim()
		)
	);
}

/**
 * Extract conversations from legacy messages (without sessionId) using time-based grouping.
 * Messages more than 5 minutes apart start a new conversation.
 *
 * @param {Array} messages - Messages array
 * @return {Array} Array of conversation objects with sessionId and messages.
 */
export function extractLegacyConversations(messages) {
	const conversations = [];
	let currentConversation = [];
	let lastTimestamp = null;

	messages.forEach((msg) => {
		const msgTimestamp = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();

		if (lastTimestamp && msgTimestamp - lastTimestamp > 5 * 60 * 1000) {
			if (currentConversation.length > 0) {
				conversations.push({
					sessionId: null,
					messages: [...currentConversation],
				});
				currentConversation = [];
			}
		}

		currentConversation.push(msg);
		lastTimestamp = msgTimestamp;
	});

	if (currentConversation.length > 0) {
		conversations.push({
			sessionId: null,
			messages: currentConversation,
		});
	}

	return conversations.reverse();
}

/**
 * Extract conversation sessions from stored messages (by sessionId, with legacy fallback).
 *
 * @param {Array}  messages        - Array of message objects with timestamps and optional sessionId
 * @param {number} maxHistoryItems - Max conversations to return
 * @return {Array} Array of conversation objects (sessionId, messages).
 */
export function extractConversations(messages, maxHistoryItems) {
	if (!Array.isArray(messages) || messages.length === 0) {
		return [];
	}

	const sessionGroups = {};
	const legacyMessages = [];

	messages.forEach((msg) => {
		if (msg.sessionId) {
			if (!sessionGroups[msg.sessionId]) {
				sessionGroups[msg.sessionId] = {
					sessionId: msg.sessionId,
					messages: [],
					timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : 0,
				};
			}
			sessionGroups[msg.sessionId].messages.push(msg);
			const msgTime = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
			if (msgTime > sessionGroups[msg.sessionId].timestamp) {
				sessionGroups[msg.sessionId].timestamp = msgTime;
			}
		} else {
			legacyMessages.push(msg);
		}
	});

	let conversations = Object.values(sessionGroups)
		.sort((a, b) => b.timestamp - a.timestamp)
		.map((session) => ({
			sessionId: session.sessionId,
			messages: session.messages,
		}));

	if (legacyMessages.length > 0 && conversations.length < maxHistoryItems) {
		const legacyConversations = extractLegacyConversations(legacyMessages);
		conversations = [...conversations, ...legacyConversations];
	}

	conversations = conversations.filter(hasMeaningfulUserMessage);
	return conversations.slice(0, maxHistoryItems);
}

/**
 * Get the latest message timestamp for relative time (legacy conversations without archivedAt).
 *
 * @param {Object} conversation - Conversation with messages
 * @return {Date|null} Latest message date or null.
 */
export function getLatestMessageTime(conversation) {
	const messages = conversation.messages || conversation;
	if (!Array.isArray(messages) || messages.length === 0) {
		return null;
	}
	let latest = 0;
	messages.forEach((msg) => {
		const t = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
		if (t > latest) {
			latest = t;
		}
	});
	return latest ? new Date(latest) : null;
}

/**
 * Get a short preview snippet from the most recent assistant message in the conversation.
 * Strips markdown noise and trims to a single-line excerpt suitable for a list item.
 *
 * @param {Object} conversation - Conversation with messages array
 * @param {number} [maxLength=80] - Max preview length before truncation
 * @return {string} Preview string (may be empty if no assistant content found).
 */
export function getConversationPreview(conversation, maxLength = 80) {
	const messages = conversation.messages || conversation;
	if (!Array.isArray(messages) || messages.length === 0) {
		return "";
	}
	// Walk from newest to oldest and pick the last assistant message with content.
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const m = messages[i];
		const isAssistant = m.role === "assistant" || m.type === "assistant";
		if (!isAssistant || !m.content) {
			continue;
		}
		// Strip common markdown markers and collapse whitespace for a clean single-line preview.
		const cleaned = String(m.content)
			.replace(/```[\s\S]*?```/g, " ")
			.replace(/`([^`]+)`/g, "$1")
			.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
			.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
			.replace(/[*_~>#-]+/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		if (!cleaned) {
			continue;
		}
		return cleaned.length > maxLength ? cleaned.slice(0, maxLength).trimEnd() + "…" : cleaned;
	}
	return "";
}

/**
 * Bucket key for date-based grouping ("today" | "yesterday" | "earlier").
 *
 * @param {Date} date - Reference date for the conversation
 * @param {Date} [now=new Date()] - Current time (override for tests)
 * @return {"today"|"yesterday"|"earlier"} Bucket key.
 */
export function getRecencyBucket(date, now = new Date()) {
	if (!date) {
		return "earlier";
	}
	const d = date instanceof Date ? date : new Date(date);
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const startOfYesterday = startOfToday - 86400000;
	const t = d.getTime();
	if (t >= startOfToday) {
		return "today";
	}
	if (t >= startOfYesterday) {
		return "yesterday";
	}
	return "earlier";
}
