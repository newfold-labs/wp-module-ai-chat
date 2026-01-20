/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { CheckCircle, XCircle } from "lucide-react";

/**
 * ToolExecutionList Component
 *
 * Displays a simple status line indicating actions were completed.
 * Simplified for end-users who don't need technical details.
 *
 * @param {Object} props               - The component props.
 * @param {Array}  props.executedTools - List of executed tools.
 * @return {JSX.Element} The ToolExecutionList component.
 */
const ToolExecutionList = ({ executedTools = [] }) => {
	if (!executedTools || executedTools.length === 0) {
		return null;
	}

	// Check if any tools had errors
	const hasErrors = executedTools.some((tool) => tool.isError);

	return (
		<div className="nfd-ai-chat-tool-status-line">
			{hasErrors ? (
				<>
					<XCircle
						className="nfd-ai-chat-tool-status-line__icon nfd-ai-chat-tool-status-line__icon--error"
						size={14}
					/>
					<span className="nfd-ai-chat-tool-status-line__text">
						{__("Some actions failed", "wp-module-ai-chat")}
					</span>
				</>
			) : (
				<>
					<CheckCircle className="nfd-ai-chat-tool-status-line__icon" size={14} />
					<span className="nfd-ai-chat-tool-status-line__text">
						{__("Changes applied", "wp-module-ai-chat")}
					</span>
				</>
			)}
		</div>
	);
};

export default ToolExecutionList;
