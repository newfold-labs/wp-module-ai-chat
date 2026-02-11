/**
 * Typing indicator status keys and event mapping.
 * Single source of truth for status values shown between typing_start and typing_stop.
 * Hook maps WebSocket event types to these keys; UI maps keys to display strings.
 */

/** Status keys for the typing indicator (no UI copy here) */
export const TYPING_STATUS = {
	PROCESSING: 'processing',
	CONNECTING: 'connecting',
	WS_CONNECTING: 'ws_connecting',
	TOOL_CALL: 'tool_call',
	WORKING: 'working',
	// Existing keys used elsewhere
	RECEIVED: 'received',
	GENERATING: 'generating',
	SUMMARIZING: 'summarizing',
	COMPLETED: 'completed',
	FAILED: 'failed',
};

/**
 * Map WebSocket message type to typing status key.
 * Add new event types here to drive status without scattering branches.
 *
 * @param {string} eventType - data.type from WebSocket message
 * @return {string|null} Status key or null to clear
 */
export function getStatusForEventType(eventType) {
	const map = {
		typing_start: TYPING_STATUS.PROCESSING,
		handoff_request: TYPING_STATUS.CONNECTING,
		handoff_accept: TYPING_STATUS.CONNECTING,
		tool_call: TYPING_STATUS.TOOL_CALL,
		tool_result: TYPING_STATUS.WORKING,
		typing_stop: null,
	};
	return map[eventType] ?? null;
}
