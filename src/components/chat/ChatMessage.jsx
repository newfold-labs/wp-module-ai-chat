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
import InlineApproval from "../ui/InlineApproval";

/**
 * ChatMessage Component
 *
 * Displays a single message in the chat with appropriate styling.
 * Supports HTML and Markdown rendering for assistant messages.
 *
 * @param {Object} props                    - The component props.
 * @param {string} props.message            - The message content to display.
 * @param {string} [props.type="assistant"] - The message type ("user", "assistant", or "approval_request").
 * @param {Array}  [props.executedTools=[]] - List of executed tools to show inline.
 * @param {Object} [props.approvalRequest]  - Approval request data for approval_request type.
 * @param {Function} [props.onApprove]      - Callback when user approves.
 * @param {Function} [props.onReject]      - Callback when user rejects.
 * @param {Function} [props.onExecuteTool] - Function to execute tool via MCP.
 * @param {Function} [props.onSendMessage] - Function to send message back to agent (shows in UI).
 * @param {Function} [props.onSendSystemMessage] - Function to send message to agent (hidden from UI).
 * @param {string} [props.conversationId]  - Conversation ID for message correlation.
 * @param {Function} [props.onClearTyping] - Callback to clear typing indicator.
 * @param {string} [props.brandId]         - Brand identifier for styling.
 * @return {JSX.Element} The ChatMessage component.
 */
const ChatMessage = ({
	message,
	type = "assistant",
	executedTools = [],
	approvalRequest,
	onApprove,
	onReject,
	onExecuteTool,
	onSendMessage,
	onSendSystemMessage,
	conversationId,
	onClearTyping,
	brandId,
}) => {
	// If this is an approval request message, render inline approval
	if (type === 'approval_request') {
		if (approvalRequest) {
			// Render approval component
			return (
				<div className={`nfd-ai-chat-message nfd-ai-chat-message--approval`}>
					<InlineApproval
						approvalRequest={approvalRequest}
						onApprove={onApprove}
						onReject={onReject}
						onExecuteTool={onExecuteTool}
						onSendMessage={onSendMessage}
						onSendSystemMessage={onSendSystemMessage}
						conversationId={conversationId}
						onClearTyping={onClearTyping}
						brandId={brandId}
					/>
				</div>
			);
		}
		// Approval was cancelled/rejected, render as regular message
		// Fall through to regular message rendering below
		// The message content should already be updated to show cancellation
	}

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

	// Don't render if there's no content and no tools.
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
