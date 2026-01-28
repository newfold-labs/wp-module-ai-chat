/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";
import { Icon } from "@wordpress/components";
import { comment } from "@wordpress/icons";

/**
 * BluBetaHeading Component
 *
 * A heading component that displays "BLU" with a chat bubble icon and "BETA" badge.
 * Styled similar to the pill button but as a heading element.
 *
 * @return {JSX.Element} The BluBetaHeading component.
 */
const BluBetaHeading = () => (
	<div className="nfd-ai-chat-blu-beta-heading">
		<div className="nfd-ai-chat-blu-beta-heading__main">
			<Icon
				icon={comment}
				size={16}
				className="nfd-ai-chat-blu-beta-heading__icon"
			/>
			<span className="nfd-ai-chat-blu-beta-heading__text">
				{__("BLU", "wp-module-ai-chat")}
			</span>
		</div>
		<div className="nfd-ai-chat-blu-beta-heading__badge">
			{__("BETA", "wp-module-ai-chat")}
		</div>
	</div>
);

export default BluBetaHeading;
