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
 * Generate a unique session ID
 *
 * @return {string} New session ID
 */
export const generateSessionId = () => {
	return crypto.randomUUID
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
};

export default {
	unescapeAiResponse,
	generateSessionId,
};
