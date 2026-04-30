/**
 * MessageGroupDivider Component
 *
 * Subtle horizontal divider with a centered date label, e.g. "Today" / "Yesterday" / "Apr 28".
 * Renders nothing when label is empty so callers can pass results from `formatDateGroup` directly.
 *
 * @param {Object} props
 * @param {string} props.label - Label rendered in the centered chip; required for visibility.
 * @return {JSX.Element|null} The divider, or null when label is empty.
 */
const MessageGroupDivider = ({ label }) => {
	if (!label) {
		return null;
	}
	return (
		<div className="nfd-ai-chat-message-divider" role="separator" aria-label={label}>
			<span className="nfd-ai-chat-message-divider__label">{label}</span>
		</div>
	);
};

export default MessageGroupDivider;
