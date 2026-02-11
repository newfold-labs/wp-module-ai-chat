/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * BluBetaHeading Component
 *
 * Single solid dark blue BETA badge for the chat header (matches screenshot and
 * editor-chat: AILogo + "Blu Chat" plain text + this BETA pill).
 *
 * @return {JSX.Element} The BluBetaHeading component.
 */
const BluBetaHeading = () => (
	<span className="nfd-ai-chat-blu-beta-badge">
		{__("BETA", "wp-module-ai-chat")}
	</span>
);

export default BluBetaHeading;
