/**
 * NFD Agents Config Fetcher
 *
 * Fetches agent configuration from the REST API endpoint.
 * Handles URL parsing (full URL vs relative REST path), apiFetch calls,
 * and maps all known error codes to i18n error messages.
 */

import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

/**
 * Fetch agent configuration from the backend.
 *
 * @param {Object} options
 * @param {string} options.configEndpoint  REST API endpoint (full URL or relative path)
 * @param {string} options.storageNamespace  Client storage namespace (sent as query param)
 * @return {Promise<Object>} Config object from backend
 * @throws {Error} With i18n message on failure
 */
export async function fetchAgentConfig({ configEndpoint, storageNamespace }) {
	try {
		// Extract namespace and route from configEndpoint if it's a full URL
		// Otherwise, assume it's already in the format 'nfd-agents/chat/v1/config'
		let path = configEndpoint;

		// If configEndpoint is a full URL, extract the REST API path
		if (configEndpoint.startsWith('http://') || configEndpoint.startsWith('https://')) {
			const urlObj = new URL(configEndpoint);
			if (urlObj.searchParams.has('rest_route')) {
				path = urlObj.searchParams.get('rest_route');
			} else if (urlObj.pathname.includes('/wp-json/')) {
				path = urlObj.pathname.replace('/wp-json/', '');
			} else {
				path = urlObj.pathname.replace(/^\//, '');
			}
		}

		// Use apiFetch which handles permalinks and nonce automatically
		const cleanPath = path.startsWith('/') ? path.slice(1) : path;

		// For GET requests, append query parameters to the path
		const pathWithParams = `${cleanPath}?storage_namespace=${encodeURIComponent(storageNamespace)}`;

		const config = await apiFetch({
			path: pathWithParams,
			parse: true,
		});

		return config;
	} catch (err) {
		// eslint-disable-next-line no-console
		console.error('[AI Chat] Failed to fetch config:', err);
		// eslint-disable-next-line no-console
		console.error('[AI Chat] Error details:', {
			message: err.message,
			code: err.code,
			data: err.data,
			status: err.data?.status,
			statusText: err.data?.statusText,
		});

		// Handle apiFetch errors
		let errorMessage = err.message || __('Failed to connect', 'wp-module-ai-chat');

		if (err.data?.message) {
			errorMessage = err.data.message;
		} else if (err.message && err.message !== 'Could not get a valid response from the server.') {
			errorMessage = err.message;
		}

		if (err.code === 'rest_forbidden' || err.data?.status === 403) {
			errorMessage = __('Access denied. Please check your capabilities.', 'wp-module-ai-chat');
		} else if (err.code === 'rest_no_route' || err.data?.status === 404) {
			errorMessage = __('Config endpoint not found. Please ensure the backend is deployed.', 'wp-module-ai-chat');
		} else if (err.code === 'gateway_url_not_configured') {
			errorMessage = __('Gateway URL not configured. Set NFD_AGENTS_CHAT_GATEWAY_URL in wp-config.php.', 'wp-module-ai-chat');
		} else if (err.code === 'huapi_token_fetch_failed') {
			errorMessage = __('Failed to fetch authentication token from Hiive. Check your connection or set NFD_AGENTS_CHAT_DEBUG_TOKEN for local development.', 'wp-module-ai-chat');
		} else if (err.data?.status) {
			errorMessage = sprintf(
				/* translators: %1$s: HTTP status, %2$s: status text */
				__('Failed to fetch config: %1$s %2$s', 'wp-module-ai-chat'),
				err.data.status,
				err.data.statusText || errorMessage
			);
		}

		throw new Error(errorMessage);
	}
}
