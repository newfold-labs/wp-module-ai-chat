/**
 * ChatHeaderBar Component
 *
 * Shared header bar with configurable title, badge, and action slots.
 * Used by ChatHeader (help center / modal) and SidebarHeader (editor chat).
 *
 * @param {Object}   props                - Component props.
 * @param {string|React.ReactNode} [props.title]  - Title content (e.g. "Blu Chat").
 * @param {React.ReactNode} [props.badge] - Badge node (e.g. BETA pill).
 * @param {React.ReactNode} [props.logo] - Optional logo/icon left of title.
 * @param {React.ReactNode} [props.leftActions]  - Optional actions on the left side of the actions area.
 * @param {React.ReactNode} [props.rightActions] - Actions on the right (e.g. New chat, Close).
 * @param {string} [props.className]     - Optional extra class for the root.
 * @return {JSX.Element} The ChatHeaderBar component.
 */
const ChatHeaderBar = ({
	title,
	badge,
	logo,
	leftActions,
	rightActions,
	className = "",
}) => (
	<div
		className={`nfd-ai-chat-header ${className}`.trim()}
		role="banner"
	>
		<div className="nfd-ai-chat-header__brand">
			{logo}
			{title != null && (
				<span className="nfd-ai-chat-header__title">{title}</span>
			)}
			{badge}
		</div>
		{(leftActions || rightActions) && (
			<div className="nfd-ai-chat-header__actions">
				{leftActions}
				{rightActions}
			</div>
		)}
	</div>
);

export default ChatHeaderBar;
