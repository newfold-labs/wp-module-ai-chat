/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";
import { useState, useEffect, useRef } from "@wordpress/element";

/**
 * Internal dependencies
 */
import AILogo from "../ui/AILogo";
import SuggestionButton from "../ui/SuggestionButton";

const TYPING_SPEED_MS = 40;

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
 * @param {boolean}  props.animateWelcome  - Whether to type the welcome text (default: false).
 * @return {JSX.Element} The WelcomeScreen component.
 */
const WelcomeScreen = ({
	onSendMessage,
	title,
	subtitle,
	suggestions = [],
	showSuggestions = false,
	animateWelcome = false,
}) => {
	const defaultTitle = __("Hi, I'm your AI assistant.", "wp-module-ai-chat");
	const defaultSubtitle = __("How can I help you today?", "wp-module-ai-chat");

	const titleText = title || defaultTitle;
	const subtitleText = subtitle || defaultSubtitle;
	const fullText = `${titleText} ${subtitleText}`;

	const [displayedLength, setDisplayedLength] = useState(0);
	const timeoutRef = useRef(null);

	useEffect(() => {
		if (!animateWelcome) {
			setDisplayedLength(fullText.length);
			return;
		}
		setDisplayedLength(0);
		const animate = () => {
			setDisplayedLength((prev) => {
				if (prev >= fullText.length) {
					return prev;
				}
				timeoutRef.current = setTimeout(animate, TYPING_SPEED_MS);
				return prev + 1;
			});
		};
		timeoutRef.current = setTimeout(animate, TYPING_SPEED_MS);
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, [animateWelcome, fullText]);

	const showTyping = animateWelcome && displayedLength < fullText.length;
	const displayedTitle =
		showTyping && displayedLength <= titleText.length
			? titleText.slice(0, displayedLength)
			: titleText;
	const displayedSubtitle =
		!showTyping
			? subtitleText
			: displayedLength > titleText.length
				? subtitleText.slice(0, displayedLength - titleText.length - 1)
				: "";

	return (
		<div className="nfd-ai-chat-welcome">
			<div className="nfd-ai-chat-welcome__content">
				<div className="nfd-ai-chat-welcome__avatar">
					<AILogo width={64} height={64} />
				</div>
				<div className="nfd-ai-chat-welcome__message">
					<div className="nfd-ai-chat-welcome__title">{displayedTitle}</div>
					<div className="nfd-ai-chat-welcome__subtitle">
						{displayedSubtitle}
						{showTyping && displayedLength < fullText.length && (
							<span className="nfd-ai-chat-welcome__cursor" aria-hidden="true" />
						)}
					</div>
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
