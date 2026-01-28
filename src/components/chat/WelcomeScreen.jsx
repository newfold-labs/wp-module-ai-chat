/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies
 */
import BluBetaHeading from "../ui/BluBetaHeading";
import SuggestionButton from "../ui/SuggestionButton";

/**
 * WelcomeScreen Component
 *
 * Displays the welcome screen with AI avatar, introduction message, and suggestion tags.
 *
 * @param {Object}   props                 - The component props.
 * @param {Function} props.onSendMessage   - Function to call when a suggestion is clicked.
 * @param {string}   props.title           - Custom welcome title (optional).
 * @param {string}   props.subtitle        - Custom welcome subtitle (optional).
 * @param {Array}    props.suggestions     - Custom suggestions array (optional).
 * @param {boolean}  props.showSuggestions - Whether to show suggestions (default: false).
 * @return {JSX.Element} The WelcomeScreen component.
 */
const WelcomeScreen = ({
	onSendMessage,
	title,
	subtitle,
	suggestions = [],
	showSuggestions = false,
}) => {
	const defaultTitle = __("Hi, I'm your AI assistant.", "wp-module-ai-chat");
	const defaultSubtitle = __("How can I help you today?", "wp-module-ai-chat");

	return (
		<div className="nfd-ai-chat-welcome">
			<div className="nfd-ai-chat-welcome__content">
				<div className="nfd-ai-chat-welcome__heading">
					<BluBetaHeading />
				</div>
				<div className="nfd-ai-chat-welcome__message">
					<div className="nfd-ai-chat-welcome__title">{title || defaultTitle}</div>
					<div className="nfd-ai-chat-welcome__subtitle">{subtitle || defaultSubtitle}</div>
				</div>
			</div>
			{showSuggestions && suggestions.length > 0 && (
				<div className="nfd-ai-chat-suggestions">
					{suggestions.map((suggestion, index) => (
						<SuggestionButton
							key={index}
							icon={suggestion.icon}
							text={suggestion.text}
							onClick={() => onSendMessage(suggestion.action || suggestion.text)}
						/>
					))}
				</div>
			)}
		</div>
	);
};

export default WelcomeScreen;
