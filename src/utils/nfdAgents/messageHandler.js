/**
 * NFD Agents WebSocket Message Handler
 *
 * Extracts the entire ws.onmessage protocol handling from useNfdAgentsWebSocket.
 * Factory returns a handleMessage(data) function wired to the hook's state setters and refs.
 */

import { getStatusForEventType } from "../../constants/nfdAgents/typingStatus";
import { isInitialGreeting } from "./greeting";

/**
 * Helper: extract and filter a message string from a WebSocket payload.
 * Returns null when the content should be suppressed (system noise, empty, filtered greeting).
 *
 * @param {string|undefined} raw            Raw message string
 * @param {boolean}          hasUserMessage Whether user has sent a message yet
 * @return {string|null} Cleaned message or null to suppress
 */
const filterMessage = (raw, hasUserMessage) => {
	const trimmed = raw?.trim();
	if (
		!trimmed ||
		trimmed === "No content provided" ||
		trimmed === "sales_requested" ||
		trimmed.toLowerCase() === "sales_requested"
	) {
		return null;
	}
	if (!hasUserMessage && trimmed.length < 150 && isInitialGreeting(trimmed)) {
		return null;
	}
	return trimmed;
};

/**
 * Helper: clear the typing timeout ref.
 *
 * @param {Object} typingTimeoutRef React ref holding the timeout ID
 */
const clearTypingTimeout = (typingTimeoutRef) => {
	if (typingTimeoutRef.current) {
		clearTimeout(typingTimeoutRef.current);
		typingTimeoutRef.current = null;
	}
};

/**
 * Helper: finalize typing state after content is received.
 *
 * Also implicitly confirms message delivery: an assistant turn-completing event proves the
 * backend received and processed the in-flight user message(s). Clearing the outbox here is
 * the backward-compatible path for backends that don't emit a `message_received` ACK — without
 * it, a reconnect after the turn would resend an already-handled message.
 *
 * @param {Object}   deps                          Subset of handler deps
 * @param {Function} deps.setIsTyping              State setter
 * @param {Function} deps.setStatus                State setter
 * @param {Object}   deps.typingTimeoutRef         React ref holding the timeout ID
 * @param {Function} [deps.confirmMessageDelivery] Optional. Called with null to clear the outbox.
 */
const finalizeTyping = ({ setIsTyping, setStatus, typingTimeoutRef, confirmMessageDelivery }) => {
	setIsTyping(false);
	setStatus(null);
	clearTypingTimeout(typingTimeoutRef);
	if (typeof confirmMessageDelivery === "function") {
		confirmMessageDelivery(null);
	}
};

/**
 * Helper: create and append an assistant message to state.
 *
 * @param {Function} setMessages State setter
 * @param {string}   content     Message content
 * @param {string}   [idSuffix]  Optional suffix for message ID
 */
const addAssistantMsg = (setMessages, content, idSuffix = "") => {
	setMessages((prev) => [
		...prev,
		{
			id: `msg-${Date.now()}${idSuffix}`,
			role: "assistant",
			type: "assistant",
			content,
			timestamp: new Date(),
			animateTyping: true,
		},
	]);
};

/**
 * Create a WebSocket message handler wired to the hook's state.
 *
 * @param {Object}   deps                          Dependencies from the hook
 * @param {Object}   deps.isStoppedRef             Ref — skip messages after stop
 * @param {Object}   deps.hasUserMessageRef        Ref — controls greeting filtering
 * @param {Object}   deps.typingTimeoutRef         Ref — typing indicator timeout
 * @param {Function} deps.setIsTyping              State setter
 * @param {Function} deps.setStatus                State setter
 * @param {Function} deps.setMessages              State setter
 * @param {Function} deps.setConversationId        State setter
 * @param {Function} deps.setError                 State setter
 * @param {Function} deps.saveSessionId            callback(sessionId) — persist to ref + localStorage
 * @param {Function} deps.saveConversationId       callback(id) — persist to localStorage
 * @param {Function} [deps.confirmMessageDelivery] Optional. callback(clientMessageId|null) —
 *                                                 removes an outbox entry on an explicit
 *                                                 `message_received` ACK (id given), or clears the
 *                                                 whole outbox on implicit turn completion (null).
 * @param {Function} [deps.bumpTypingTimeout]      Optional. Refreshes the typing-indicator
 *                                                 auto-hide timer when an active timeout exists.
 *                                                 Called for every progress event so a long tool
 *                                                 call or summarization phase doesn't trip the
 *                                                 "no response in N seconds" auto-hide.
 * @return {Function} handleMessage(data) — call with parsed JSON from ws.onmessage
 */
