/**
 * Chat History List Component
 *
 * Displays previous chat sessions from localStorage. Shows archived conversations
 * (from "+" new chat) and falls back to current history key for legacy.
 * Use consumer that matches useNfdAgentsWebSocket for the same consumer.
 */

import { useState, useEffect, useCallback } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { History, Trash2 } from "lucide-react";
import { getChatHistoryStorageKeys } from "../../constants/nfdAgents/storageKeys";
import {
	hasMeaningfulUserMessage,
	extractConversations,
	getLatestMessageTime,
} from "../../utils/nfdAgents/chatHistoryList";

const DEFAULT_MAX_HISTORY_ITEMS = 3;

/**
 * Human-readable relative time (e.g. 2m, 2h, 2d). Uses i18n for "Just now".
 *
 * @param {Date|string} dateOrString - Date or ISO string
 * @return {string} Relative time string (e.g. "2m", "2h", "Just now").
 */
const getRelativeTime = (dateOrString) => {
	const date = dateOrString instanceof Date ? dateOrString : new Date(dateOrString);
	const now = Date.now();
	const diffMs = now - date.getTime();
	const diffM = Math.floor(diffMs / 60000);
	if (diffM < 1) {
		return __("Just now", "wp-module-ai-chat");
	}
	if (diffM < 60) {
		return `${diffM}m`;
	}
	const diffH = Math.floor(diffMs / 3600000);
	if (diffH < 24) {
		return `${diffH}h`;
	}
	const diffD = Math.floor(diffMs / 86400000);
	if (diffD < 7) {
		return `${diffD}d`;
	}
	return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/**
 * Get the title for a conversation (first user message). Uses i18n for fallback.
 *
 * @param {Object} conversation - Conversation with messages
 * @return {string} Title string (first user message content or fallback).
 */
const getConversationTitle = (conversation) => {
	const messages = conversation.messages || conversation;
	const firstUserMessage = messages.find((msg) => msg.role === "user" || msg.type === "user");

	if (firstUserMessage && firstUserMessage.content) {
		const content = firstUserMessage.content;
		return content.length > 50 ? content.substring(0, 50) + "..." : content;
	}

	return __("Previous conversation", "wp-module-ai-chat");
};

/**
 * Chat history list UI: load from storage, render items, handle select/delete.
 *
 * @param {Object}   props
 * @param {string}   props.consumer             - Must match useNfdAgentsWebSocket for same consumer
 * @param {Function} props.onSelectConversation
 * @param {number}   [props.refreshTrigger=0]
 * @param {boolean}  [props.disabled=false]
 * @param {string}   [props.emptyMessage]
 * @param {number}   [props.maxHistoryItems=3]
 * @return {JSX.Element|null} List of history items or empty state or null.
 */
const ChatHistoryList = ({
	consumer,
	onSelectConversation,
	refreshTrigger = 0,
	disabled = false,
	emptyMessage = null,
	maxHistoryItems = DEFAULT_MAX_HISTORY_ITEMS,
}) => {
	const [conversations, setConversations] = useState([]);
	const keys = getChatHistoryStorageKeys(consumer);

	useEffect(() => {
		try {
			const rawArchive = window.localStorage.getItem(keys.archive);
			if (rawArchive) {
				const archive = JSON.parse(rawArchive);
				if (Array.isArray(archive) && archive.length > 0) {
					const trimmed = archive.slice(0, maxHistoryItems);
					if (trimmed.length < archive.length) {
						window.localStorage.setItem(keys.archive, JSON.stringify(trimmed));
					}
					const list = trimmed
						.map((entry) => {
							const messages = (entry.messages || []).map((msg) => ({
								...msg,
								timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
							}));
							const archivedAt = entry.archivedAt ? new Date(entry.archivedAt) : null;
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

			const storedMessages = window.localStorage.getItem(keys.history);
			if (storedMessages) {
				const parsedMessages = JSON.parse(storedMessages);
				if (Array.isArray(parsedMessages) && parsedMessages.length > 0) {
					const messages = parsedMessages.map((msg) => ({
						...msg,
						timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
					}));
					const extractedConversations = extractConversations(messages, maxHistoryItems);
					setConversations(extractedConversations);
				}
			}
		} catch (err) {
			// eslint-disable-next-line no-console
			console.warn("[Chat History] Failed to load chat history:", err);
		}
	}, [consumer, refreshTrigger, maxHistoryItems, keys.archive, keys.history]);

	const handleHistoryClick = useCallback(
		(conversation) => {
			if (disabled) {
				return;
			}
			try {
				const messages = conversation.messages || conversation;
				const messagesToStore = messages.map((msg) => ({
					...msg,
					timestamp: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp,
				}));

				window.localStorage.setItem(keys.history, JSON.stringify(messagesToStore));

				if (conversation.sessionId) {
					window.localStorage.setItem(keys.sessionId, conversation.sessionId);
				}
				if (conversation.conversationId) {
					window.localStorage.setItem(keys.conversationId, conversation.conversationId);
				}

				if (onSelectConversation) {
					onSelectConversation(conversation);
				}
			} catch (err) {
				// eslint-disable-next-line no-console
				console.warn("[Chat History] Failed to restore conversation:", err);
			}
		},
		[disabled, keys, onSelectConversation]
	);

	const handleDelete = useCallback(
		(e, index) => {
			e.stopPropagation();
			e.preventDefault();
			if (disabled) {
				return;
			}
			try {
				const rawArchive = window.localStorage.getItem(keys.archive);
				if (rawArchive) {
					const archive = JSON.parse(rawArchive);
					const filtered = archive.filter((_, i) => i !== index);
					window.localStorage.setItem(keys.archive, JSON.stringify(filtered));
				}
				setConversations((prev) => prev.filter((_, i) => i !== index));
			} catch (err) {
				// eslint-disable-next-line no-console
				console.warn("[Chat History] Failed to delete conversation:", err);
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
				const timeDate = conversation.archivedAt || getLatestMessageTime(conversation) || null;
				const timeLabel = timeDate ? getRelativeTime(timeDate) : null;
				return (
					<div
						key={key}
						className={`nfd-ai-chat-history-item${disabled ? " nfd-ai-chat-history-item--disabled" : ""}`}
						role="button"
						tabIndex={disabled ? -1 : 0}
						aria-disabled={disabled}
						onClick={() => handleHistoryClick(conversation)}
						onKeyDown={(e) => {
							if (disabled) {
								return;
							}
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								handleHistoryClick(conversation);
							}
						}}
					>
						<History width={14} height={14} aria-hidden />
						<div className="nfd-ai-chat-history-item__content">
							<span className="nfd-ai-chat-history-item__title">{title}</span>
							<div className="nfd-ai-chat-history-item__meta">
								{timeLabel && <span className="nfd-ai-chat-history-item__time">{timeLabel}</span>}
								<button
									type="button"
									className="nfd-ai-chat-history-item__delete"
									onClick={(e) => handleDelete(e, index)}
									aria-label={__("Delete conversation", "wp-module-ai-chat")}
									title={__("Delete", "wp-module-ai-chat")}
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
