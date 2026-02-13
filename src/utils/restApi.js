/**
 * REST API Utilities
 *
 * Utilities for constructing WordPress REST API URLs that work
 * regardless of permalink settings.
 */

/**
 * Get the REST API base URL using rest_route parameter
 * This works even when permalinks are not configured properly
 *
 * @param {string} [baseUrl] Base URL (defaults to current site URL)
 * @return {string} REST API base URL
 */
export const getRestApiBaseUrl = (baseUrl = "") => {
	// If baseUrl is provided and already contains rest_route, return as-is
	if (baseUrl && baseUrl.includes("rest_route=")) {
		return baseUrl;
	}

	// Get site URL from window if not provided
	if (!baseUrl && typeof window !== "undefined") {
		baseUrl = window.location.origin;
	}

	// Use rest_route parameter instead of /wp-json/ path
	// This works regardless of permalink settings
	const separator = baseUrl.includes("?") ? "&" : "?";
	return `${baseUrl}${separator}rest_route=/`;
};

/**
 * Build a REST API endpoint URL
 *
 * @param {string} namespace REST API namespace (e.g., 'nfd-agents/chat/v1')
 * @param {string} route     REST API route (e.g., 'config')
 * @param {string} [baseUrl] Base URL (defaults to current site URL)
 * @return {string} Full REST API endpoint URL
 */
export const buildRestApiUrl = (namespace, route, baseUrl = "") => {
	const restBase = getRestApiBaseUrl(baseUrl);
	const endpoint = `${namespace}/${route}`;

	// If restBase already has rest_route, append to it
	if (restBase.includes("rest_route=")) {
		return restBase.replace("rest_route=/", `rest_route=/${endpoint}`);
	}

	// Otherwise, construct new rest_route parameter
	const separator = restBase.includes("?") ? "&" : "?";
	return `${restBase}${separator}rest_route=/${endpoint}`;
};

/**
 * Convert a wp-json style URL to rest_route format
 *
 * @param {string} wpJsonUrl URL in format /wp-json/namespace/route
 * @param {string} [baseUrl] Base URL (defaults to current site URL)
 * @return {string} URL with rest_route parameter
 */
export const convertWpJsonToRestRoute = (wpJsonUrl, baseUrl = "") => {
	// If already using rest_route, return as-is
	if (wpJsonUrl.includes("rest_route=")) {
		return wpJsonUrl;
	}

	// Extract the path after /wp-json/
	const wpJsonMatch = wpJsonUrl.match(/\/wp-json\/(.+)$/);
	if (!wpJsonMatch) {
		// Not a wp-json URL, return as-is
		return wpJsonUrl;
	}

	const endpoint = wpJsonMatch[1];

	// Get base URL
	if (!baseUrl && typeof window !== "undefined") {
		baseUrl = window.location.origin;
	}

	// Remove /wp-json/ from baseUrl if present
	const cleanBaseUrl = baseUrl.replace(/\/wp-json\/?$/, "");

	// Build rest_route URL
	const separator = cleanBaseUrl.includes("?") ? "&" : "?";
	return `${cleanBaseUrl}${separator}rest_route=/${endpoint}`;
};
