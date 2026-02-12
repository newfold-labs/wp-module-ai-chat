/**
 * WordPress dependencies
 */
import { Button } from "@wordpress/components";
import { useCallback, useEffect, useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import classnames from "classnames";
import { ArrowUp, CircleStop } from "lucide-react";
import { INPUT } from "../../config/constants";

/**
 * ChatInput Component
 *
 * Context-agnostic chat input field. Accepts optional contextComponent prop
 * for consumers to inject their own context indicators (e.g., selected block).
 *
 * @param {Object}                    props                    - The component props.
 * @param {Function}                  props.onSendMessage      - Function to call when message is sent.
 * @param {Function}                  props.onStopRequest      - Function to call when stop button is clicked.
 * @param {boolean}                   props.disabled           - Whether the input is disabled.
 * @param {boolean}                   props.showStopButton     - When true, show stop button instead of send (e.g. when generating). When false, show send even if disabled.
 * @param {string}                    props.placeholder        - Input placeholder text.
 * @param {import('react').ReactNode} [props.contextComponent] - Optional context component to render (e.g. selected block).
 * @param {boolean}                   [props.showTopBorder]    - When false, omits the top border. Default true.
 * @return {JSX.Element} The ChatInput component.
 */
const ChatInput = ({
	onSendMessage,
	onStopRequest,
	disabled = false,
	showStopButton,
	placeholder,
	contextComponent = null,
	showTopBorder = true,
}) => {
	// Show stop button only when explicitly requested (e.g. generating), not when disabled for connecting
	const showStop = showStopButton ?? disabled;
	const [message, setMessage] = useState("");
	const [isStopping, setIsStopping] = useState(false);
	const textareaRef = useRef(null);

	const defaultPlaceholder = __("How can I help you today?", "wp-module-ai-chat");

	// Auto-resize textarea as user types
	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
			const scrollHeight = textareaRef.current.scrollHeight;
			const newHeight = Math.min(scrollHeight, INPUT.MAX_HEIGHT);
			textareaRef.current.style.height = `${newHeight}px`;

			// Only show scrollbar when content actually overflows
			// This prevents the disabled scrollbar from appearing when empty
			if (scrollHeight > INPUT.MAX_HEIGHT) {
				textareaRef.current.style.overflowY = "auto";
			} else {
				textareaRef.current.style.overflowY = "hidden";
			}
		}
	}, [message]);

	// Focus textarea when it becomes enabled again
	useEffect(() => {
		if (!disabled && textareaRef.current) {
			setTimeout(() => {
				textareaRef.current.focus();
			}, INPUT.FOCUS_DELAY);
		}
	}, [disabled]);

	const handleSubmit = useCallback(() => {
		if (message.trim() && !disabled) {
			onSendMessage(message);
			setMessage("");
			if (textareaRef.current) {
				textareaRef.current.style.height = "auto";
				textareaRef.current.style.overflowY = "hidden";
				textareaRef.current.focus();
			}
		}
	}, [message, disabled, onSendMessage]);

	const handleKeyDown = useCallback(
		(e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleSubmit();
			}
		},
		[handleSubmit]
	);

	const handleStopRequest = useCallback(() => {
		if (isStopping) {
			return;
		}
		setIsStopping(true);
		if (onStopRequest) {
			onStopRequest();
		}
		setTimeout(() => {
			setIsStopping(false);
		}, INPUT.STOP_DEBOUNCE);
	}, [isStopping, onStopRequest]);

	const rootClassName = classnames("nfd-ai-chat-input", {
		"nfd-ai-chat-input--no-top-border": !showTopBorder,
	});

	return (
		<div className={rootClassName}>
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
					{showStop ? (
						<Button
							icon={<CircleStop width={16} height={16} />}
							label={__("Stop generating", "wp-module-ai-chat")}
							onClick={handleStopRequest}
							className="nfd-ai-chat-input__stop"
							disabled={isStopping}
							aria-busy={isStopping}
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
