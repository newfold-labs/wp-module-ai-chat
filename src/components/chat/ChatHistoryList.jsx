/**
 * Chat History List Component
 *
 * Displays previous chat sessions from localStorage. Shows archived conversations
 * (from "+" new chat) and falls back to current history key for legacy.
 * Use consumer that matches useNfdAgentsWebSocket for the same consumer.
 */

import { Fragment, useState, useEffect, useCallback, useMemo } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { Trash2 } from "lucide-react";
import { SparklesOutlineIcon } from "../icons";
import { getChatHistoryStorageKeys } from "../../constants/nfdAgents/storageKeys";
import {
	hasMeaningfulUserMessage,
	extractConversations,
	getLatestMessageTime,
	getConversationPreview,
	getRecencyBucket,
} from "../../utils/nfdAgents/chatHistoryList";

const DEFAULT_MAX_HISTORY_ITEMS = 3;

const BUCKET_LABELS = {
	today: () => __("Today", "wp-module-ai-chat"),
	yesterday: () => __("Yesterday", "wp-module-ai-chat"),
	earlier: () => __("Earlier", "wp-module-ai-chat"),
};

const BUCKET_ORDER = ["today", "yesterday", "earlier"];

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
		const content = String(firstUserMessage.content).trim();
		return content.length > 60 ? content.substring(0, 60) + "…" : content;
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

	// Compute decorated items + bucket grouping in a single pass so render stays simple.
	const groupedConversations = useMemo(() => {
		const decorated = conversations.map((conversation, index) => {
			const timeDate = conversation.archivedAt || getLatestMessageTime(conversation) || null;
			return {
				conversation,
				index,
				title: getConversationTitle(conversation),
				preview: getConversationPreview(conversation),
				timeDate,
				timeLabel: timeDate ? getRelativeTime(timeDate) : null,
				bucket: getRecencyBucket(timeDate),
			};
		});
		const groups = { today: [], yesterday: [], earlier: [] };
		decorated.forEach((item) => groups[item.bucket].push(item));
		return BUCKET_ORDER.filter((bucket) => groups[bucket].length > 0).map((bucket) => ({
			bucket,
			label: BUCKET_LABELS[bucket](),
			items: groups[bucket],
		}));
	}, [conversations]);

	if (conversations.length === 0) {
		const message = emptyMessage || __("No conversations yet.", "wp-module-ai-chat");
		return (
			<div
				className="nfd-ai-chat-history-list nfd-ai-chat-history-list--empty"
				role="status"
				aria-live="polite"
			>
				<div className="nfd-ai-chat-history-empty">
					<div className="nfd-ai-chat-history-empty__icon" aria-hidden="true">
						<SparklesOutlineIcon width={20} height={20} />
					</div>
					<div className="nfd-ai-chat-history-empty__title">{message}</div>
					<div className="nfd-ai-chat-history-empty__hint">
						{__("Your recent chats will appear here.", "wp-module-ai-chat")}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="nfd-ai-chat-history-list">
			{groupedConversations.map((group) => (
				<Fragment key={group.bucket}>
					<div className="nfd-ai-chat-history-list__section-label">{group.label}</div>
					{group.items.map((item) => {
						const { conversation, index, title, preview, timeLabel } = item;
						const key = conversation.sessionId || `legacy-${index}`;
						return (
							<div
								key={key}
								className={`nfd-ai-chat-history-item${disabled ? " nfd-ai-chat-history-item--disabled" : ""}`}
								role="button"
								tabIndex={disabled ? -1 : 0}
								aria-disabled={disabled}
								aria-label={title}
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
								<div className="nfd-ai-chat-history-item__body">
									<div className="nfd-ai-chat-history-item__title-row">
										<span className="nfd-ai-chat-history-item__title">{title}</span>
										{timeLabel && (
											<span className="nfd-ai-chat-history-item__time">{timeLabel}</span>
										)}
									</div>
									{preview && (
										<div className="nfd-ai-chat-history-item__preview">{preview}</div>
									)}
								</div>
								<button
									type="button"
									className="nfd-ai-chat-history-item__delete"
									onClick={(e) => handleDelete(e, index)}
									aria-label={__("Delete conversation", "wp-module-ai-chat")}
									title={__("Delete", "wp-module-ai-chat")}
									tabIndex={disabled ? -1 : 0}
								>
									<Trash2
										width={14}
										height={14}
										className="nfd-ai-chat-history-item__delete-icon"
										aria-hidden
									/>
								</button>
							</div>
						);
					})}
				</Fragment>
			))}
		</div>
	);
};

export default ChatHistoryList;
