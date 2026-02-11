/**
 * WordPress dependencies
 */
import { useMemo } from "@wordpress/element";

/**
 * Internal dependencies
 */
import { containsHtml, sanitizeHtml } from "../../utils/sanitizeHtml";
import { containsMarkdown, parseMarkdown } from "../../utils/markdownParser";
import ToolExecutionList from "../ui/ToolExecutionList";

/**
 * ChatMessage Component
 *
 * Displays a single message in the chat with appropriate styling.
 * Supports HTML and Markdown rendering for assistant messages.
 *
 * @param {Object} props                    - The component props.
 * @param {string} props.message            - The message content to display.
 * @param {string} [props.type="assistant"] - The message type ("user" or "assistant").
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

	const { content, isRichContent } = useMemo(() => {
		if (!message) {
			return { content: "", isRichContent: false };
		}

		if (isUser) {
			return { content: message, isRichContent: false };
		}

		if (containsHtml(message)) {
			return { content: sanitizeHtml(message), isRichContent: true };
		}

		if (containsMarkdown(message)) {
			const parsed = parseMarkdown(message);
			return { content: sanitizeHtml(parsed), isRichContent: true };
		}

		return { content: message, isRichContent: false };
	}, [message, isUser]);

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
					<div className="nfd-ai-chat-message__content">{content}</div>
				))}
			{executedTools && executedTools.length > 0 && (
				<ToolExecutionList executedTools={executedTools} toolResults={toolResults} />
			)}
		</div>
	);
};

export default ChatMessage;
