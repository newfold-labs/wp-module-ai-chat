/**
 * WordPress dependencies
 */
import { useMemo, useState, useEffect, useRef, useCallback } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { Icon, pencil, rotateLeft, warning } from "@wordpress/icons";

/**
 * Internal dependencies
 */
import classnames from "classnames";
import { containsHtml, sanitizeHtml } from "../../utils/sanitizeHtml";
import { containsMarkdown, parseMarkdown, linkifyUrls } from "../../utils/markdownParser";
import { unescapeAiResponse } from "../../utils/helpers";
import { formatRelativeTime } from "../../utils/dateFormat";
import { attachCodeBlockCopy } from "../../utils/codeBlockCopy";
import AssistantMessageShell from "../ui/AssistantMessageShell";
import MessageActions from "../ui/MessageActions";
import ToolExecutionList from "../ui/ToolExecutionList";

/** Typing animation: chars to reveal per tick, tick interval ms */
const TYPING_CHARS_PER_TICK = 2;
const TYPING_TICK_MS = 35;

/**
 * ChatMessage Component
 *
 * Displays a single message in the chat with appropriate styling.
 * Supports HTML and Markdown rendering for assistant messages.
 *
 * @param {Object}             props                    - The component props.
 * @param {string}             props.message            - The message content to display.
 * @param {string}             [props.type="assistant"] - The message type ("user" or "assistant").
 * @param {boolean}            [props.animateTyping]    - When true, reveal assistant content with a typing effect.
 * @param {Function}           [props.onContentGrow]    - Called when displayed content grows (e.g. for scroll-into-view).
 * @param {Array}              [props.executedTools=[]] - List of executed tools to show inline.
 * @param {Array}              [props.toolResults=[]]   - Results from tool executions.
 * @param {string|number|Date} [props.timestamp]        - Optional message timestamp; surfaced as a hover tooltip.
 * @param {boolean}            [props.showActions=true] - When true (default for assistants), show the message action bar (copy, etc.) below the bubble.
 * @param {Function}           [props.onEdit]           - When provided on a user message, renders an Edit action that calls `onEdit(originalText)`. Intended for the most recent user turn so it can be loaded back into the input.
 * @param {string}             [props.status]           - User-message delivery status: undefined (sent OK) or "failed". A failed user message renders a warning treatment + Retry action when `onRetry` is provided.
 * @param {Function}           [props.onRetry]          - When provided alongside `status === "failed"`, renders a Retry action that calls this with no arguments. Parents typically wire this to a per-message retry handler from the WS hook.
 * @param {boolean}            [props.isFallback]       - When true on an assistant message, mark it as a system fallback (e.g. connection-failure notice). Adds a CSS modifier so the avatar stays visible even when this message immediately follows another assistant turn.
 * @return {JSX.Element} The ChatMessage component.
 */
