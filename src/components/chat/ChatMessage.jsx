/**
 * WordPress dependencies
 */
import { useMemo, useEffect, useRef, useCallback } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
// `cautionFilled` (not `warning`) — the `warning` alias was removed in
// @wordpress/icons v12; consumers on v12+ would otherwise resolve it to `undefined`
// and crash here via the failed-message render path (cloneElement on undefined).
import { Icon, pencil, rotateLeft, cautionFilled } from "@wordpress/icons";

/**
 * Internal dependencies
 */
import classnames from "classnames";
import { containsHtml, sanitizeHtml } from "../../utils/sanitizeHtml";
import { containsMarkdown, parseMarkdown, linkifyUrls } from "../../utils/markdownParser";
import { unescapeAiResponse } from "../../utils/helpers";
import { formatRelativeTime } from "../../utils/dateFormat";
import { attachCodeBlockCopy } from "../../utils/codeBlockCopy";
import useTypewriterReveal from "../../hooks/useTypewriterReveal";
import AssistantMessageShell from "../ui/AssistantMessageShell";
import MessageActions from "../ui/MessageActions";
import ToolExecutionList from "../ui/ToolExecutionList";

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

	// Parse the full message exactly once and reveal it progressively in the DOM
	// via useTypewriterReveal. No mid-stream re-parsing means no end-of-stream
	// reformat snap when inline-list / callout / status-badge detectors finally
	// cross their thresholds — the final layout is what the user sees from
	// character one.
	//
	// LOAD-BEARING: this useMemo's stable identity for `content` is what keeps
	// the reveal from restarting on every parent re-render (the typewriter hook
	// uses `message` as its restart key, but other code paths could end up
	// re-reading content). Don't drop the memo without checking the hook's
	// `contentKey` strategy.
	const { content, isRichContent } = useMemo(() => {
		const raw = unescapeAiResponse(message || "");
		if (!raw) {
			return { content: "", isRichContent: false };
		}

		if (isUser) {
			return { content: raw, isRichContent: false };
		}

		if (containsHtml(raw)) {
			return { content: sanitizeHtml(raw), isRichContent: true };
		}

		if (containsMarkdown(raw)) {
			return { content: sanitizeHtml(parseMarkdown(raw)), isRichContent: true };
		}

		// Plain text: linkify bare URLs and preserve newlines
		const linkified = linkifyUrls(raw);
		if (linkified !== raw) {
			const withBreaks = linkified.replace(/\n/g, "<br>");
			return { content: sanitizeHtml(withBreaks), isRichContent: true };
		}
		return { content: raw, isRichContent: false };
	}, [message, isUser]);

	// Auto-scroll throttle — fired from each typewriter tick.
	const lastGrowCallRef = useRef(0);
	const handleRevealTick = useCallback(() => {
		if (!onContentGrow) {
			return;
		}
		const now = Date.now();
		if (now - lastGrowCallRef.current < 80) {
			return;
		}
		lastGrowCallRef.current = now;
		onContentGrow();
	}, [onContentGrow]);

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

	// Single ref to the visible content node (rich or plain) — the typewriter
	// hook walks its text nodes to drive the reveal, and the post-render
	// effect below uses it to wire up the code-block copy buttons.
	const contentRef = useRef(null);

	const isRevealing = useTypewriterReveal({
		ref: contentRef,
		// Use the raw message (small, stable) as the restart key rather than the
		// multi-KB rendered HTML — keeps the dep compare cheap and the reveal
		// from restarting on identity-only changes to `content`.
		contentKey: message,
		enabled: !isUser && animateTyping && Boolean(content),
		onTick: handleRevealTick,
	});

	useEffect(() => {
		if (!isRichContent || !contentRef.current || isRevealing) {
			return undefined;
		}
		// Wait until the reveal finishes — code-block <pre> wrappers may sit
		// behind a `data-nfd-typewriter-pending` block ancestor mid-reveal.
		return attachCodeBlockCopy(contentRef.current);
	}, [isRichContent, content, isRevealing]);

	// Early returns may live below — by this point all hooks have been called.
	if (!content && (!executedTools || executedTools.length === 0)) {
		return null;
	}

	const rootClassName = classnames("nfd-ai-chat-message", `nfd-ai-chat-message--${displayType}`);

	// Native title attribute for hover tooltip; cheap, accessible, no portal needed.
	const tooltip = formatRelativeTime(timestamp) || undefined;

	// Action bar appears below assistant bubbles only — once content exists and the
	// typewriter has finished. Skipped while revealing so the user can't copy a
	// partial message.
	const shouldRenderActions = showActions && Boolean(content) && !isRevealing;

	const bubbleAndContent = content && (
		<div className="nfd-ai-chat-message__bubble-wrap">
			{isRichContent ? (
				/* content is sanitized in the useMemo above (sanitizeHtml) */
				<div
					ref={contentRef}
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
					ref={contentRef}
					className={classnames(
						"nfd-ai-chat-message__content",
						"nfd-ai-chat-message__content--pre-wrap",
						{
							"nfd-ai-chat-message__content--streaming": isRevealing,
							"nfd-ai-chat-message__content--failed": isFailed,
						}
					)}
					style={{ whiteSpace: "pre-wrap" }}
					title={tooltip}
				>
					{content}
				</div>
			)}
			{isFailed && (
				<div
					className="nfd-ai-chat-message__status nfd-ai-chat-message__status--failed"
					role="status"
				>
					<Icon icon={cautionFilled} size={12} />
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
