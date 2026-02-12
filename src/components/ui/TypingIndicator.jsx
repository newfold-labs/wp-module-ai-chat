/**
 * WordPress dependencies
 */
import { useState, useEffect } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { TYPING_STATUS } from "../../constants/nfdAgents/typingStatus";

/**
 * Internal dependencies
 */
import { getToolDetails } from "../../utils/nfdAgents/typingIndicatorToolDisplay";

/**
 * External dependencies
 */
import { Loader2, CheckCircle, XCircle, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import classnames from "classnames";

/** Status key → user-facing label for the simple typing state (single place for copy; i18n-ready). */
const STATUS_LABELS = {
	[TYPING_STATUS.PROCESSING]: __("Processing…", "wp-module-ai-chat"),
	[TYPING_STATUS.CONNECTING]: __("Getting your site ready…", "wp-module-ai-chat"),
	[TYPING_STATUS.WS_CONNECTING]: __("Connecting…", "wp-module-ai-chat"),
	[TYPING_STATUS.TOOL_CALL]: __("Looking this up…", "wp-module-ai-chat"),
	[TYPING_STATUS.WORKING]: __("Almost there…", "wp-module-ai-chat"),
	[TYPING_STATUS.RECEIVED]: __("Message received", "wp-module-ai-chat"),
	[TYPING_STATUS.GENERATING]: __("Thinking…", "wp-module-ai-chat"),
	[TYPING_STATUS.SUMMARIZING]: __("Summarizing results", "wp-module-ai-chat"),
	[TYPING_STATUS.COMPLETED]: __("Processing", "wp-module-ai-chat"),
	[TYPING_STATUS.FAILED]: __("Error occurred", "wp-module-ai-chat"),
};

/**
 * Single tool execution item in the list
 *
 * @param {Object}  props            - The component props.
 * @param {Object}  props.tool       - The tool object with name and arguments.
 * @param {boolean} props.isActive   - Whether the tool is active.
 * @param {string}  props.progress   - The progress message.
 * @param {boolean} props.isComplete - Whether the tool is complete.
 * @param {boolean} props.isError    - Whether the tool is in error.
 * @return {JSX.Element} The ToolExecutionItem component.
 */
const ToolExecutionItem = ({ tool, isActive, progress, isComplete, isError }) => {
	const details = getToolDetails(tool.name, tool.arguments);

	const getIcon = () => {
		if (isError) {
			return (
				<XCircle
					className="nfd-ai-chat-tool-execution__icon nfd-ai-chat-tool-execution__icon--error"
					size={12}
				/>
			);
		}
		if (isComplete) {
			return (
				<CheckCircle
					className="nfd-ai-chat-tool-execution__icon nfd-ai-chat-tool-execution__icon--success"
					size={12}
				/>
			);
		}
		if (isActive) {
			return (
				<Loader2
					className="nfd-ai-chat-tool-execution__icon nfd-ai-chat-tool-execution__icon--active"
					size={12}
				/>
			);
		}
		return (
			<Sparkles
				className="nfd-ai-chat-tool-execution__icon nfd-ai-chat-tool-execution__icon--pending"
				size={12}
			/>
		);
	};

	return (
		<div
			className={classnames("nfd-ai-chat-tool-execution__item", {
				"nfd-ai-chat-tool-execution__item--active": isActive,
				"nfd-ai-chat-tool-execution__item--complete": isComplete,
				"nfd-ai-chat-tool-execution__item--error": isError,
			})}
		>
			<div className="nfd-ai-chat-tool-execution__item-header">
				{getIcon()}
				<span className="nfd-ai-chat-tool-execution__item-title">{details.title}</span>
				{details.params && (
					<span className="nfd-ai-chat-tool-execution__item-params">{details.params}</span>
				)}
			</div>
			{isActive && progress && (
				<div className="nfd-ai-chat-tool-execution__item-progress">{progress}</div>
			)}
		</div>
	);
};

/**
 * TypingIndicator Component
 *
 * Displays an animated typing indicator with spinner and real-time progress.
 *
 * @param {Object} props                - The component props.
 * @param {string} props.status         - The current status.
 * @param {Object} props.activeToolCall - The currently executing tool call.
 * @param {string} props.toolProgress   - Real-time progress message.
 * @param {Array}  props.executedTools  - List of already executed tools.
 * @param {Array}  props.pendingTools   - List of pending tools to execute.
 * @return {JSX.Element} The TypingIndicator component.
 */
const TypingIndicator = ({
	status = null,
	activeToolCall = null,
	toolProgress = null,
	executedTools = [],
	pendingTools = [],
}) => {
	const [isExpanded, setIsExpanded] = useState(true);
	const isExecuting = !!activeToolCall;
	// Show "summarizing" state when waiting between tool batch and final response.
	const isBetweenBatches =
		!isExecuting && status === TYPING_STATUS.SUMMARIZING && executedTools.length > 0;

	useEffect(() => {
		if (isExecuting || isBetweenBatches) {
			setIsExpanded(true);
		}
	}, [isExecuting, isBetweenBatches]);

	const getStatusText = () => {
		return STATUS_LABELS[status] ?? __("Thinking…", "wp-module-ai-chat");
	};

	// Show expandable tool list when any tools are active, done, or queued.
	const hasToolActivity = activeToolCall || executedTools.length > 0 || pendingTools.length > 0;
	const totalTools = executedTools.length + (activeToolCall ? 1 : 0) + pendingTools.length;

	const renderHeaderLabel = () => {
		if (isExecuting) {
			return (
				<>
					<span>{__("Executing actions", "wp-module-ai-chat")}</span>
					{activeToolCall.total > 1 && (
						<span className="nfd-ai-chat-tool-execution__header-count">
							({activeToolCall.index}/{activeToolCall.total})
						</span>
					)}
				</>
			);
		}
		if (isBetweenBatches) {
			return (
				<>
					<Loader2
						className="nfd-ai-chat-tool-execution__icon nfd-ai-chat-tool-execution__icon--active"
						size={12}
					/>
					<span>{__("Processing", "wp-module-ai-chat")}</span>
					<span className="nfd-ai-chat-tool-execution__header-count">({executedTools.length})</span>
				</>
			);
		}
		return (
			<>
				<span>{__("Actions completed", "wp-module-ai-chat")}</span>
				<span className="nfd-ai-chat-tool-execution__header-count">({totalTools})</span>
			</>
		);
	};

	if (hasToolActivity) {
		return (
			<div className="nfd-ai-chat-message nfd-ai-chat-message--assistant">
				<div className="nfd-ai-chat-message__content">
					<div
						className={classnames("nfd-ai-chat-tool-execution", {
							"nfd-ai-chat-tool-execution--collapsed": !isExpanded,
						})}
					>
						<button
							type="button"
							className="nfd-ai-chat-tool-execution__header"
							onClick={() => setIsExpanded(!isExpanded)}
							aria-expanded={isExpanded ? "true" : "false"}
						>
							{isExpanded ? (
								<ChevronDown className="nfd-ai-chat-tool-execution__chevron" size={12} />
							) : (
								<ChevronRight className="nfd-ai-chat-tool-execution__chevron" size={12} />
							)}

							{renderHeaderLabel()}
						</button>

						{isExpanded && (
							<div className="nfd-ai-chat-tool-execution__list">
								{executedTools.map((tool, index) => (
									<ToolExecutionItem
										key={tool.id || `executed-${index}`}
										tool={tool}
										isActive={false}
										isComplete={!tool.isError}
										isError={tool.isError}
										progress={null}
									/>
								))}

								{activeToolCall && (
									<ToolExecutionItem
										key={activeToolCall.id || "active"}
										tool={activeToolCall}
										isActive={true}
										isComplete={false}
										isError={false}
										progress={toolProgress}
									/>
								)}

								{isBetweenBatches && (
									<ToolExecutionItem
										key="preparing"
										tool={{ name: "preparing-changes" }}
										isActive={true}
										isComplete={false}
										isError={false}
										progress={null}
									/>
								)}

								{pendingTools.map((tool, index) => (
									<ToolExecutionItem
										key={tool.id || `pending-${index}`}
										tool={tool}
										isActive={false}
										isComplete={false}
										isError={false}
										progress={null}
									/>
								))}
							</div>
						)}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="nfd-ai-chat-message nfd-ai-chat-message--assistant">
			<div className="nfd-ai-chat-message__content">
				<div className="nfd-ai-chat-typing-indicator">
					<span className="nfd-ai-chat-typing-indicator__dots" aria-hidden="true">
						<span></span>
						<span></span>
						<span></span>
					</span>
					<span className="nfd-ai-chat-typing-indicator__text">{getStatusText()}</span>
				</div>
			</div>
		</div>
	);
};

export default TypingIndicator;