export function createMessageHandler(deps) {
	const {
		isStoppedRef,
		hasUserMessageRef,
		typingTimeoutRef,
		setIsTyping,
		setStatus,
		setMessages,
		setConversationId,
		setError,
		saveSessionId,
		saveConversationId,
		confirmMessageDelivery,
		bumpTypingTimeout,
	} = deps;

	const refreshTyping = () => {
		if (typeof bumpTypingTimeout === "function") {
			bumpTypingTimeout();
		}
	};

	return function handleMessage(data) {
		// --- message_received (delivery ACK) ---
		// Handled before the stop guard: it carries no displayable content and confirming
		// delivery (so we don't resend) is valid even after the user stops the turn. A real ACK
		// always carries the id of the message it confirms (the backend gates the frame on
		// client_message_id), so confirm only that specific message. An id-less frame is malformed
		// and must NOT fall through to confirmMessageDelivery(null), whose clear-all would drop
		// unrelated pending sends.
		if (data.type === "message_received") {
			if (data.client_message_id && typeof confirmMessageDelivery === "function") {
				confirmMessageDelivery(data.client_message_id);
			}
			return;
		}

		// If user has stopped generation, ignore all messages except session_established
		if (isStoppedRef.current && data.type !== "session_established") {
			return;
		}

		// --- session_established ---
		if (data.type === "session_established") {
			if (data.session_id) {
				saveSessionId(data.session_id);
			}
			return;
		}

		// --- typing_start ---
		if (data.type === "typing_start") {
			setIsTyping(true);
			setStatus(getStatusForEventType("typing_start"));
			clearTypingTimeout(typingTimeoutRef);
			return;
		}

		// --- typing_stop ---
		if (data.type === "typing_stop") {
			setIsTyping(false);
			setStatus(null);
			clearTypingTimeout(typingTimeoutRef);
			return;
		}

		// --- streaming_chunk / chunk ---
		// Backend bursts these without pacing for guardrail-rewritten turns, so
		// rendering them live looks identical to revealing the structured_output
		// payload via the ChatMessage typewriter. Drop them; structured_output
		// carries the full text. Still refresh the typing timer so the indicator
		// doesn't auto-hide mid-stream.
		if (data.type === "streaming_chunk" || data.type === "chunk") {
			refreshTyping();
			return;
		}

		// --- structured_output ---
		if (data.type === "structured_output") {
			const humanInputRequest = data.response_content?.content?.human_input_request;

			if (humanInputRequest) {
				const inputType = (
					humanInputRequest.input_type ||
					humanInputRequest.inputType ||
					""
				).toUpperCase();

				if (inputType === "APPROVAL_REQUEST") {
					if (data.conversation_id || data.conversationId) {
						const newConversationId = data.conversation_id || data.conversationId;
						setConversationId(newConversationId);
						saveConversationId(newConversationId);
					}
					return;
				}
			}

			const structuredMessage = data.message || data.response_content?.message;
			const filtered = filterMessage(structuredMessage, hasUserMessageRef.current);
			if (filtered) {
				addAssistantMsg(setMessages, filtered);
				finalizeTyping(deps);
			}
			return;
		}

		// --- tool_call ---
		if (data.type === "tool_call") {
			setStatus(getStatusForEventType("tool_call"));
			refreshTyping();
			return;
		}

		// --- tool_result ---
		if (data.type === "tool_result") {
			setStatus(getStatusForEventType("tool_result"));
			if (data.conversation_id || data.conversationId) {
				const newConversationId = data.conversation_id || data.conversationId;
				setConversationId(newConversationId);
				saveConversationId(newConversationId);
			}
			refreshTyping();
			return;
		}

		// --- message / complete ---
		if (data.type === "message" || data.type === "complete") {
			const payloadMessage = data.message || data.response_content?.message;
			const filtered = filterMessage(payloadMessage, hasUserMessageRef.current);
			if (filtered) {
				addAssistantMsg(setMessages, filtered);
				finalizeTyping(deps);
			}
			return;
		}

		// --- handoff_accept ---
		if (data.type === "handoff_accept") {
			setStatus(getStatusForEventType("handoff_accept"));
			refreshTyping();
			return;
		}

		// --- handoff_request ---
		if (data.type === "handoff_request") {
			setStatus(getStatusForEventType("handoff_request"));
			const messageContent = data.message || data.response_content?.message;
			const filtered = filterMessage(messageContent, hasUserMessageRef.current);

			if (!filtered) {
				return;
			}

			addAssistantMsg(setMessages, filtered);
			finalizeTyping(deps);
			return;
		}

		// --- error ---
		if (data.type === "error") {
			setError(data.message || data.error || "An error occurred");
			setIsTyping(false);
			setStatus(null);
			// The turn ended (in error). The message reached the backend, so clear the outbox to
			// avoid resending it on reconnect.
			if (typeof confirmMessageDelivery === "function") {
				confirmMessageDelivery(null);
			}
			return;
		}

		// --- generic fallback (message with content) ---
		if (data.message || data.response_content?.message) {
			const messageContent = data.message || data.response_content?.message;
			const filtered = filterMessage(messageContent, hasUserMessageRef.current);

			if (!filtered) {
				return;
			}

			addAssistantMsg(setMessages, filtered);
			finalizeTyping(deps);
		}
	};
}
