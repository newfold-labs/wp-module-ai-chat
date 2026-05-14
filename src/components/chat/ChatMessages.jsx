/**
 * WordPress dependencies
 */
import { Fragment, useEffect, useMemo, useRef, useCallback, useState } from "@wordpress/element";
import { __, sprintf } from "@wordpress/i18n";

/**
 * Internal dependencies
 */
import classnames from "classnames";
import { Check, ChevronDown, WifiOff } from "lucide-react";
import { groupMessagesByDate } from "../../utils/dateFormat";
import AssistantMessageShell from "../ui/AssistantMessageShell";
import ErrorAlert from "../ui/ErrorAlert";
import MessageGroupDivider from "../ui/MessageGroupDivider";
import TypingIndicator from "../ui/TypingIndicator";
import ChatMessage from "./ChatMessage";

// Distance from the bottom (in px) within which we consider the user "anchored" and keep auto-scrolling.
const SCROLL_BOTTOM_THRESHOLD = 80;
// Pixels scrolled past the top before we consider the area "scrolled" (for header elevation).
const SCROLL_ELEVATION_THRESHOLD = 8;
// How long the transient "Connection restored" indicator stays before fading out. Long enough
// to be noticed without becoming visual noise that lingers into the next AI reply.
const RECONNECTED_INDICATOR_MS = 3500;

/**
 * ChatMessages Component
 *
 * Scrollable container for all chat messages.
 * Auto-scrolls to bottom when new messages arrive or when the last message content grows (e.g. typing animation).
 *
 * @param {Object}   props                              - The component props.
 * @param {Array}    props.messages                     - The messages to display.
 * @param {boolean}  props.isLoading                    - Whether the AI is generating a response.
 * @param {string}   props.error                        - Error message to display (optional).
 * @param {string}   props.status                       - The current status.
 * @param {Object}   props.activeToolCall               - The currently executing tool call (optional).
 * @param {string}   props.toolProgress                 - Real-time progress message (optional).
 * @param {Array}    props.executedTools                - List of completed tool executions (optional).
 * @param {Array}    props.pendingTools                 - List of pending tools to execute (optional).
 * @param {Function} [props.onRetry]                    - Callback when user clicks Retry (e.g. after connection failed).
 * @param {boolean}  [props.connectionFailed]           - Whether connection has failed (show Retry without red error).
 * @param {boolean}  [props.isConnectingOrReconnecting] - When true, show a single "Connecting…" assistant message. Prefer passing `connectionState` so the indicator can distinguish Connecting vs Reconnecting; this prop stays for backwards compatibility.
 * @param {string}   [props.connectionState]            - Optional. Current WS state ("connecting" | "reconnecting" | other). When provided, the connecting indicator picks a label appropriate to the state. Falls back to the generic "Connecting…" copy.
 * @param {number}   [props.nextRetryAt]                - Optional. Wall-clock ms timestamp of the next scheduled reconnect attempt (from the WS hook). When provided alongside `connectionState === "reconnecting"`, the indicator renders a live countdown (e.g. "Reconnecting in 3s…") so users can see waiting time instead of an indefinite spinner.
 * @param {boolean}  [props.isOffline]                  - When true, render a persistent offline indicator and suppress connecting/reconnecting/restored cues (which would be misleading while the device has no network).
 * @param {string}   [props.messageBubbleStyle]         - 'bubbles' (default) or 'minimal'. Controls container and message bubble styling.
 * @param {Function} [props.onEditUserMessage]          - Optional. When provided, the *last* user message renders an Edit action that calls this with the original text. Earlier user turns are left untouched intentionally.
 * @param {Function} [props.onRetryUserMessage]         - Optional. When provided, every user message marked with `status: "failed"` renders a Retry action that calls this with the message id. Typically wired to the WS hook's `retryFailedMessage`.
 * @return {JSX.Element} The ChatMessages component.
 */
