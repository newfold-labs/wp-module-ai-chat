/**
 * NFD Agents URL Utilities
 *
 * Utilities for URL normalization and protocol conversion for WebSocket connections.
 * Used for converting HTTP/HTTPS URLs to WebSocket protocols and normalizing site URLs.
 */

/**
 * Convert HTTP/HTTPS URL to WebSocket protocol
 *
 * @param {string} url HTTP or HTTPS URL
 * @return {string} WebSocket URL (ws:// or wss://)
 */
export const convertToWebSocketUrl = (url) => {
	if (!url || typeof url !== "string") {
		return url;
	}

	if (url.startsWith("http://")) {
		return url.replace("http://", "ws://");
	}

	if (url.startsWith("https://")) {
		return url.replace("https://", "wss://");
	}

	// If no protocol specified, determine based on localhost
	if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
		return isLocalhost(url) ? `ws://${url}` : `wss://${url}`;
	}

	return url;
};

/**
 * Check if URL is localhost
 *
 * @param {string} url URL to check
 * @return {boolean} True if URL is localhost
 */
export const isLocalhost = (url) => {
	if (!url || typeof url !== "string") {
		return false;
	}

	const normalized = url.toLowerCase();
	return normalized.includes("localhost") || normalized.includes("127.0.0.1");
};

/**
 * Normalize site URL to ensure it has a protocol
 * Adds http:// for localhost, https:// for other URLs
 *
 * @param {string} siteUrl Site URL to normalize
 * @return {string} Normalized URL with protocol
 */
/**
 * Build the full WebSocket URL from config, session ID, and consumer type.
 * Normalizes the 'nfd-agents' agent type alias to 'blu'.
 *
 * @param {Object} config             Config object from fetchAgentConfig
 * @param {string} config.gateway_url Gateway HTTP(S) URL
 * @param {string} config.brand_id    Brand identifier
 * @param {string} config.agent_type  Agent type (may be 'nfd-agents' alias)
 * @param {string} config.huapi_token Auth token
 * @param {string} sessionId          Session ID for the connection
 * @param {string} consumerType       Consumer type; passed to gateway as wordpress_${consumerType}
 * @return {string} Full WebSocket URL with query parameters
 */
export const buildWebSocketUrl = (config, sessionId, consumerType) => {
	const wsBaseUrl = convertToWebSocketUrl(config.gateway_url);
	const agentType = (config.agent_type === "nfd-agents" ? "blu" : config.agent_type) || "blu";
	const consumer = `wordpress_${consumerType}`;

	return `${wsBaseUrl}/${config.brand_id}/agents/${agentType}/v1/ws?session_id=${sessionId}&token=${encodeURIComponent(config.huapi_token)}&consumer=${encodeURIComponent(consumer)}`;
};

export const normalizeUrl = (siteUrl) => {
	if (!siteUrl || typeof siteUrl !== "string") {
		return siteUrl;
	}

	// If already has protocol, return as-is
	if (siteUrl.match(/^https?:\/\//)) {
		return siteUrl;
	}

	// Check if it's localhost and default to http://
	if (isLocalhost(siteUrl)) {
		return `http://${siteUrl}`;
	}

	// For other URLs, default to https://
	return `https://${siteUrl}`;
};
