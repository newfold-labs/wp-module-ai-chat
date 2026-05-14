/**
 * External dependencies
 */
import classnames from "classnames";

/**
 * Internal dependencies
 */
import { SparklesOutlineIcon } from "../icons";

/**
 * AssistantMessageShell Component
 *
 * Shared wrapper that renders the assistant-message layout: small purple sparkles avatar on the
 * left, content stacked on the right. Used by ChatMessage (real messages), ChatMessages
 * (inline connecting indicator) and TypingIndicator so all three share one DOM/CSS contract.
 *
 * Pair with the `--assistant` row layout in `_messages.scss`. CSS hides the avatar on
 * consecutive assistant turns so a run reads as one voice (`visibility: hidden` keeps the slot
 * reserved so text stays aligned with the first turn).
 *
 * @param {Object}                    props
 * @param {import('react').ReactNode} props.children    - The message body (bubble-wrap, indicators, tools, etc.).
 * @param {string}                    [props.className] - Optional extra class on the row (e.g. `nfd-ai-chat-message--fallback` to opt out of the consecutive-avatar rule).
 * @return {JSX.Element} The assistant message row.
 */
const AssistantMessageShell = ({ children, className }) => (
	<div className={classnames("nfd-ai-chat-message", "nfd-ai-chat-message--assistant", className)}>
		<div className="nfd-ai-chat-message__avatar" aria-hidden="true">
			{/* Solid icon coloured via CSS `color` on the parent — no gradient. */}
			<SparklesOutlineIcon width={16} height={16} />
		</div>
		<div className="nfd-ai-chat-message__main">{children}</div>
	</div>
);

export default AssistantMessageShell;
