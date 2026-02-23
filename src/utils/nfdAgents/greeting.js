/**
 * NFD Agents Greeting Utilities
 *
 * Utilities for detecting initial greeting messages from agents.
 * Used to filter out system greetings that shouldn't be shown to users.
 */

/**
 * Check if a message is an initial greeting that should be filtered out
 *
 * @param {string} content Message content to check
 * @return {boolean} True if message is an initial greeting
 */
export const isInitialGreeting = (content) => {
	if (!content || typeof content !== "string") {
		return false;
	}

	const normalized = content.toLowerCase().trim();

	// Common greeting patterns - more comprehensive matching
	const greetingPatterns = [
		/^hello!?\s+how\s+can\s+i\s+assist\s+you/i,
		/^hi!?\s+how\s+can\s+i\s+help/i,
		/^hello!?\s+how\s+can\s+i\s+help/i,
		/^hi\s+there!?\s+how\s+can/i,
		/^greetings!?\s+how\s+can/i,
		/^how\s+can\s+i\s+assist\s+you\s+today/i,
		/^how\s+can\s+i\s+help\s+you\s+today/i,
		// Match "Hello! How can I assist you today? Feel free to ask me anything..."
		/^hello!?\s+how\s+can\s+i\s+assist\s+you\s+today/i,
		/^hello!?\s+how\s+can\s+i\s+assist\s+you.*feel\s+free/i,
	];

	// Check if message matches greeting patterns
	const isGreeting = greetingPatterns.some((pattern) => pattern.test(normalized));

	// Also check for messages that contain greeting keywords and are likely initial greetings
	// This catches variations like "Hello! How can I assist you today? Feel free to ask me anything..."
	const hasGreetingKeywords =
		normalized.includes("hello") &&
		(normalized.includes("assist") || normalized.includes("help")) &&
		(normalized.includes("today") ||
			normalized.includes("feel free") ||
			normalized.includes("ask"));

	// Check for very short messages that are likely greetings
	const isShortGreeting =
		normalized.length < 150 &&
		((normalized.includes("hello") &&
			(normalized.includes("assist") || normalized.includes("help"))) ||
			(normalized.includes("hi") && normalized.includes("help")));

	return isGreeting || hasGreetingKeywords || isShortGreeting;
};
