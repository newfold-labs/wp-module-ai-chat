/**
 * WordPress dependencies
 */
import { Button } from "@wordpress/components";
import { useEffect, useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { ArrowUp, CircleStop } from "lucide-react";

/**
 * ChatInput Component
 *
 * Context-agnostic chat input field. Accepts optional contextComponent prop
 * for consumers to inject their own context indicators (e.g., selected block).
 *
 * @param {Object}      props                  - The component props.
 * @param {Function}    props.onSendMessage    - Function to call when message is sent.
 * @param {Function}    props.onStopRequest    - Function to call when stop button is clicked.
 * @param {boolean}     props.disabled         - Whether the input is disabled.
 * @param {string}      props.placeholder      - Input placeholder text.
 * @param {JSX.Element} props.contextComponent - Optional context component to render.
 * @return {JSX.Element} The ChatInput component.
 */
const ChatInput = ({
	onSendMessage,
	onStopRequest,
	disabled = false,
	placeholder,
	contextComponent = null,
}) => {
	const [message, setMessage] = useState("");
	const textareaRef = useRef(null);

	const defaultPlaceholder = __("How can I help you today?", "wp-module-ai-chat");

	// Auto-resize textarea as user types
	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
			const newHeight = Math.min(textareaRef.current.scrollHeight, 200);
			textareaRef.current.style.height = `${newHeight}px`;
		}
	}, [message]);

	// Focus textarea when it becomes enabled again
	useEffect(() => {
		if (!disabled && textareaRef.current) {
			setTimeout(() => {
				textareaRef.current.focus();
			}, 100);
		}
	}, [disabled]);

	const handleSubmit = () => {
		if (message.trim() && !disabled) {
			onSendMessage(message);
			setMessage("");
			if (textareaRef.current) {
				textareaRef.current.style.height = "auto";
				textareaRef.current.focus();
			}
		}
	};

	const handleKeyDown = (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	};

	return (
		<div className="nfd-ai-chat-input">
			<div className="nfd-ai-chat-input__container">
				<textarea
					name="nfd-ai-chat-input"
					ref={textareaRef}
					value={message}
					onChange={(e) => setMessage(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={placeholder || defaultPlaceholder}
					className="nfd-ai-chat-input__textarea"
					rows={1}
					disabled={disabled}
				/>
				<div className="nfd-ai-chat-input__actions">
					{contextComponent}
					{disabled ? (
						<Button
							icon={<CircleStop width={16} height={16} />}
							label={__("Stop generating", "wp-module-ai-chat")}
							onClick={onStopRequest}
							className="nfd-ai-chat-input__stop"
						/>
					) : (
						<Button
							icon={<ArrowUp width={16} height={16} />}
							label={__("Send message", "wp-module-ai-chat")}
							onClick={handleSubmit}
							className="nfd-ai-chat-input__submit"
							disabled={!message.trim()}
						/>
					)}
				</div>
			</div>
			<div className="nfd-ai-chat-input__disclaimer">
				{__("AI-generated content is not guaranteed for accuracy.", "wp-module-ai-chat")}
			</div>
		</div>
	);
};

export default ChatInput;
