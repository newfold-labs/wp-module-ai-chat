/**
 * WordPress dependencies
 */
import { useState, useEffect } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { Loader2, CheckCircle, XCircle, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import classnames from "classnames";

/**
 * Get ability details for display
 *
 * @param {string} abilityName The ability name
 * @return {Object} { title, description }
 */
const getAbilityDetails = (abilityName) => {
	const abilityMap = {
		"blu/get-global-styles": {
			title: __("Reading Site Colors", "wp-module-ai-chat"),
			description: __(
				"Fetching current color palette and typography settings",
				"wp-module-ai-chat"
			),
		},
		"blu/update-global-palette": {
			title: __("Updating Site Colors", "wp-module-ai-chat"),
			description: __("Applying new colors to global styles", "wp-module-ai-chat"),
		},
		"mcp-adapter-discover-abilities": {
			title: __("Discovering Actions", "wp-module-ai-chat"),
			description: __("Finding available WordPress abilities", "wp-module-ai-chat"),
		},
		"mcp-adapter-get-ability-info": {
			title: __("Getting Ability Info", "wp-module-ai-chat"),
			description: __("Fetching ability details", "wp-module-ai-chat"),
		},
		"mcp-adapter-execute-ability": {
			title: __("Executing Action", "wp-module-ai-chat"),
			description: __("Running WordPress ability", "wp-module-ai-chat"),
		},
	};

	return (
		abilityMap[abilityName] || {
			title:
				abilityName?.replace(/[-_\/]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) ||
				__("Executing", "wp-module-ai-chat"),
			description: __("Running action", "wp-module-ai-chat"),
		}
	);
};

/**
 * Get tool details for display
 *
 * @param {string} toolName The tool name
 * @param {Object} args     The tool arguments
 * @return {Object} { title, description, params }
 */
const getToolDetails = (toolName, args = {}) => {
	if (toolName === "mcp-adapter-execute-ability") {
		const abilityName = args?.ability_name || "unknown";
		const details = getAbilityDetails(abilityName);

		let params = null;
		if (abilityName === "blu/update-global-palette" && args?.parameters?.colors) {
			const colorCount = args.parameters.colors.length;
			params = `${colorCount} color${colorCount !== 1 ? "s" : ""}`;
		}

		return { ...details, params };
	}

	return getAbilityDetails(toolName);
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
	reasoningContent = "",
}) => {
	const [isExpanded, setIsExpanded] = useState(true);
	const isExecuting = !!activeToolCall;
	const isBetweenBatches = !isExecuting && status === "summarizing" && executedTools.length > 0;

	useEffect(() => {
		if (isExecuting || isBetweenBatches) {
			setIsExpanded(true);
		}
	}, [isExecuting, isBetweenBatches]);

	const getStatusText = () => {
		switch (status) {
			case "received":
				return __("Message received", "wp-module-ai-chat");
			case "generating":
				return __("Thinking", "wp-module-ai-chat");
			case "tool_call":
				return __("Executing actions", "wp-module-ai-chat");
			case "summarizing":
				return __("Processing", "wp-module-ai-chat");
			case "completed":
				return __("Processing", "wp-module-ai-chat");
			case "failed":
				return __("Error occurred", "wp-module-ai-chat");
			default:
				return __("Thinking", "wp-module-ai-chat");
		}
	};

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
					<Loader2 className="nfd-ai-chat-typing-indicator__spinner" size={16} />
					<span className="nfd-ai-chat-typing-indicator__text">{getStatusText()}</span>
				</div>
				{reasoningContent && (
					<div className="nfd-ai-chat-typing-indicator__reasoning">{reasoningContent}</div>
				)}
			</div>
		</div>
	);
};

export default TypingIndicator;
