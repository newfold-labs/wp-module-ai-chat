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
import { ArrowUp } from "lucide-react";
import { INPUT } from "../../constants/nfdAgents/input";

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
 * @param {string}                    [props.prefill]          - Optional text to seed the textarea with (e.g. when the user clicks "Edit" on a previous message). Treat as a one-shot intent: the input copies the value into its internal state, focuses, and then calls `onPrefillConsumed` so the parent can clear its pending state.
 * @param {Function}                  [props.onPrefillConsumed] - Called after a `prefill` value has been applied to the textarea. Receivers should clear whatever state was driving `prefill`.
 * @param {string}                    [props.lastUserMessage]   - When the textarea is empty and the user presses ↑, this string is loaded into the input (terminal/Slack pattern). Pass the most recent user-sent message, or null/empty to disable.
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
	prefill = null,
	onPrefillConsumed,
	lastUserMessage = "",
}) => {
	// Show stop button only when explicitly requested (e.g. generating), not when disabled for connecting/failed
	const showStop = showStopButton === true;
	const [message, setMessage] = useState("");
	const [isStopping, setIsStopping] = useState(false);
	const [isFocused, setIsFocused] = useState(false);
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

	// Focus textarea when it becomes enabled again. The null check inside the timeout
	// guards against the component unmounting between schedule and fire.
	useEffect(() => {
		if (!disabled && textareaRef.current) {
			const t = setTimeout(() => {
				if (textareaRef.current) {
					textareaRef.current.focus();
				}
			}, INPUT.FOCUS_DELAY);
			return () => clearTimeout(t);
		}
		return undefined;
	}, [disabled]);

	// One-shot prefill: when the parent provides text (e.g. from "Edit last message"), copy it
	// into local state, focus + place the caret at the end, and notify the parent to clear its
	// pending value so subsequent clicks of the same edit button still trigger.
	useEffect(() => {
		if (prefill === null || prefill === undefined) {
			return;
		}
		setMessage(prefill);
		const t = setTimeout(() => {
			if (textareaRef.current) {
				textareaRef.current.focus();
				const end = textareaRef.current.value.length;
				textareaRef.current.setSelectionRange(end, end);
			}
		}, INPUT.FOCUS_DELAY);
		if (onPrefillConsumed) {
			onPrefillConsumed();
		}
		return () => clearTimeout(t);
	}, [prefill, onPrefillConsumed]);

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
				return;
			}
			// ↑ on empty input → load the most recent user message (terminal/Slack convention).
			// Only fires when the textarea is empty so we never destroy in-progress text.
			if (e.key === "ArrowUp" && !e.shiftKey && !e.metaKey && !e.ctrlKey && message === "" && lastUserMessage) {
				e.preventDefault();
				setMessage(lastUserMessage);
				if (textareaRef.current) {
					// Place caret at end so the user can immediately keep typing/editing.
					const t = textareaRef.current;
					setTimeout(() => {
						t.focus();
						const end = t.value.length;
						t.setSelectionRange(end, end);
					}, 0);
				}
			}
		},
		[handleSubmit, message, lastUserMessage]
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
		"nfd-ai-chat-input--disabled": disabled && !showStop,
	});

	return (
		<div className={rootClassName}>
			<div className="nfd-ai-chat-input__container">
				{contextComponent && (
					<div className="nfd-ai-chat-input__context-row">{contextComponent}</div>
				)}
				<div className="nfd-ai-chat-input__row">
					<textarea
						name="nfd-ai-chat-input"
						ref={textareaRef}
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						onKeyDown={handleKeyDown}
						onFocus={() => setIsFocused(true)}
						onBlur={() => setIsFocused(false)}
						placeholder={placeholder || defaultPlaceholder}
						className="nfd-ai-chat-input__textarea"
						rows={1}
						disabled={disabled}
					/>
					{showStop ? (
						<Button
							icon={
								<span
									className="nfd-ai-chat-input__stop-icon"
									aria-hidden="true"
								/>
							}
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
							disabled={!message.trim() || disabled}
						/>
					)}
				</div>
			</div>
			<div
				className={classnames("nfd-ai-chat-input__hint", {
					"nfd-ai-chat-input__hint--visible": isFocused && !disabled,
				})}
				aria-hidden="true"
			>
				<span className="nfd-ai-chat-input__hint-key">{"↵"}</span>
				{" "}
				{__("to send", "wp-module-ai-chat")}
				{" · "}
				<span className="nfd-ai-chat-input__hint-key">{"⇧↵"}</span>
				{" "}
				{__("for new line", "wp-module-ai-chat")}
				{lastUserMessage ? (
					<>
						{" · "}
						<span className="nfd-ai-chat-input__hint-key">{"↑"}</span>
						{" "}
						{__("to recall last", "wp-module-ai-chat")}
					</>
				) : null}
			</div>
			<div className="nfd-ai-chat-input__disclaimer">
				{__("AI-generated content is not guaranteed for accuracy.", "wp-module-ai-chat")}
			</div>
		</div>
	);
};

export default ChatInput;
