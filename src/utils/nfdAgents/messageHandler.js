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
 * backend received and processed one in-flight user message, so the OLDEST pending outbox entry
 * is cleared (the backend processes sends in order). This is the backward-compatible path for
 * backends that don't emit a `message_received` ACK — without it, a message the backend has
 * already answered would still be sitting in the outbox and get surfaced for Retry.
 *
 * @param {Object}   deps                          Subset of handler deps
 * @param {Function} deps.setIsTyping              State setter
 * @param {Function} deps.setStatus                State setter
 * @param {Object}   deps.typingTimeoutRef         React ref holding the timeout ID
 * @param {Function} [deps.confirmMessageDelivery] Optional. Called with null to clear the oldest
 *                                                 pending outbox entry.
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
 *                                                 oldest pending entry on implicit turn completion
 *                                                 (null).
 * @param {Function} [deps.notifyResponseActivity] Optional. callback() — called on the first turn
 *                                                 activity frame so the response-silence watchdog
 *                                                 stops tracking a message that did get a response.
 * @param {Function} [deps.armResponseTimeout]     Optional. callback() — (re)starts the
 *                                                 response-silence watchdog; invoked on typing_start
 *                                                 when no timer is active so queued-then-delivered
 *                                                 sends get the same silence handling as live sends.
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
		notifyResponseActivity,
		armResponseTimeout,
		bumpTypingTimeout,
	} = deps;

	const refreshTyping = () => {
		if (typeof bumpTypingTimeout === "function") {
			bumpTypingTimeout();
		}
	};

	// A turn-completing frame whose content was filtered out (initial greeting,
	// "sales_requested", "No content provided") renders nothing and so never reaches
	// finalizeTyping — but the backend still received and processed the user message.
	// Confirm delivery anyway, otherwise the outbox entry survives the turn and a later
	// reconnect retires it, surfacing a misleading Retry on a message that was handled.
	// No-op when the outbox is empty (e.g. the greeting filter, which runs before any
	// user message exists) or when the backend already sent a `message_received` ACK.
	const confirmFilteredTurn = () => {
		if (typeof confirmMessageDelivery === "function") {
			confirmMessageDelivery(null);
		}
	};

	return function handleMessage(data) {
		// --- message_received (delivery ACK) ---
		// Handled before the stop guard: it carries no displayable content and confirming
		// delivery (so we don't resend) is valid even after the user stops the turn. A real ACK
		// always carries the id of the message it confirms (the backend gates the frame on
		// client_message_id), so confirm only that specific message. An id-less frame is malformed
		// and must NOT fall through to confirmMessageDelivery(null), which would clear an unrelated
		// pending send (the oldest one).
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

		// Any frame past this point is turn activity for the in-flight message (typing, tool calls,
		// content, an approval request, or an error) — proof the backend is responding. Resolve the
		// response wait so the silence watchdog never flags a turn that did get answered, including
		// responses (e.g. approval requests) that arrive without a preceding typing_start. Runs
		// before the per-type branches, several of which return early.
		if (typeof notifyResponseActivity === "function") {
			notifyResponseActivity();
		}

		// --- typing_start ---
		if (data.type === "typing_start") {
			setIsTyping(true);
			setStatus(getStatusForEventType("typing_start"));
			// Ensure the response-silence watchdog is running so a stall AFTER typing_start still
			// auto-hides the indicator and surfaces Retry. Online sends armed it at send time; sends
			// queued while offline (delivered later by the reconnect flush) may not have — start one
			// here if none is active. A running timer is left as-is (it'll be bumped by later events).
			if (!typingTimeoutRef.current && typeof armResponseTimeout === "function") {
				armResponseTimeout();
			}
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
					// An approval request proves the backend received and processed the user
					// message, even though this branch renders nothing and so never reaches
					// finalizeTyping. Confirm delivery here or the entry sits in the outbox for
					// the whole approval wait and gets retired (surfacing a misleading Retry on
					// an already-processed message) if the socket drops meanwhile. On a backend
					// that emits `message_received` the entry is already gone and this no-ops.
					if (typeof confirmMessageDelivery === "function") {
						confirmMessageDelivery(null);
					}
					return;
				}
			}

			const structuredMessage = data.message || data.response_content?.message;
			const filtered = filterMessage(structuredMessage, hasUserMessageRef.current);
			if (filtered) {
				addAssistantMsg(setMessages, filtered);
				finalizeTyping(deps);
			} else {
				confirmFilteredTurn();
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
			} else {
				confirmFilteredTurn();
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
				confirmFilteredTurn();
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
			// The turn ended (in error). The message reached the backend, so clear its outbox entry
			// (the oldest pending one) rather than surfacing Retry for it on the next connect.
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
				confirmFilteredTurn();
				return;
			}

			addAssistantMsg(setMessages, filtered);
			finalizeTyping(deps);
		}
	};
}
