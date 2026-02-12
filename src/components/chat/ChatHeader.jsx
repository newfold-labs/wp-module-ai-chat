/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies
 */
import BluBetaHeading from "../ui/BluBetaHeading";
import ChatHeaderBar from "../ui/ChatHeaderBar";

/** Outline sparkles icon for the header (matches lucide Sparkles). */
const SparklesOutlineIcon = ( props ) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="24"
		height="24"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
		focusable="false"
		{ ...props }
	>
		<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
		<path d="M5 3v4" />
		<path d="M19 17v4" />
		<path d="M3 5h4" />
		<path d="M17 19h4" />
	</svg>
);

/** Close (×) icon - inline SVG */
const CloseIcon = (props) => (
	<svg
		width="16"
		height="16"
		viewBox="0 0 24 24"
		xmlns="http://www.w3.org/2000/svg"
		aria-hidden="true"
		focusable="false"
		{...props}
	>
		<path
			d="M18 6L6 18M6 6l12 12"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

/**
 * ChatHeader Component
 *
 * Header for the chat panel: white background; left = outline sparkles icon + title + BETA pill.
 * New chat (+) and Close (×) on the right. Built on shared ChatHeaderBar.
 *
 * @param {Object}   props            - Component props.
 * @param {string}  [props.title]     - Title text next to logo (e.g. "Blu Chat"). Default "Blu Chat".
 * @param {Function} props.onNewChat   - Called when user clicks New chat (+).
 * @param {Function} props.onClose     - Called when user clicks Close (×).
 * @param {React.ReactNode} [props.extraActions] - Optional node(s) rendered between + and × (e.g. history dropdown trigger).
 * @param {boolean}  [props.newChatDisabled] - When true, the New chat (+) button is disabled (e.g. when already on welcome screen).
 * @return {JSX.Element} The ChatHeader component.
 */
const ChatHeader = ({ title, onNewChat, onClose, extraActions, newChatDisabled = false }) => (
	<ChatHeaderBar
		logo={<SparklesOutlineIcon width={20} height={20} />}
		title={title || __("Blu Chat", "wp-module-ai-chat")}
		badge={<BluBetaHeading />}
		rightActions={
			<>
				{typeof onNewChat === "function" && (
					<button
						type="button"
						className="nfd-ai-chat-header__btn nfd-ai-chat-header__btn--new"
						onClick={newChatDisabled ? undefined : onNewChat}
						disabled={newChatDisabled}
						aria-label={__("New chat", "wp-module-ai-chat")}
						title={__("New chat", "wp-module-ai-chat")}
					>
						+
					</button>
				)}
				{extraActions}
				{typeof onClose === "function" && (
					<button
						type="button"
						className="nfd-ai-chat-header__btn nfd-ai-chat-header__btn--close"
						onClick={onClose}
						aria-label={__("Close", "wp-module-ai-chat")}
						title={__("Close", "wp-module-ai-chat")}
					>
						<CloseIcon />
					</button>
				)}
			</>
		}
	/>
);

export default ChatHeader;
