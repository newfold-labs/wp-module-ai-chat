/**
 * Unescape AI response text so display shows normal quotes instead of \"
 * Handles JSON-style escaped quotes that can appear in model/tool output.
 *
 * @param {string} text - Raw message text that may contain \" or \'
 * @return {string} Text with escaped quotes replaced for display
 */
export const unescapeAiResponse = (text) => {
	if (!text || typeof text !== "string") {
		return text;
	}
	return text.replace(/\\"/g, '"').replace(/\\'/g, "'");
};

/**
 * Simple hash function to create a unique identifier from a string
 * Uses a variation of the djb2 hash algorithm
 *
 * @param {string} str - The string to hash
 * @return {string} A hexadecimal hash string
 */
export const simpleHash = (str) => {
	// Handle null, undefined, or empty strings
	if (!str || typeof str !== "string") {
		return "0";
	}

	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		// eslint-disable-next-line no-bitwise
		hash = (hash << 5) + hash + str.charCodeAt(i); // hash * 33 + c
		// eslint-disable-next-line no-bitwise
		hash = hash | 0; // Convert to 32-bit integer
	}
	// Convert to unsigned and then to hex
	// eslint-disable-next-line no-bitwise
	return (hash >>> 0).toString(16);
};

/**
 * Generate a unique session ID
 *
 * @return {string} New session ID
 */
export const generateSessionId = () => {
	return crypto.randomUUID
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
};

/**
 * Debounce function
 *
 * @param {Function} func - Function to debounce
 * @param {number}   wait - Wait time in milliseconds
 * @return {Function} Debounced function
 */
export const debounce = (func, wait) => {
	let timeout;
	return function executedFunction(...args) {
		const later = () => {
			clearTimeout(timeout);
			func(...args);
		};
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
	};
};

export default {
	simpleHash,
	generateSessionId,
	debounce,
};
