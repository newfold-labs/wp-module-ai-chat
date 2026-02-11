/**
 * WordPress dependencies
 */
import { useMemo, useState, useEffect, useRef } from "@wordpress/element";

/**
 * Internal dependencies
 */
import { containsHtml, sanitizeHtml } from "../../utils/sanitizeHtml";
import { containsMarkdown, parseMarkdown, linkifyUrls } from "../../utils/markdownParser";
import { unescapeAiResponse } from "../../utils/helpers";
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
 * @param {Object} props                    - The component props.
 * @param {string} props.message            - The message content to display.
 * @param {string} [props.type="assistant"] - The message type ("user" or "assistant").
 * @param {boolean} [props.animateTyping]   - When true, reveal assistant content with a typing effect.
 * @param {Function} [props.onContentGrow] - Called when displayed content grows (e.g. for scroll-into-view).
 * @param {Array}  [props.executedTools=[]] - List of executed tools to show inline.
 * @param {Function} [props.onExecuteTool] - Function to execute tool via MCP.
 * @param {Function} [props.onSendMessage] - Function to send message back to agent (shows in UI).
 * @param {Function} [props.onSendSystemMessage] - Function to send message to agent (hidden from UI).
 * @param {string} [props.conversationId]  - Conversation ID for message correlation.
 * @param {Function} [props.onClearTyping] - Callback to clear typing indicator.
 * @param {string} [props.brandId]         - Brand identifier for styling.
 * @param {Array}  [props.toolResults=[]]   - Results from tool executions.
 * @return {JSX.Element} The ChatMessage component.
 */
const ChatMessage = ({
	message,
	type = "assistant",
	animateTyping = false,
	onContentGrow,
	executedTools = [],
	onExecuteTool,
	onSendMessage,
	onSendSystemMessage,
	conversationId,
	onClearTyping,
	brandId,
	toolResults = [],
}) => {
	// Treat approval_request as assistant so the thread still displays
	const displayType = type === "approval_request" ? "assistant" : type;
	const isUser = displayType === "user";

	const fullLength = (message || "").length;
	const [displayedLength, setDisplayedLength] = useState(() =>
		animateTyping ? 0 : fullLength
	);

	// When not animating, show full message; when animating, drive displayedLength toward fullLength
	useEffect(() => {
		if (!animateTyping) {
			setDisplayedLength(fullLength);
			return;
		}
		const interval = setInterval(() => {
			setDisplayedLength((prev) => {
				if (prev >= fullLength) return prev;
				return Math.min(prev + TYPING_CHARS_PER_TICK, fullLength);
			});
		}, TYPING_TICK_MS);
		return () => clearInterval(interval);
	}, [animateTyping, fullLength]);

	// Notify parent when content grows (for auto-scroll), throttled to avoid excessive updates
	const lastGrowCallRef = useRef(0);
	useEffect(() => {
		if (!onContentGrow || !animateTyping || displayedLength === 0) return;
		const now = Date.now();
		if (now - lastGrowCallRef.current < 80) return;
		lastGrowCallRef.current = now;
		onContentGrow();
	}, [displayedLength, animateTyping, onContentGrow]);

	const effectiveMessage = animateTyping
		? (message || "").slice(0, displayedLength)
		: (message || "");

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

	// Don't render if there's no content and no tools.
	if (!content && (!executedTools || executedTools.length === 0)) {
		return null;
	}

	return (
		<div className={`nfd-ai-chat-message nfd-ai-chat-message--${displayType}`}>
			{content &&
				(isRichContent ? (
					<div
						className="nfd-ai-chat-message__content nfd-ai-chat-message__content--rich"
						dangerouslySetInnerHTML={{ __html: content }}
					/>
				) : (
					<div className="nfd-ai-chat-message__content nfd-ai-chat-message__content--pre-wrap" style={{ whiteSpace: "pre-wrap" }}>
						{content}
					</div>
				))}
			{executedTools && executedTools.length > 0 && (
				<ToolExecutionList executedTools={executedTools} toolResults={toolResults} />
			)}
		</div>
	);
};

export default ChatMessage;
