/**
 * Outline sparkles icon (decorative). Inline SVG for accessibility.
 *
 * Pass `gradientFrom`/`gradientTo` (and optionally `gradientId`) to render a
 * linear-gradient stroke instead of `currentColor`. Useful for the welcome screen.
 *
 * @param {Object} props                  - SVG props (e.g. width, height, className).
 * @param {string} [props.gradientFrom]   - Gradient start color (enables gradient stroke).
 * @param {string} [props.gradientTo]     - Gradient end color (enables gradient stroke).
 * @param {string} [props.gradientId]     - Optional explicit id for the gradient (defaults to a stable string).
 * @return {JSX.Element} Sparkles icon element.
 */
const SparklesOutlineIcon = ({
	gradientFrom,
	gradientTo,
	gradientId = "nfd-ai-chat-sparkles-grad",
	...props
}) => {
	const useGradient = Boolean(gradientFrom && gradientTo);
	const stroke = useGradient ? `url(#${gradientId})` : "currentColor";
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke={stroke}
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
			{...props}
		>
			{useGradient && (
				<defs>
					<linearGradient
						id={gradientId}
						x1="0"
						y1="0"
						x2="24"
						y2="24"
						gradientUnits="userSpaceOnUse"
					>
						<stop offset="0%" stopColor={gradientFrom} />
						<stop offset="100%" stopColor={gradientTo} />
					</linearGradient>
				</defs>
			)}
			<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
			<path d="M5 3v4" />
			<path d="M19 17v4" />
			<path d="M3 5h4" />
			<path d="M17 19h4" />
		</svg>
	);
};

export default SparklesOutlineIcon;
