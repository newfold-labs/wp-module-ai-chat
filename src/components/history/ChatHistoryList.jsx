/**
 * Chat History List Component
 *
 * Displays previous chat sessions from localStorage. Shows archived conversations
 * (from "+" new chat) and falls back to current history key for legacy.
 * Use storageNamespace that matches useNfdAgentsWebSocket for the same consumer.
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { History, Trash2 } from 'lucide-react';
import { getChatHistoryStorageKeys } from '../../constants/nfdAgents/storageKeys';

/**
 * Human-readable relative time (e.g. 2m, 2h, 2d).
 *
 * @param {Date|string} dateOrString - Date or ISO string
 * @return {string}
 */
const getRelativeTime = (dateOrString) => {
	const date = dateOrString instanceof Date ? dateOrString : new Date(dateOrString);
	const now = Date.now();
	const diffMs = now - date.getTime();
	const diffM = Math.floor(diffMs / 60000);
	const diffH = Math.floor(diffMs / 3600000);
	const diffD = Math.floor(diffMs / 86400000);
	if (diffM < 1) return __('Just now', 'wp-module-ai-chat');
	if (diffM < 60) return `${diffM}m`;
	if (diffH < 24) return `${diffH}h`;
	if (diffD < 7) return `${diffD}d`;
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const DEFAULT_MAX_HISTORY_ITEMS = 3;

/**
 * True if the conversation has at least one user message with non-empty content.
 *
 * @param {Object} conversation - Conversation with messages array
 * @return {boolean}
 */
const hasMeaningfulUserMessage = (conversation) => {
	const msgs = conversation.messages || conversation;
	return (
		Array.isArray(msgs) &&
		msgs.some(
			(m) =>
				(m.role === 'user' || m.type === 'user') &&
				m.content &&
				String(m.content).trim()
		)
	);
};

/**
 * Extract conversations from legacy messages (without sessionId) using time-based grouping
 *
 * @param {Array} messages - Messages array
 * @return {Array}
 */
const extractLegacyConversations = (messages) => {
	const conversations = [];
	let currentConversation = [];
	let lastTimestamp = null;

	messages.forEach((msg) => {
		const msgTimestamp = msg.timestamp
			? new Date(msg.timestamp).getTime()
			: Date.now();

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
};

/**
 * Extract conversation sessions from stored messages
 *
 * @param {Array} messages - Array of message objects with timestamps and optional sessionId
 * @param {number} maxHistoryItems - Max conversations to return
 * @return {Array}
 */
const extractConversations = (messages, maxHistoryItems) => {
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
					timestamp: msg.timestamp
						? new Date(msg.timestamp).getTime()
						: 0,
				};
			}
			sessionGroups[msg.sessionId].messages.push(msg);
			const msgTime = msg.timestamp
				? new Date(msg.timestamp).getTime()
				: 0;
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
};

/**
 * Get the latest message timestamp for relative time (legacy conversations without archivedAt).
 *
 * @param {Object} conversation - Conversation with messages
 * @return {Date|null}
 */
const getLatestMessageTime = (conversation) => {
	const messages = conversation.messages || conversation;
	if (!Array.isArray(messages) || messages.length === 0) return null;
	let latest = 0;
	messages.forEach((msg) => {
		const t = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
		if (t > latest) latest = t;
	});
	return latest ? new Date(latest) : null;
};

/**
 * Get the title for a conversation (first user message)
 *
 * @param {Object} conversation - Conversation with messages
 * @return {string}
 */
const getConversationTitle = (conversation) => {
	const messages = conversation.messages || conversation;
	const firstUserMessage = messages.find(
		(msg) => msg.role === 'user' || msg.type === 'user'
	);

	if (firstUserMessage && firstUserMessage.content) {
		const content = firstUserMessage.content;
		return content.length > 50 ? content.substring(0, 50) + '...' : content;
	}

	return __('Previous conversation', 'wp-module-ai-chat');
};

/**
 * @param {Object}   props
 * @param {string}   props.storageNamespace   - Must match useNfdAgentsWebSocket for same consumer
 * @param {Function} props.onSelectConversation
 * @param {number}   [props.refreshTrigger=0]
 * @param {boolean}  [props.disabled=false]
 * @param {string}   [props.emptyMessage]
 * @param {number}   [props.maxHistoryItems=3]
 */
const ChatHistoryList = ({
	storageNamespace,
	onSelectConversation,
	refreshTrigger = 0,
	disabled = false,
	emptyMessage = null,
	maxHistoryItems = DEFAULT_MAX_HISTORY_ITEMS,
}) => {
	const [conversations, setConversations] = useState([]);
	const keys = getChatHistoryStorageKeys(storageNamespace);

	useEffect(() => {
		try {
			const rawArchive = localStorage.getItem(keys.archive);
			if (rawArchive) {
				const archive = JSON.parse(rawArchive);
				if (Array.isArray(archive) && archive.length > 0) {
					const trimmed = archive.slice(0, maxHistoryItems);
					if (trimmed.length < archive.length) {
						localStorage.setItem(
							keys.archive,
							JSON.stringify(trimmed)
						);
					}
					const list = trimmed
						.map((entry) => {
							const messages = (entry.messages || []).map(
								(msg) => ({
									...msg,
									timestamp: msg.timestamp
										? new Date(msg.timestamp)
										: new Date(),
								})
							);
							const archivedAt = entry.archivedAt
								? new Date(entry.archivedAt)
								: null;
							return {
								sessionId: entry.sessionId ?? null,
								conversationId: entry.conversationId ?? null,
								messages,
								archivedAt,
							};
						})
						.filter(hasMeaningfulUserMessage);
					setConversations(list);
					return;
				}
			}

			const storedMessages = localStorage.getItem(keys.history);
			if (storedMessages) {
				const parsedMessages = JSON.parse(storedMessages);
				if (
					Array.isArray(parsedMessages) &&
					parsedMessages.length > 0
				) {
					const messages = parsedMessages.map((msg) => ({
						...msg,
						timestamp: msg.timestamp
							? new Date(msg.timestamp)
							: new Date(),
					}));
					const extractedConversations = extractConversations(
						messages,
						maxHistoryItems
					);
					setConversations(extractedConversations);
				}
			}
		} catch (err) {
			// eslint-disable-next-line no-console
			console.warn('[Chat History] Failed to load chat history:', err);
		}
	}, [storageNamespace, refreshTrigger, maxHistoryItems]);

	const handleHistoryClick = useCallback(
		(conversation) => {
			if (disabled) {
				return;
			}
			try {
				const messages = conversation.messages || conversation;
				const messagesToStore = messages.map((msg) => ({
					...msg,
					timestamp:
						msg.timestamp instanceof Date
							? msg.timestamp.toISOString()
							: msg.timestamp,
				}));

				localStorage.setItem(keys.history, JSON.stringify(messagesToStore));

				if (conversation.sessionId) {
					localStorage.setItem(keys.sessionId, conversation.sessionId);
				}
				if (conversation.conversationId) {
					localStorage.setItem(
						keys.conversationId,
						conversation.conversationId
					);
				}

				if (onSelectConversation) {
					onSelectConversation(conversation);
				}
			} catch (err) {
				// eslint-disable-next-line no-console
				console.warn('[Chat History] Failed to restore conversation:', err);
			}
		},
		[disabled, keys, onSelectConversation]
	);

	const handleDelete = useCallback(
		(e, index) => {
			e.stopPropagation();
			e.preventDefault();
			if (disabled) return;
			try {
				const rawArchive = localStorage.getItem(keys.archive);
				if (rawArchive) {
					const archive = JSON.parse(rawArchive);
					const filtered = archive.filter((_, i) => i !== index);
					localStorage.setItem(keys.archive, JSON.stringify(filtered));
				}
				setConversations((prev) => prev.filter((_, i) => i !== index));
			} catch (err) {
				// eslint-disable-next-line no-console
				console.warn('[Chat History] Failed to delete conversation:', err);
			}
		},
		[disabled, keys]
	);

	if (conversations.length === 0) {
		if (emptyMessage) {
			return (
				<div className="nfd-ai-chat-history-list nfd-ai-chat-history-list--empty">
					{emptyMessage}
				</div>
			);
		}
		return null;
	}

	return (
		<div className="nfd-ai-chat-history-list">
			{conversations.map((conversation, index) => {
				const title = getConversationTitle(conversation);
				const key = conversation.sessionId || `legacy-${index}`;
				const timeDate =
					conversation.archivedAt ||
					(getLatestMessageTime(conversation) || null);
				const timeLabel = timeDate ? getRelativeTime(timeDate) : null;
				return (
					<div
						key={key}
						className={`nfd-ai-chat-history-item${disabled ? ' nfd-ai-chat-history-item--disabled' : ''}`}
						role="button"
						tabIndex={disabled ? -1 : 0}
						aria-disabled={disabled}
						onClick={() => handleHistoryClick(conversation)}
						onKeyDown={(e) => {
							if (disabled) return;
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								handleHistoryClick(conversation);
							}
						}}
					>
						<History width={14} height={14} aria-hidden />
						<div className="nfd-ai-chat-history-item__content">
							<span className="nfd-ai-chat-history-item__title">{title}</span>
							<div className="nfd-ai-chat-history-item__meta">
								{timeLabel && (
									<span className="nfd-ai-chat-history-item__time">
										{timeLabel}
									</span>
								)}
								<button
									type="button"
									className="nfd-ai-chat-history-item__delete"
									onClick={(e) => handleDelete(e, index)}
									aria-label={__('Delete conversation', 'wp-module-ai-chat')}
									title={__('Delete', 'wp-module-ai-chat')}
								>
									<Trash2
										width={14}
										height={14}
										className="nfd-ai-chat-history-item__delete-icon"
										aria-hidden
									/>
								</button>
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
};

export default ChatHistoryList;
