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
 * @return {JSX.Element} The ChatMessage component.
 */
const ChatMessage = ({ message, type = "assistant", executedTools = [] }) => {
	const isUser = type === "user";

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

	if (!content && (!executedTools || executedTools.length === 0)) {
		return null;
	}

	return (
		<div className={`nfd-ai-chat-message nfd-ai-chat-message--${type}`}>
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
				<ToolExecutionList executedTools={executedTools} />
			)}
		</div>
	);
};

export default ChatMessage;