const ChatMessage = ({
	message,
	type = "assistant",
	animateTyping = false,
	onContentGrow,
	executedTools = [],
	toolResults = [],
	timestamp,
	showActions = true,
	onEdit,
	status,
	onRetry,
	isFallback = false,
}) => {
	// Treat approval_request as assistant so the thread still displays
	const displayType = type === "approval_request" ? "assistant" : type;
	const isUser = displayType === "user";

	const fullLength = (message || "").length;
	const [displayedLength, setDisplayedLength] = useState(() => (animateTyping ? 0 : fullLength));

	// When not animating, show full message; when animating, drive displayedLength toward fullLength and clear interval when done
	const intervalRef = useRef(null);
	useEffect(() => {
		if (!animateTyping) {
			setDisplayedLength(fullLength);
			return;
		}
		intervalRef.current = setInterval(() => {
			setDisplayedLength((prev) => {
				if (prev >= fullLength) {
					if (intervalRef.current) {
						clearInterval(intervalRef.current);
						intervalRef.current = null;
					}
					return prev;
				}
				return Math.min(prev + TYPING_CHARS_PER_TICK, fullLength);
			});
		}, TYPING_TICK_MS);
		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [animateTyping, fullLength]);

	// Notify parent when content grows (for auto-scroll), throttled to avoid excessive updates
	const lastGrowCallRef = useRef(0);
	useEffect(() => {
		if (!onContentGrow || !animateTyping || displayedLength === 0) {
			return;
		}
		const now = Date.now();
		if (now - lastGrowCallRef.current < 80) {
			return;
		}
		lastGrowCallRef.current = now;
		onContentGrow();
	}, [displayedLength, animateTyping, onContentGrow]);

	const effectiveMessage = animateTyping
		? (message || "").slice(0, displayedLength)
		: message || "";

	// Choose rendering path: plain user text, sanitized HTML, parsed markdown, or linkified plain text.
	const { content, isRichContent } = useMemo(() => {
		if (!effectiveMessage) {
			return { content: "", isRichContent: false };
		}

		const raw = unescapeAiResponse(effectiveMessage);

		if (isUser) {
			return { content: raw, isRichContent: false };
		}

		if (containsHtml(raw)) {
			return { content: sanitizeHtml(raw), isRichContent: true };
		}

		if (containsMarkdown(raw)) {
			const parsed = parseMarkdown(raw);
			return { content: sanitizeHtml(parsed), isRichContent: true };
		}

		// Plain text: linkify bare URLs and preserve newlines
		const linkified = linkifyUrls(raw);
		if (linkified !== raw) {
			const withBreaks = linkified.replace(/\n/g, "<br>");
			return { content: sanitizeHtml(withBreaks), isRichContent: true };
		}
		return { content: raw, isRichContent: false };
	}, [effectiveMessage, isUser]);

	// IMPORTANT: every hook below this comment must run on every render to keep React's
	// hook-call order stable. Do not move them under the "no content" early return — that
	// would change the hook count between renders and trigger React error #310.

	const isFailed = isUser && status === "failed";

	const handleEdit = useCallback(() => {
		if (onEdit) {
			onEdit(unescapeAiResponse(message || ""));
		}
	}, [onEdit, message]);

	const handleRetry = useCallback(() => {
		if (onRetry) {
			onRetry();
		}
	}, [onRetry]);

	const userActions = useMemo(() => {
		if (!isUser) {
			return null;
		}
		// Failed messages get a Retry as the primary action; non-failed last user
		// message gets Edit. We don't show both — they target the same spatial slot
		// and the Retry intent is more urgent when present.
		if (isFailed && onRetry) {
			return [
				{
					id: "retry",
					label: __("Try sending again", "wp-module-ai-chat"),
					icon: <Icon icon={rotateLeft} size={12} />,
					onClick: handleRetry,
				},
			];
		}
		if (onEdit) {
			return [
				{
					id: "edit",
					label: __("Edit message", "wp-module-ai-chat"),
					icon: <Icon icon={pencil} size={12} />,
					onClick: handleEdit,
				},
			];
		}
		return null;
	}, [isUser, isFailed, onEdit, onRetry, handleEdit, handleRetry]);

	// Hold a ref to the rich-content node so we can post-process the rendered HTML
	// (currently: attaching copy buttons to <pre> code blocks).
	const richContentRef = useRef(null);
	useEffect(() => {
		if (!isRichContent || !richContentRef.current) {
			return undefined;
		}
		return attachCodeBlockCopy(richContentRef.current);
	}, [isRichContent, content]);

	// Early returns may live below — by this point all hooks have been called.
	if (!content && (!executedTools || executedTools.length === 0)) {
		return null;
	}

	const rootClassName = classnames("nfd-ai-chat-message", `nfd-ai-chat-message--${displayType}`);

	// True while the typewriter animation is still revealing characters.
	const isStreaming = animateTyping && displayedLength < fullLength;

	// Native title attribute for hover tooltip; cheap, accessible, no portal needed.
	const tooltip = formatRelativeTime(timestamp) || undefined;

	// Action bar appears below assistant bubbles only — once content exists and the typewriter
	// has finished. Skipped while streaming (avoid copying partial text). Users get their own
	// action set (Edit) when `onEdit` is supplied; rendered via the same MessageActions component.
	const shouldRenderActions = showActions && Boolean(content) && !isStreaming;

	const bubbleAndContent = content && (
		<div className="nfd-ai-chat-message__bubble-wrap">
			{isRichContent ? (
				/* content is sanitized in the useMemo above (sanitizeHtml) */
				<div
					ref={richContentRef}
					className={classnames(
						"nfd-ai-chat-message__content",
						"nfd-ai-chat-message__content--rich",
						{ "nfd-ai-chat-message__content--failed": isFailed }
					)}
					dangerouslySetInnerHTML={{ __html: content }}
					title={tooltip}
				/>
			) : (
				<div
					className={classnames(
						"nfd-ai-chat-message__content",
						"nfd-ai-chat-message__content--pre-wrap",
						{
							"nfd-ai-chat-message__content--streaming": isStreaming,
							"nfd-ai-chat-message__content--failed": isFailed,
						}
					)}
					style={{ whiteSpace: "pre-wrap" }}
					title={tooltip}
				>
					{/* While streaming, drop trailing whitespace/newlines so the ::after caret
					    hugs the last visible character instead of dropping to a blank next line. */}
					{isStreaming ? content.replace(/\s+$/u, "") : content}
				</div>
			)}
			{isFailed && (
				<div
					className="nfd-ai-chat-message__status nfd-ai-chat-message__status--failed"
					role="status"
				>
					<Icon icon={warning} size={12} />
					<span>{__("Couldn't send", "wp-module-ai-chat")}</span>
					{onRetry && (
						<button
							type="button"
							className="nfd-ai-chat-message__status-action"
							onClick={handleRetry}
						>
							{__("Retry", "wp-module-ai-chat")}
						</button>
					)}
				</div>
			)}
			{shouldRenderActions && !isUser && (
				<MessageActions text={unescapeAiResponse(message || "")} />
			)}
			{shouldRenderActions && isUser && userActions && (
				<MessageActions
					actions={userActions}
					className="nfd-ai-chat-message-actions--user"
				/>
			)}
		</div>
	);

	const tools = executedTools && executedTools.length > 0 && (
		<ToolExecutionList executedTools={executedTools} toolResults={toolResults} />
	);

	// User messages keep the simple flat structure: bubble + (no avatar, no tools).
	if (isUser) {
		return (
			<div className={rootClassName}>
				{bubbleAndContent}
				{tools}
			</div>
		);
	}

	// Assistant messages: shared shell handles avatar + main column. Fallback notices
	// (connection-failure messages) get a `--fallback` modifier so the avatar stays visible
	// even when this row immediately follows a previous assistant turn — they're a system
	// delivery, not a continuation of the AI's voice.
	return (
		<AssistantMessageShell
			className={isFallback ? "nfd-ai-chat-message--fallback" : undefined}
		>
			{bubbleAndContent}
			{tools}
		</AssistantMessageShell>
	);
};

export default ChatMessage;
