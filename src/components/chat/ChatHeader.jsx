/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies
 */
import { CloseIcon, SparklesOutlineIcon } from "../icons";
import BluBetaHeading from "../ui/BluBetaHeading";
import HeaderBar from "../ui/HeaderBar";

/**
 * ChatHeader Component
 *
 * Header for the chat panel: white background; left = outline sparkles icon + title + BETA pill.
 * New chat (+) and Close (×) on the right. Built on shared HeaderBar layout.
 *
 * @param {Object}                    props                   - Component props.
 * @param {string}                    [props.title]           - Title text next to logo (e.g. "Blu Chat"). Default "Blu Chat".
 * @param {Function}                  props.onNewChat         - Called when user clicks New chat (+).
 * @param {Function}                  props.onClose           - Called when user clicks Close (×).
 * @param {import('react').ReactNode} [props.extraActions]    - Optional node(s) rendered between + and × (e.g. history dropdown trigger).
 * @param {boolean}                   [props.newChatDisabled] - When true, the New chat (+) button is disabled (e.g. when already on welcome screen).
 * @return {JSX.Element} The ChatHeader component.
 */
const ChatHeader = ({ title, onNewChat, onClose, extraActions, newChatDisabled = false }) => (
	<HeaderBar
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