const ChatMessages = ({
	messages = [],
	isLoading = false,
	error = null,
	status = null,
	activeToolCall = null,
	toolProgress = null,
	executedTools = [],
	pendingTools = [],
	onRetry,
	connectionFailed = false,
	isConnectingOrReconnecting = false,
	connectionState = null,
	nextRetryAt = null,
	isOffline = false,
	messageBubbleStyle = "bubbles",
	onEditUserMessage,
	onRetryUserMessage,
}) => {
	const scrollContainerRef = useRef(null);
	const [scrollTrigger, setScrollTrigger] = useState(0);
	// Track whether the user is anchored near the bottom. When true, new content auto-scrolls.
	// When the user scrolls up to read history, this flips to false and we surface the jump pill instead.
	const [isAnchored, setIsAnchored] = useState(true);
	// Whether the area is scrolled past the top — exposed via data-attribute so consumers can
	// elevate / shadow the header above the messages without prop-drilling scroll state.
	const [isScrolled, setIsScrolled] = useState(false);
	// Transient "Connection restored" indicator. Fires on any recovery from a disconnect —
	// dropped socket (`reconnecting`), retries-exhausted (`failed`), or offline-induced
	// `disconnected` — back to `connected`. We can't compare to the immediate previous state
	// because recovery always routes through `connecting`, so we instead track whether the
	// session has visited a degraded state since the last `connected`. `disconnected` only
	// counts as degraded after we've already been connected once — the hook's initial state
	// is `disconnected`, so otherwise we'd fire on first mount.
	const hasBeenConnectedRef = useRef(connectionState === "connected");
	const sawDegradedSinceConnectedRef = useRef(false);
	const [showReconnected, setShowReconnected] = useState(false);
	// Whole-second countdown until the next reconnect attempt. Null when no retry is scheduled
	// (initial connect, between attempts, or once the timer has fired). Drives the
	// "Reconnecting in 3s…" copy so users see a concrete wait time instead of an indefinite spinner.
	const [retryCountdownSec, setRetryCountdownSec] = useState(null);

	// Group messages by date once per render of `messages`. Each group also exposes its
	// startIndex so the inner loop can compute the global index without an O(n²) scan.
	const groupedMessages = useMemo(() => groupMessagesByDate(messages), [messages]);

	// Index of the most recent user message, or -1 if none. Used to scope the Edit action to
	// the latest user turn only — editing arbitrary historical turns is out of scope and would
	// require branching the conversation, which we deliberately don't model here.
	const lastUserIdx = useMemo(() => {
		for (let i = messages.length - 1; i >= 0; i -= 1) {
			const m = messages[i];
			if (m.type === "user" || m.role === "user") {
				return i;
			}
		}
		return -1;
	}, [messages]);

	const scrollToBottom = useCallback((behavior = "smooth") => {
		const el = scrollContainerRef.current;
		if (!el) {
			return;
		}
		el.scrollTo({
			top: el.scrollHeight - el.clientHeight,
			behavior,
		});
	}, []);

	// Watch scroll position. Updates two derived flags from a single passive listener so we don't
	// need separate observers for "near bottom" and "scrolled past top".
	useEffect(() => {
		const el = scrollContainerRef.current;
		if (!el) {
			return undefined;
		}
		const handleScroll = () => {
			const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
			setIsAnchored(distanceFromBottom < SCROLL_BOTTOM_THRESHOLD);
			setIsScrolled(el.scrollTop > SCROLL_ELEVATION_THRESHOLD);
		};
		el.addEventListener("scroll", handleScroll, { passive: true });
		// Initial sync (e.g. when remounting with prior content)
		handleScroll();
		return () => el.removeEventListener("scroll", handleScroll);
	}, []);

	// Only auto-scroll when the user is anchored — never yank them out of older content mid-stream.
	useEffect(() => {
		if (isAnchored) {
			scrollToBottom();
		}
	}, [
		messages,
		isLoading,
		toolProgress,
		scrollTrigger,
		isAnchored,
		showReconnected,
		isOffline,
		scrollToBottom,
	]);

	// Surface a brief "Connection restored" cue only when the connection has actually
	// recovered from a degraded state. The first-ever connect on mount stays silent.
	useEffect(() => {
		if (
			connectionState === "reconnecting" ||
			connectionState === "failed" ||
			(connectionState === "disconnected" && hasBeenConnectedRef.current)
		) {
			sawDegradedSinceConnectedRef.current = true;
			return undefined;
		}
		if (connectionState === "connected") {
			if (sawDegradedSinceConnectedRef.current) {
				sawDegradedSinceConnectedRef.current = false;
				setShowReconnected(true);
				const timer = setTimeout(() => setShowReconnected(false), RECONNECTED_INDICATOR_MS);
				hasBeenConnectedRef.current = true;
				return () => clearTimeout(timer);
			}
			hasBeenConnectedRef.current = true;
		}
		return undefined;
	}, [connectionState]);

	// Tick the reconnect countdown in real time. Aligns each update to the next whole-second
	// boundary so the displayed value changes exactly when the count would tick, not on an
	// arbitrary 250ms interval that visibly stutters. Only runs while a retry is scheduled.
	useEffect(() => {
		if (connectionState !== "reconnecting" || !nextRetryAt) {
			setRetryCountdownSec(null);
			return undefined;
		}
		let timeoutId = null;
		const tick = () => {
			const remainingMs = nextRetryAt - Date.now();
			if (remainingMs <= 0) {
				setRetryCountdownSec(0);
				return;
			}
			setRetryCountdownSec(Math.ceil(remainingMs / 1000));
			// Schedule the next tick at the next whole-second boundary so subsequent updates
			// land cleanly (e.g. transition from "3s" → "2s" the moment the count actually changes).
			const msUntilNextSecond = ((remainingMs - 1) % 1000) + 1;
			timeoutId = setTimeout(tick, msUntilNextSecond);
		};
		tick();
		return () => {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		};
	}, [connectionState, nextRetryAt]);

	// Bump scroll trigger so the scroll effect runs again when the last message's content grows (e.g. typing).
	const onContentGrow = useCallback(() => {
		setScrollTrigger((t) => t + 1);
	}, []);

	// Only show executed tools in TypingIndicator when there is active or pending tool work.
	const hasActiveToolExecution =
		activeToolCall || executedTools.length > 0 || pendingTools.length > 0;

	const messagesClassName = classnames("nfd-ai-chat-messages", {
		"nfd-ai-chat-messages--minimal": messageBubbleStyle === "minimal",
	});

	const handleJumpToLatest = useCallback(() => {
		scrollToBottom("smooth");
		setIsAnchored(true);
	}, [scrollToBottom]);

	return (
		<div className="nfd-ai-chat-messages-shell" data-scrolled={isScrolled ? "true" : undefined}>
			<div ref={scrollContainerRef} className={messagesClassName}>
				{groupedMessages.map((group, groupIdx) => (
					<Fragment key={`group-${groupIdx}-${group.label || "untimed"}`}>
						<MessageGroupDivider label={group.label} />
						{group.messages.map((msg, msgIdxInGroup) => {
							const globalIdx = group.startIndex + msgIdxInGroup;
							// Animate typing only for the last assistant message that was received live (not loaded from history/restore)
							const isLastAssistant =
								globalIdx === messages.length - 1 &&
								(msg.type === "assistant" || msg.role === "assistant");
							const isLastUser = globalIdx === lastUserIdx;
							const isFailedUser =
								(msg.type === "user" || msg.role === "user") && msg.status === "failed";
							return (
								<ChatMessage
									key={msg.id || `m-${globalIdx}`}
									message={msg.content}
									type={msg.type}
									timestamp={msg.timestamp}
									animateTyping={isLastAssistant && msg.animateTyping === true}
									onContentGrow={isLastAssistant ? onContentGrow : undefined}
									executedTools={msg.executedTools}
									toolResults={msg.toolResults}
									status={msg.status}
									isFallback={msg.isFallback === true}
									onEdit={isLastUser && onEditUserMessage ? onEditUserMessage : undefined}
									onRetry={
										isFailedUser && onRetryUserMessage
											? () => onRetryUserMessage(msg.id)
											: undefined
									}
								/>
							);
						})}
					</Fragment>
				))}
				{isOffline && (
					<AssistantMessageShell>
						<div
							className="nfd-ai-chat-typing-indicator nfd-ai-chat-typing-indicator--offline"
							role="status"
							aria-live="polite"
						>
							<WifiOff
								size={14}
								strokeWidth={2}
								aria-hidden="true"
								className="nfd-ai-chat-typing-indicator__offline-icon"
							/>
							<span className="nfd-ai-chat-typing-indicator__text nfd-ai-chat-typing-indicator__text--static">
								{__(
									"You appear to be offline. We'll reconnect as soon as your connection is back.",
									"wp-module-ai-chat"
								)}
							</span>
						</div>
					</AssistantMessageShell>
				)}
				{isConnectingOrReconnecting && !connectionFailed && !isOffline && (
					<AssistantMessageShell>
						<div
							className="nfd-ai-chat-typing-indicator nfd-ai-chat-typing-indicator--connecting"
							aria-live="polite"
						>
							{/* Three small dots that ripple — visually distinct from the assistant
						    "thinking" indicator so users can tell connection state apart from AI work. */}
							<span className="nfd-ai-chat-connecting-dots" aria-hidden="true">
								<span />
								<span />
								<span />
							</span>
							<span className="nfd-ai-chat-typing-indicator__text">
								{connectionState === "reconnecting"
									? retryCountdownSec && retryCountdownSec > 0
										? sprintf(
												/* translators: %d: seconds until the next reconnection attempt */
												__("Reconnecting in %ds…", "wp-module-ai-chat"),
												retryCountdownSec
											)
										: __("Reconnecting…", "wp-module-ai-chat")
									: __("Connecting…", "wp-module-ai-chat")}
							</span>
						</div>
					</AssistantMessageShell>
				)}
				{showReconnected && !isConnectingOrReconnecting && !connectionFailed && !isOffline && (
					<AssistantMessageShell>
						<div
							className="nfd-ai-chat-typing-indicator nfd-ai-chat-typing-indicator--reconnected"
							role="status"
							aria-live="polite"
						>
							<Check
								size={14}
								strokeWidth={2.5}
								aria-hidden="true"
								className="nfd-ai-chat-typing-indicator__check"
							/>
							<span className="nfd-ai-chat-typing-indicator__text nfd-ai-chat-typing-indicator__text--static">
								{__("Connection restored", "wp-module-ai-chat")}
							</span>
						</div>
					</AssistantMessageShell>
				)}
				{error && <ErrorAlert message={error} />}
				{onRetry && (error || connectionFailed) && (
					<p className="nfd-ai-chat-messages__retry">
						<button type="button" className="nfd-ai-chat-messages__retry-button" onClick={onRetry}>
							{__("Retry", "wp-module-ai-chat")}
						</button>
					</p>
				)}
				{isLoading && (
					<TypingIndicator
						status={status}
						activeToolCall={activeToolCall}
						toolProgress={toolProgress}
						executedTools={hasActiveToolExecution ? executedTools : []}
						pendingTools={pendingTools}
					/>
				)}
			</div>
			{!isAnchored && messages.length > 0 && (
				<button
					type="button"
					className="nfd-ai-chat-messages__jump"
					onClick={handleJumpToLatest}
					aria-label={__("Jump to latest message", "wp-module-ai-chat")}
				>
					<ChevronDown size={16} aria-hidden="true" />
				</button>
			)}
		</div>
	);
};

export default ChatMessages;
