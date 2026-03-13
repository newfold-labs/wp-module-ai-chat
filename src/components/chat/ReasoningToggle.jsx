/**
 * WordPress dependencies
 */
import { useState, useEffect, useRef } from "@wordpress/element";

/**
 * Internal dependencies
 */
import classnames from "classnames";

/**
 * ReasoningToggle Component
 *
 * Collapsible toggle that displays AI reasoning text.
 * Starts expanded while reasoning is active (streaming), then auto-collapses
 * to "Reasoned for X seconds" when reasoning completes and tools begin.
 *
 * @param {Object}   props                     - The component props.
 * @param {string}   props.text                - The reasoning text content.
 * @param {boolean}  [props.isActive=false]    - Whether reasoning is still in progress.
 * @param {number}   [props.durationSeconds=0] - How long reasoning took (shown when complete).
 * @param {Function} [props.onContentGrow]     - Called when displayed content grows (for scroll-into-view).
 * @return {JSX.Element} The ReasoningToggle component.
 */
const ReasoningToggle = ({ text, isActive = false, durationSeconds = 0, onContentGrow }) => {
	// Start expanded when active (streaming), collapsed when complete
	const [isExpanded, setIsExpanded] = useState(isActive);
	const prevIsActiveRef = useRef(isActive);

	// Auto-collapse when reasoning transitions from active → complete
	useEffect(() => {
		if (prevIsActiveRef.current && !isActive) {
			setIsExpanded(false);
		}
		prevIsActiveRef.current = isActive;
	}, [isActive]);

	// Notify parent when content grows (for auto-scroll)
	const prevLengthRef = useRef((text || "").length);
	useEffect(() => {
		const len = (text || "").length;
		if (onContentGrow && isExpanded && len > prevLengthRef.current) {
			onContentGrow();
		}
		prevLengthRef.current = len;
	}, [text, isExpanded, onContentGrow]);

	let label;
	if (isActive) {
		label = "Thinking";
	} else if (durationSeconds > 0) {
		label = `Thought for ${durationSeconds} second${durationSeconds !== 1 ? "s" : ""}`;
	} else {
		label = "Thought";
	}

	return (
		<div
			className={classnames("nfd-ai-chat-reasoning-toggle", {
				"is-active": isActive,
				"is-expanded": isExpanded,
			})}
		>
			<button
				type="button"
				className="nfd-ai-chat-reasoning-toggle__trigger"
				onClick={() => setIsExpanded(!isExpanded)}
				aria-expanded={isExpanded}
			>
				<span className="nfd-ai-chat-reasoning-toggle__label">{label}</span>
				<span className="nfd-ai-chat-reasoning-toggle__icon" aria-hidden="true">
					&#x203A;
				</span>
			</button>
			{isExpanded && (text || "") && (
				<div className="nfd-ai-chat-reasoning-toggle__content">{text}</div>
			)}
		</div>
	);
};

export default ReasoningToggle;
