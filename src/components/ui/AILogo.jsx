/**
 * Internal dependencies
 */
import { ReactComponent as BluLogo } from "../../svg/blu-logo.svg";

/**
 * AILogo Component
 *
 * A reusable logo component for the AI assistant with purple gradient background
 * and BLU beta logo icon.
 *
 * @param {Object} props        - The component props.
 * @param {number} props.width  - The width of the logo (default: 24).
 * @param {number} props.height - The height of the logo (default: 24).
 * @return {JSX.Element} The AILogo component.
 */
const AILogo = ( { width = 24, height = 24 } ) => (
	<div
		className="nfd-ai-chat-avatar"
		style={ {
			width,
			height,
		} }
	>
		<BluLogo width={ width * 0.625 } height={ height * 0.625 } />
	</div>
);

export default AILogo;
