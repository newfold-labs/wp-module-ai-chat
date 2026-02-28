/**
 * WordPress dependencies
 */
import { useEffect, useRef, useCallback, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies
 */
import classnames from "classnames";
import ErrorAlert from "../ui/ErrorAlert";
import TypingIndicator from "../ui/TypingIndicator";
import ChatMessage from "./ChatMessage";

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
 * @param {boolean}  [props.isConnectingOrReconnecting] - When true, show a single "Connecting...." assistant message.
 * @param {string}   [props.messageBubbleStyle]         - 'bubbles' (default) or 'minimal'. Controls container and message bubble styling.
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
	messageBubbleStyle = "bubbles",
}) => {
	const scrollContainerRef = useRef(null);
	const [scrollTrigger, setScrollTrigger] = useState(0);

	const scrollToBottom = useCallback(() => {
		const el = scrollContainerRef.current;
		if (!el) {
			return;
		}
		el.scrollTo({
			top: el.scrollHeight - el.clientHeight,
			behavior: "smooth",
		});
	}, []);

	useEffect(() => {
		scrollToBottom();
	}, [messages, isLoading, toolProgress, scrollTrigger, scrollToBottom]);

	// Bump scroll trigger so the scroll effect runs again when the last message's content grows (e.g. typing).
	const onContentGrow = useCallback(() => {
		setScrollTrigger((t) => t + 1);
	}, []);

	// Only show executed tools in TypingIndicator when there is active or pending tool work.
	const hasActiveToolExecution =
		activeToolCall || executedTools.length > 0 || pendingTools.length > 0;

	// Hide the simple "Thinking..." dots when streaming content is already visible.
	// The streaming text IS the "thinking" — dots are redundant alongside it.
	const lastMessage = messages[messages.length - 1];
	const hasStreamingContent = lastMessage?.isStreaming;

	const messagesClassName = classnames("nfd-ai-chat-messages", {
		"nfd-ai-chat-messages--minimal": messageBubbleStyle === "minimal",
	});

	return (
		<div ref={scrollContainerRef} className={messagesClassName}>
			{messages.length > 0 &&
				messages.map((msg, index) => {
					// Animate typing only for the last assistant message that was received live (not loaded from history/restore)
					const isLastAssistant =
						index === messages.length - 1 && (msg.type === "assistant" || msg.role === "assistant");
					return (
						<ChatMessage
							key={msg.id || index}
							message={msg.content}
							type={msg.type}
							animateTyping={isLastAssistant && msg.animateTyping === true}
							onContentGrow={isLastAssistant ? onContentGrow : undefined}
							executedTools={msg.executedTools}
							toolResults={msg.toolResults}
						/>
					);
				})}
			{isConnectingOrReconnecting && !connectionFailed && (
				<div className="nfd-ai-chat-message nfd-ai-chat-message--assistant">
					<div className="nfd-ai-chat-message__content">
						<div className="nfd-ai-chat-typing-indicator">
							<span className="nfd-ai-chat-typing-indicator__dots" aria-hidden="true">
								<span></span>
								<span></span>
								<span></span>
							</span>
							<span className="nfd-ai-chat-typing-indicator__text">
								{__("Connecting….", "wp-module-ai-chat")}
							</span>
						</div>
					</div>
				</div>
			)}
			{error && <ErrorAlert message={error} />}
			{onRetry && (error || connectionFailed) && (
				<p className="nfd-ai-chat-messages__retry">
					<button type="button" className="nfd-ai-chat-messages__retry-button" onClick={onRetry}>
						{__("Retry", "wp-module-ai-chat")}
					</button>
				</p>
			)}
			{(isLoading || executedTools.length > 0) &&
				!(hasStreamingContent && !hasActiveToolExecution) && (
					<TypingIndicator
						status={status}
						activeToolCall={activeToolCall}
						toolProgress={toolProgress}
						executedTools={hasActiveToolExecution || !isLoading ? executedTools : []}
						pendingTools={pendingTools}
					/>
				)}
		</div>
	);
};

export default ChatMessages;
