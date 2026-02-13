/**
 * Filled sparks icon (matches editor-chat sparks.svg).
 * Inlined to avoid SVG loader dependency across consuming projects.
 *
 * @param {Object} props             - Props to spread onto the SVG element.
 * @param {number} [props.width=24]  - SVG width in pixels.
 * @param {number} [props.height=24] - SVG height in pixels.
 * @return {JSX.Element} Inline SVG sparks icon.
 */
const SparksIcon = ({ width = 24, height = 24, ...props }) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 30 30"
		width={width}
		height={height}
		{...props}
	>
		<path d="M14.217,19.707l-1.112,2.547c-0.427,0.979-1.782,0.979-2.21,0l-1.112-2.547c-0.99-2.267-2.771-4.071-4.993-5.057L1.73,13.292c-0.973-0.432-0.973-1.848,0-2.28l2.965-1.316C6.974,8.684,8.787,6.813,9.76,4.47l1.126-2.714c0.418-1.007,1.81-1.007,2.228,0L14.24,4.47c0.973,2.344,2.786,4.215,5.065,5.226l2.965,1.316c0.973,0.432,0.973,1.848,0,2.28l-3.061,1.359C16.988,15.637,15.206,17.441,14.217,19.707z" />
		<path d="M24.481,27.796l-0.339,0.777c-0.248,0.569-1.036,0.569-1.284,0l-0.339-0.777c-0.604-1.385-1.693-2.488-3.051-3.092l-1.044-0.464c-0.565-0.251-0.565-1.072,0-1.323l0.986-0.438c1.393-0.619,2.501-1.763,3.095-3.195l0.348-0.84c0.243-0.585,1.052-0.585,1.294,0l0.348,0.84c0.594,1.432,1.702,2.576,3.095,3.195l0.986,0.438c0.565,0.251,0.565,1.072,0,1.323l-1.044,0.464C26.174,25.308,25.085,26.411,24.481,27.796z" />
	</svg>
);

/**
 * AILogo Component
 *
 * Displays the filled sparks icon inside a gradient circle.
 * Used on welcome screens and as the main AI assistant avatar.
 *
 * @param {Object} props        - The component props.
 * @param {number} props.width  - The width of the logo (default: 24).
 * @param {number} props.height - The height of the logo (default: 24).
 * @return {JSX.Element} Avatar wrapper with gradient circle and sparks icon.
 */
const AILogo = ({ width = 24, height = 24 }) => (
	<div
		className="nfd-ai-chat-avatar"
		style={{
			width,
			height,
		}}
	>
		{/* Scale icon to ~62.5% of avatar so it fits inside the gradient circle. */}
		<SparksIcon width={width * 0.625} height={height * 0.625} />
	</div>
);

export default AILogo;
