/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies
 */
import AILogo from "../ui/AILogo";
import BluBetaHeading from "../ui/BluBetaHeading";
import ChatHeaderBar from "../ui/ChatHeaderBar";

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
 * Header for the chat panel: white background; left = AILogo + plain title text + BETA pill
 * (matches screenshot and editor-chat pattern). New chat (+) and Close (×) on the right.
 * Built on shared ChatHeaderBar.
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
		logo={<AILogo width={24} height={24} />}
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
