/**
 * NFD Agents chat input constants.
 *
 * Central place for textarea and input behavior used by the chat UI (e.g. ChatInput).
 * Add timeouts and dimension limits here to avoid magic numbers in components.
 */

/** Chat input configuration: dimensions, focus delay, and debounce timings. */
export const INPUT = {
	MAX_HEIGHT: 200, // Textarea max height (px) before scrolling
	FOCUS_DELAY: 100, // Delay before focusing input after mount or panel open (ms)
	STOP_DEBOUNCE: 500, // Debounce for stop-generation button to avoid double-firing (ms)
};
