/**
 * Tool/ability display helpers for the TypingIndicator tool execution list.
 * Maps tool and ability names to user-facing title and description.
 *
 * @package
 */

import { __ } from "@wordpress/i18n";

/**
 * Get ability details for display in the typing indicator.
 *
 * @param {string} abilityName The ability name (e.g. from tool arguments).
 * @return {Object} { title, description }
 */
export function getAbilityDetails(abilityName) {
	const abilityMap = {
		"nfd-agents/get-global-styles": {
			title: __("Reading Site Colors", "wp-module-ai-chat"),
			description: __(
				"Fetching current color palette and typography settings",
				"wp-module-ai-chat"
			),
		},
		"nfd-agents/update-global-palette": {
			title: __("Updating Site Colors", "wp-module-ai-chat"),
			description: __("Applying new colors to global styles", "wp-module-ai-chat"),
		},
		"newfold-agents/get-global-styles": {
			title: __("Reading Site Colors", "wp-module-ai-chat"),
			description: __(
				"Fetching current color palette and typography settings",
				"wp-module-ai-chat"
			),
		},
		"newfold-agents/update-global-palette": {
			title: __("Updating Site Colors", "wp-module-ai-chat"),
			description: __("Applying new colors to global styles", "wp-module-ai-chat"),
		},
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

	if (abilityMap[abilityName]) {
		return abilityMap[abilityName];
	}

	if (abilityName === "preparing-changes") {
		return {
			title: __("Preparing changes", "wp-module-ai-chat"),
			description: __("Building block markup", "wp-module-ai-chat"),
		};
	}

	return {
		title:
			abilityName?.replace(/[-_\/]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) ||
			__("Executing", "wp-module-ai-chat"),
		description: __("Running action", "wp-module-ai-chat"),
	};
}

/**
 * Get tool details for display (title, description, optional params string).
 *
 * @param {string} toolName The tool name.
 * @param {Object} args     The tool arguments (e.g. ability_name, parameters).
 * @return {Object} { title, description, params }
 */
export function getToolDetails(toolName, args = {}) {
	if (toolName === "mcp-adapter-execute-ability") {
		const abilityName = args?.ability_name || "unknown";
		const details = getAbilityDetails(abilityName);

		let params = null;
		const paletteAbility =
			abilityName === "nfd-agents/update-global-palette" ||
			abilityName === "newfold-agents/update-global-palette" ||
			abilityName === "blu/update-global-palette";
		if (paletteAbility && args?.parameters?.colors) {
			const colorCount = args.parameters.colors.length;
			params = `${colorCount} color${colorCount !== 1 ? "s" : ""}`;
		}

		return { ...details, params };
	}

	return getAbilityDetails(toolName);
}
