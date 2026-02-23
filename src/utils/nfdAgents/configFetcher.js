/**
 * NFD Agents Config Fetcher
 *
 * Fetches agent configuration from the REST API endpoint.
 * Always uses rest_route parameter for REST API calls (never wp-json directly)
 * so that requests work when permalinks are not set.
 * Handles URL parsing (full URL vs relative REST path), apiFetch calls,
 * and maps all known error codes to i18n error messages.
 */

import { __, sprintf } from "@wordpress/i18n";
import apiFetch from "@wordpress/api-fetch";
import { buildRestApiUrl, convertWpJsonToRestRoute } from "../restApi.js";

/**
 * Get base URL for the current site (origin or home URL including subdirectory).
 *
 * @return {string} Base URL
 */
function getBaseUrl() {
	if (typeof window === "undefined") {
		return "";
	}
	const config = window.nfdAIChat || {};
	return config.homeUrl || window.location.origin;
}

/**
 * Fetch agent configuration from the backend.
 * Uses rest_route query parameter for the request so it works regardless of permalink settings.
 *
 * @param {Object} options
 * @param {string} options.configEndpoint REST API endpoint (full URL or relative path). Example full URL: 'https://example.com/wp-json/nfd-agents/chat/v1/config'. Example relative path: 'nfd-agents/chat/v1/config'.
 * @param {string} options.consumer       Consumer identifier (required). Sent as query param `consumer`. Valid values are defined by the backend.
 * @return {Promise<Object>} Config object from backend
 * @throws {Error} With i18n message on failure
 */
export async function fetchAgentConfig({ configEndpoint, consumer }) {
	try {
		// Extract REST path from configEndpoint (e.g. 'nfd-agents/chat/v1/config')
		let path = configEndpoint;
		let baseUrl = getBaseUrl();
		let useWpJsonConversion = false;
		let wpJsonBaseUrl = "";

		if (configEndpoint.startsWith("http://") || configEndpoint.startsWith("https://")) {
			const urlObj = new URL(configEndpoint);
			if (urlObj.searchParams.has("rest_route")) {
				path = urlObj.searchParams.get("rest_route");
			} else if (urlObj.pathname.includes("/wp-json/")) {
				path = urlObj.pathname.replace(/^\/wp-json\//, "").replace(/^\/wp-json/, "");
				useWpJsonConversion = true;
				const beforeWpJson = urlObj.pathname.split("/wp-json")[0].replace(/\/$/, "");
				wpJsonBaseUrl = urlObj.origin + (beforeWpJson || "/");
			} else {
				path = urlObj.pathname.replace(/^\//, "");
			}
			// Base URL for rest_route: origin + pathname (without query), or path before /wp-json
			if (!useWpJsonConversion) {
				if (urlObj.pathname.includes("/wp-json")) {
					const beforeWpJson = urlObj.pathname.split("/wp-json")[0].replace(/\/$/, "");
					baseUrl = urlObj.origin + (beforeWpJson || "/");
				} else {
					baseUrl = urlObj.origin + (urlObj.pathname || "/");
				}
			}
		}

		const cleanPath = path.replace(/^\//, "");

		let url;
		if (useWpJsonConversion) {
			url = convertWpJsonToRestRoute(configEndpoint, wpJsonBaseUrl);
		} else {
			const lastSlash = cleanPath.lastIndexOf("/");
			const namespace = lastSlash === -1 ? "" : cleanPath.slice(0, lastSlash);
			const route = lastSlash === -1 ? cleanPath : cleanPath.slice(lastSlash + 1);
			url = buildRestApiUrl(namespace, route, baseUrl);
		}
		url = `${url}&consumer=${encodeURIComponent(consumer)}`;

		const config = await apiFetch({
			url,
			parse: true,
		});

		return config;
	} catch (err) {
		// eslint-disable-next-line no-console
		console.error("[AI Chat] Failed to fetch config:", err);
		// eslint-disable-next-line no-console
		console.error("[AI Chat] Error details:", {
			message: err.message,
			code: err.code,
			data: err.data,
			status: err.data?.status,
			statusText: err.data?.statusText,
		});

		// Handle apiFetch errors
		let errorMessage = err.message || __("Failed to connect", "wp-module-ai-chat");

		if (err.data?.message) {
			errorMessage = err.data.message;
		} else if (err.message && err.message !== "Could not get a valid response from the server.") {
			errorMessage = err.message;
		}

		if (err.code === "rest_forbidden" || err.data?.status === 403) {
			errorMessage = __("Access denied. Please check your capabilities.", "wp-module-ai-chat");
		} else if (err.code === "rest_no_route" || err.data?.status === 404) {
			errorMessage = __(
				"Config endpoint not found. Please ensure the backend is deployed.",
				"wp-module-ai-chat"
			);
		} else if (err.code === "gateway_url_not_configured") {
			errorMessage = __(
				"Gateway URL not configured. Set NFD_AGENTS_CHAT_GATEWAY_URL in wp-config.php.",
				"wp-module-ai-chat"
			);
		} else if (err.code === "jarvis_jwt_fetch_failed" || err.code === "huapi_token_fetch_failed") {
			errorMessage = __(
				"Failed to fetch authentication token from Hiive. Check your connection or set NFD_AGENTS_CHAT_DEBUG_TOKEN for local development.",
				"wp-module-ai-chat"
			);
		} else if (err.data?.status) {
			errorMessage = sprintf(
				/* translators: %1$s: HTTP status, %2$s: status text */
				__("Failed to fetch config: %1$s %2$s", "wp-module-ai-chat"),
				err.data.status,
				err.data.statusText || errorMessage
			);
		}

		throw new Error(errorMessage);
	}
}
