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
import AssistantMessageShell from "./AssistantMessageShell";

/**
 * External dependencies
 */
import { Loader2, CheckCircle, XCircle, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import classnames from "classnames";

/**
 * Merge executed, active, and pending tools into unified progress groups.
 * Consecutive same-name tools are batched: "Generating Images (3/6)".
 */
const buildProgressGroups = (executed, active, pending) => {
	const groups = [];
	const map = new Map();

	const add = (tool, status) => {
		if (!map.has(tool.name)) {
			const g = { ...tool, completed: 0, total: 0, activeCount: 0, pendingCount: 0, hasError: false, count: 0 };
			map.set(tool.name, g);
			groups.push(g);
		}
		const g = map.get(tool.name);
		g.total++;
		g.count++;
		if (status === "completed") {
			g.completed++;
			if (tool.isError) g.hasError = true;
		} else if (status === "active") {
			g.activeCount++;
		} else {
			g.pendingCount++;
		}
	};

	executed.forEach((t) => add(t, "completed"));
	if (active) add(active, "active");
	pending.forEach((t) => add(t, "pending"));

	return groups;
};

/** Status key → user-facing label for the simple typing state (single place for copy; i18n-ready). */
const STATUS_LABELS = {
	[TYPING_STATUS.PROCESSING]: __("One moment…", "wp-module-ai-chat"),
	[TYPING_STATUS.CONNECTING]: __("Getting your site ready…", "wp-module-ai-chat"),
	[TYPING_STATUS.WS_CONNECTING]: __("Connecting…", "wp-module-ai-chat"),
	[TYPING_STATUS.TOOL_CALL]: __("Looking this up…", "wp-module-ai-chat"),
	[TYPING_STATUS.WORKING]: __("Almost there…", "wp-module-ai-chat"),
	[TYPING_STATUS.RECEIVED]: __("Message received", "wp-module-ai-chat"),
	[TYPING_STATUS.GENERATING]: __("One moment…", "wp-module-ai-chat"),
	[TYPING_STATUS.SUMMARIZING]: __("Summarizing results", "wp-module-ai-chat"),
	[TYPING_STATUS.COMPLETED]: __("Wrapping up…", "wp-module-ai-chat"),
	[TYPING_STATUS.FAILED]: __("Error occurred", "wp-module-ai-chat"),
};

/**
 * Phased copy for the generic "still working" state — shown only when status is PROCESSING
 * (the common fallback emitted on typing_start) so users get a sense of progression instead of
 * a frozen "Processing…" the entire time.
 */
const PROCESSING_PHASES = [
	{ at: 0, label: __("One moment…", "wp-module-ai-chat") },
	{ at: 3500, label: __("Working on it…", "wp-module-ai-chat") },
	{ at: 9000, label: __("Almost there…", "wp-module-ai-chat") },
	{ at: 18000, label: __("Just a moment longer…", "wp-module-ai-chat") },
];

/**
 * Returns the current phased label, advancing through PROCESSING_PHASES while `active` is true.
 * Resets when active flips to false or when the status key changes (passed as `resetKey`).
 *
 * @param {boolean} active   - When true, advance through phases on a timer.
 * @param {string}  resetKey - When this changes, restart the phase timeline.
 * @return {string} The currently-displayed phase label.
 */
const usePhasedProcessingLabel = (active, resetKey) => {
	const [phaseIndex, setPhaseIndex] = useState(0);
	useEffect(() => {
		setPhaseIndex(0);
		if (!active) {
			return undefined;
		}
		const timers = PROCESSING_PHASES.slice(1).map((phase, i) =>
			setTimeout(() => setPhaseIndex(i + 1), phase.at)
		);
		return () => timers.forEach(clearTimeout);
	}, [active, resetKey]);
	return PROCESSING_PHASES[phaseIndex].label;
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
				<span className="nfd-ai-chat-tool-execution__item-title">
					{details.title}
					{tool.total > 1 && (tool.completed < tool.total
						? ` (${tool.completed}/${tool.total})`
						: ` (${tool.total})`
					)}
				</span>
				{!(tool.count > 1) && details.params && (
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

	// Use phased copy when status is the generic PROCESSING fallback (or unset).
	const isGenericProcessing = !status || status === TYPING_STATUS.PROCESSING;
	const phasedLabel = usePhasedProcessingLabel(isGenericProcessing, status ?? "");

	const getStatusText = () => {
		if (isGenericProcessing) {
			return phasedLabel;
		}
		return STATUS_LABELS[status] ?? __("One moment…", "wp-module-ai-chat");
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
			<AssistantMessageShell>
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
								{buildProgressGroups(executedTools, activeToolCall, pendingTools).map((group, index) => (
									<ToolExecutionItem
										key={group.id || `group-${index}`}
										tool={group}
										isActive={group.activeCount > 0}
										isComplete={group.completed === group.total && group.total > 0}
										isError={group.hasError}
										progress={group.activeCount > 0 ? toolProgress : null}
									/>
								))}

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
							</div>
						)}
					</div>
			</AssistantMessageShell>
		);
	}

	return (
		<AssistantMessageShell>
			<div className="nfd-ai-chat-typing-indicator">
				<span className="nfd-ai-chat-typing-indicator__text">{getStatusText()}</span>
			</div>
		</AssistantMessageShell>
	);
};

export default TypingIndicator;
