/**
 * Check / success icon. Inline SVG; no icon-library dependency.
 *
 * @param {Object} props - SVG props (e.g. width, height, className).
 * @return {JSX.Element} Check icon element.
 */
const CheckIcon = (props) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2.4"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
		focusable="false"
		{...props}
	>
		<polyline points="20 6 9 17 4 12" />
	</svg>
);

export default CheckIcon;
