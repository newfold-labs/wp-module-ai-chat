/**
 * WordPress dependencies
 */
import { useEffect, useRef, useCallback, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

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
 * Auto-scrolls to bottom when new messages arrive or when the last message content grows (e.g. typing animation).
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
 * @param {Function} [props.onRetry]      - Callback when user clicks Retry (e.g. after connection failed).
 * @param {boolean} [props.connectionFailed] - Whether connection has failed (show Retry without red error).
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
	onRetry,
	connectionFailed = false,
	brandId,
}) => {
	const scrollContainerRef = useRef(null);
	const [scrollTrigger, setScrollTrigger] = useState(0);

	const scrollToBottom = useCallback(() => {
		const el = scrollContainerRef.current;
		if (!el) return;
		el.scrollTo({
			top: el.scrollHeight - el.clientHeight,
			behavior: "smooth",
		});
	}, []);

	useEffect(() => {
		scrollToBottom();
	}, [messages, isLoading, toolProgress, scrollTrigger, scrollToBottom]);

	const onContentGrow = useCallback(() => {
		setScrollTrigger((t) => t + 1);
	}, []);

	const hasActiveToolExecution =
		activeToolCall || executedTools.length > 0 || pendingTools.length > 0;

	return (
		<div ref={scrollContainerRef} className="nfd-ai-chat-messages">
			{messages.length > 0 &&
				messages.map((msg, index) => {
					// Animate typing only for the last assistant message that was received live (not loaded from history/restore)
					const isLastAssistant =
						index === messages.length - 1 &&
						(msg.type === "assistant" || msg.role === "assistant");
					return (
						<ChatMessage
							key={msg.id || index}
							message={msg.content}
							type={msg.type}
							animateTyping={isLastAssistant && msg.animateTyping === true}
							onContentGrow={isLastAssistant ? onContentGrow : undefined}
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
							toolResults={msg.toolResults}
						/>
					);
				})}
			{error && <ErrorAlert message={error} />}
			{onRetry && (error || connectionFailed) && (
				<p className="nfd-ai-chat-messages__retry">
					<button
						type="button"
						className="nfd-ai-chat-messages__retry-button"
						onClick={onRetry}
					>
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
	);
};

export default ChatMessages;
