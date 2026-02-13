/**
 * Close (×) icon for actions. Inline SVG for accessibility.
 *
 * @param {Object} props - SVG props (e.g. className, aria-*).
 * @return {JSX.Element} Close icon element.
 */
const CloseIcon = (props) => (
	<svg
		width="16"
		height="16"
		viewBox="0 0 24 24"
		xmlns="http://www.w3.org/2000/svg"
		aria-hidden="true"
		focusable="false"
		{...props}
	>
		<path
			d="M18 6L6 18M6 6l12 12"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default CloseIcon;
