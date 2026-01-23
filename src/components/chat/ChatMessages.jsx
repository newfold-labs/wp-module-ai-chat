/**
 * WordPress dependencies
 */
import { useEffect, useRef } from "@wordpress/element";

/**
 * Internal dependencies
 */
import ErrorAlert from "../ui/ErrorAlert";
import TypingIndicator from "../ui/TypingIndicator";
import ChatMessage from "./ChatMessage";

/**
 * ChatMessages Component
 *
 * Scrollable container for all chat messages.
 * Auto-scrolls to bottom when new messages arrive.
 *
 * @param {Object}  props                - The component props.
 * @param {Array}   props.messages       - The messages to display.
 * @param {boolean} props.isLoading      - Whether the AI is generating a response.
 * @param {string}  props.error          - Error message to display (optional).
 * @param {string}  props.status         - The current status.
 * @param {Object}  props.activeToolCall - The currently executing tool call (optional).
 * @param {string}  props.toolProgress   - Real-time progress message (optional).
 * @param {Array}   props.executedTools  - List of completed tool executions (optional).
 * @param {Array}   props.pendingTools   - List of pending tools to execute (optional).
 * @param {Function} [props.onApprove]   - Callback when user approves action.
 * @param {Function} [props.onReject]   - Callback when user rejects action.
 * @param {Function} [props.onExecuteTool] - Function to execute tool via MCP.
 * @param {Function} [props.onSendMessage] - Function to send message back to agent (shows in UI).
 * @param {Function} [props.onSendSystemMessage] - Function to send message to agent (hidden from UI).
 * @param {string} [props.conversationId] - Conversation ID for message correlation.
 * @param {Function} [props.onClearTyping] - Callback to clear typing indicator.
 * @param {string} [props.brandId]       - Brand identifier for styling.
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
	onApprove,
	onReject,
	onExecuteTool,
	onSendMessage,
	onSendSystemMessage,
	conversationId,
	onClearTyping,
	brandId,
}) => {
	const messagesEndRef = useRef(null);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, isLoading, toolProgress]);

	const hasActiveToolExecution =
		activeToolCall || executedTools.length > 0 || pendingTools.length > 0;

	return (
		<div className="nfd-ai-chat-messages">
			{messages.length > 0 &&
				messages.map((msg, index) => (
					<ChatMessage
						key={msg.id || index}
						message={msg.content}
						type={msg.type}
						executedTools={msg.executedTools}
						approvalRequest={msg.approvalRequest}
						onApprove={onApprove}
						onReject={onReject}
						onExecuteTool={onExecuteTool}
						onSendMessage={onSendMessage}
						onSendSystemMessage={onSendSystemMessage}
						conversationId={conversationId}
						onClearTyping={onClearTyping}
						brandId={brandId}
					/>
				))}
			{error && <ErrorAlert message={error} />}
			{isLoading && (
				<TypingIndicator
					status={status}
					activeToolCall={activeToolCall}
					toolProgress={toolProgress}
					executedTools={hasActiveToolExecution ? executedTools : []}
					pendingTools={pendingTools}
				/>
			)}
			<div ref={messagesEndRef} />
		</div>
	);
};

export default ChatMessages;
