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
 * @returns {string} WebSocket URL (ws:// or wss://)
 */
export const convertToWebSocketUrl = (url) => {
	if (!url || typeof url !== 'string') {
		return url;
	}

	if (url.startsWith('http://')) {
		return url.replace('http://', 'ws://');
	}
	
	if (url.startsWith('https://')) {
		return url.replace('https://', 'wss://');
	}
	
	// If no protocol specified, determine based on localhost
	if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
		return isLocalhost(url) ? `ws://${url}` : `wss://${url}`;
	}
	
	return url;
};

/**
 * Check if URL is localhost
 * 
 * @param {string} url URL to check
 * @returns {boolean} True if URL is localhost
 */
export const isLocalhost = (url) => {
	if (!url || typeof url !== 'string') {
		return false;
	}
	
	const normalized = url.toLowerCase();
	return normalized.includes('localhost') || normalized.includes('127.0.0.1');
};

/**
 * Normalize site URL to ensure it has a protocol
 * Adds http:// for localhost, https:// for other URLs
 * 
 * @param {string} siteUrl Site URL to normalize
 * @returns {string} Normalized URL with protocol
 */
export const normalizeUrl = (siteUrl) => {
	if (!siteUrl || typeof siteUrl !== 'string') {
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
