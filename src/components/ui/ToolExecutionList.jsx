/**
 * WordPress dependencies
 */
import { useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { CheckCircle, ChevronDown, ChevronRight, XCircle } from "lucide-react";
import classnames from "classnames";

/**
 * Get ability details for display
 *
 * @param {string} abilityName The ability name
 * @return {Object} { title }
 */
const getAbilityDetails = (abilityName) => {
	const abilityMap = {
		"blu/get-global-styles": {
			title: __("Reading Site Colors", "wp-module-ai-chat"),
		},
		"blu-get-global-styles": {
			title: __("Reading Site Colors", "wp-module-ai-chat"),
		},
		"blu/get-active-global-styles": {
			title: __("Reading Active Styles", "wp-module-ai-chat"),
		},
		"blu-get-active-global-styles": {
			title: __("Reading Active Styles", "wp-module-ai-chat"),
		},
		"blu/get-active-global-styles-id": {
			title: __("Getting Styles ID", "wp-module-ai-chat"),
		},
		"blu-get-active-global-styles-id": {
			title: __("Getting Styles ID", "wp-module-ai-chat"),
		},
		"blu/update-global-styles": {
			title: __("Updating Site Styles", "wp-module-ai-chat"),
		},
		"blu-update-global-styles": {
			title: __("Updating Site Styles", "wp-module-ai-chat"),
		},
		"blu/update-global-palette": {
			title: __("Updating Site Colors", "wp-module-ai-chat"),
		},
		"blu-update-global-palette": {
			title: __("Updating Site Colors", "wp-module-ai-chat"),
		},
	};

	return (
		abilityMap[abilityName] || {
			title:
				abilityName?.replace(/[-_\/]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) ||
				__("Action", "wp-module-ai-chat"),
		}
	);
};

/**
 * Get tool details for display
 *
 * @param {string} toolName The tool name
 * @param {Object} args     The tool arguments
 * @return {Object} { title, params }
 */
const getToolDetails = (toolName, args = {}) => {
	if (toolName === "mcp-adapter-execute-ability") {
		const abilityName = args?.ability_name || "unknown";
		const details = getAbilityDetails(abilityName);

		let params = null;
		if (
			(abilityName === "blu/update-global-palette" || abilityName === "blu/update-global-styles") &&
			args?.parameters?.colors
		) {
			const colorCount = args.parameters.colors.length;
			params = `${colorCount} color${colorCount !== 1 ? "s" : ""}`;
		}

		return { ...details, params };
	}

	return getAbilityDetails(toolName);
};

/**
 * Parse tool result to get a human-readable summary
 *
 * @param {Object} result   The tool result object
 * @param {string} toolName The tool name
 * @return {string|null} Summary string or null
 */
const getResultSummary = (result, toolName) => {
	if (!result || result.isError) {
		return result?.error || null;
	}

	try {
		// Result is typically an array with { type: "text", text: "..." }
		let data = result.result;
		if (Array.isArray(data) && data.length > 0 && data[0].text) {
			data = JSON.parse(data[0].text);
		} else if (typeof data === "string") {
			data = JSON.parse(data);
		}

		// Handle update results
		if (toolName?.includes("update")) {
			if (data.updatedColors && Array.isArray(data.updatedColors)) {
				const colors = data.updatedColors;
				if (colors.length <= 3) {
					return colors.map((c) => `${c.name || c.slug}: ${c.color}`).join(", ");
				}
				return `${colors.length} colors updated`;
			}
			if (data.message) {
				return data.message;
			}
		}

		// Handle get/read results
		if (toolName?.includes("get") || toolName?.includes("read")) {
			// Check for palette data
			if (data.color?.palette) {
				const palette = data.color.palette;
				const customCount = palette.custom?.length || 0;
				const themeCount = palette.theme?.length || 0;
				if (customCount || themeCount) {
					return `Found ${customCount + themeCount} colors`;
				}
			}
			// Check for typography
			if (data.typography) {
				const fontFamilies = data.typography.fontFamilies?.length || 0;
				const fontSizes = data.typography.fontSizes?.length || 0;
				const parts = [];
				if (fontFamilies) {
					parts.push(`${fontFamilies} font families`);
				}
				if (fontSizes) {
					parts.push(`${fontSizes} sizes`);
				}
				if (parts.length) {
					return parts.join(", ");
				}
			}
			// Generic message
			if (data.message) {
				return data.message;
			}
		}

		// Fallback for styles ID
		if (data.id && toolName?.includes("id")) {
			return `ID: ${data.id}`;
		}

		return null;
	} catch {
		return null;
	}
};

/**
 * Single tool execution item
 *
 * @param {Object}      props         - The component props.
 * @param {Object}      props.tool    - The tool object.
 * @param {boolean}     props.isError - Whether the tool had an error.
 * @param {Object|null} props.result  - The tool result.
 * @return {JSX.Element} The item component.
 */
const ToolExecutionItem = ({ tool, isError, result }) => {
	const details = getToolDetails(tool.name, tool.arguments);
	const summary = getResultSummary(result, tool.name);

	return (
		<div
			className={classnames("nfd-ai-chat-tool-execution__item", {
				"nfd-ai-chat-tool-execution__item--complete": !isError,
				"nfd-ai-chat-tool-execution__item--error": isError,
			})}
		>
			<div className="nfd-ai-chat-tool-execution__item-header">
				{isError ? (
					<XCircle
						className="nfd-ai-chat-tool-execution__icon nfd-ai-chat-tool-execution__icon--error"
						size={12}
					/>
				) : (
					<CheckCircle
						className="nfd-ai-chat-tool-execution__icon nfd-ai-chat-tool-execution__icon--success"
						size={12}
					/>
				)}
				<span className="nfd-ai-chat-tool-execution__item-title">{details.title}</span>
				{details.params && (
					<span className="nfd-ai-chat-tool-execution__item-params">{details.params}</span>
				)}
			</div>
			{summary && <div className="nfd-ai-chat-tool-execution__item-summary">{summary}</div>}
		</div>
	);
};

/**
 * ToolExecutionList Component
 *
 * Displays a collapsible list of executed tools using the same styling
 * as the typing indicator's tool execution view.
 *
 * @param {Object} props               - The component props.
 * @param {Array}  props.executedTools - List of executed tools.
 * @param {Array}  props.toolResults   - Results from tool executions.
 * @return {JSX.Element} The ToolExecutionList component.
 */
const ToolExecutionList = ({ executedTools = [], toolResults = [] }) => {
	const [isExpanded, setIsExpanded] = useState(false);

	if (!executedTools || executedTools.length === 0) {
		return null;
	}

	// Create a map of results by tool ID for quick lookup
	const resultsMap = new Map();
	if (toolResults && Array.isArray(toolResults)) {
		toolResults.forEach((result) => {
			if (result.id) {
				resultsMap.set(result.id, result);
			}
		});
	}

	const hasErrors = executedTools.some((tool) => tool.isError);
	const totalTools = executedTools.length;

	return (
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
				<span>
					{hasErrors
						? __("Some actions failed", "wp-module-ai-chat")
						: __("Actions completed", "wp-module-ai-chat")}
				</span>
				<span className="nfd-ai-chat-tool-execution__header-count">({totalTools})</span>
			</button>

			{isExpanded && (
				<div className="nfd-ai-chat-tool-execution__list">
					{executedTools.map((tool, index) => (
						<ToolExecutionItem
							key={tool.id || `tool-${index}`}
							tool={tool}
							isError={tool.isError}
							result={resultsMap.get(tool.id)}
						/>
					))}
				</div>
			)}
		</div>
	);
};

export default ToolExecutionList;
