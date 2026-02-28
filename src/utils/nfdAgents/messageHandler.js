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
 * @param {Object}   deps                    Subset of handler deps
 * @param {Function} deps.setIsTyping        State setter
 * @param {Function} deps.setStatus          State setter
 * @param {Function} deps.setCurrentResponse State setter
 * @param {Object}   deps.typingTimeoutRef   React ref holding the timeout ID
 */
const finalizeTyping = ({ setIsTyping, setStatus, setCurrentResponse, typingTimeoutRef }) => {
	setIsTyping(false);
	setStatus(null);
	setCurrentResponse("");
	clearTypingTimeout(typingTimeoutRef);
};

/**
 * Helper: create and append an assistant message to state.
 *
 * @param {Function} setMessages State setter
 * @param {string}   content     Message content
 * @param {string}   [idSuffix]  Optional suffix for message ID
 * @param {boolean}  [animate]   Whether to animate typing (default true)
 */
const addAssistantMsg = (setMessages, content, idSuffix = "", animate = true) => {
	setMessages((prev) => [
		...prev,
		{
			id: `msg-${Date.now()}${idSuffix}`,
			role: "assistant",
			type: "assistant",
			content,
			timestamp: new Date(),
			animateTyping: animate,
		},
	]);
};

/**
 * Create a WebSocket message handler wired to the hook's state.
 *
 * @param {Object}   deps                    Dependencies from the hook
 * @param {Object}   deps.isStoppedRef       Ref — skip messages after stop
 * @param {Object}   deps.hasUserMessageRef  Ref — controls greeting filtering
 * @param {Object}   deps.typingTimeoutRef   Ref — typing indicator timeout
 * @param {number}   deps.typingTimeout      TYPING_TIMEOUT constant
 * @param {Function} deps.setIsTyping        State setter
 * @param {Function} deps.setStatus          State setter
 * @param {Function} deps.setCurrentResponse State setter
 * @param {Function} deps.setMessages        State setter
 * @param {Function} deps.setConversationId  State setter
 * @param {Function} deps.setError           State setter
 * @param {Function} deps.saveSessionId      callback(sessionId) — persist to ref + localStorage
 * @param {Function} deps.saveConversationId callback(id) — persist to localStorage
 * @return {Function} handleMessage(data) — call with parsed JSON from ws.onmessage
 */
export function createMessageHandler(deps) {
	const {
		isStoppedRef,
		hasUserMessageRef,
		typingTimeoutRef,
		typingTimeout,
		setIsTyping,
		setStatus,
		setCurrentResponse,
		setMessages,
		setConversationId,
		setError,
		saveSessionId,
		saveConversationId,
		onToolCallRef,
	} = deps;

	// Closure variables that track streaming text synchronously.
	// React 18 batching means we cannot reliably read currentResponse
	// from inside another setState callback, so we mirror it here.
	let lastStreamedContent = "";
	let flushedReasoningText = "";

	return function handleMessage(data) {
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
			setCurrentResponse("");
			clearTypingTimeout(typingTimeoutRef);
			return;
		}

		// --- streaming_chunk / chunk ---
		if (data.type === "streaming_chunk" || data.type === "chunk") {
			if (isStoppedRef.current) {
				return;
			}
			const content = data.content || data.chunk || data.text || data.message || "";
			if (content) {
				setCurrentResponse((prev) => {
					const newContent = prev + content;
					if (
						!hasUserMessageRef.current &&
						newContent.length < 100 &&
						isInitialGreeting(newContent)
					) {
						lastStreamedContent = "";
						return "";
					}
					// Mirror into closure so tool_call can read it synchronously
					lastStreamedContent = newContent;
					setIsTyping(true);
					if (typingTimeoutRef.current) {
						clearTimeout(typingTimeoutRef.current);
					}
					typingTimeoutRef.current = setTimeout(() => {
						setIsTyping(false);
						setStatus(null);
						typingTimeoutRef.current = null;
					}, typingTimeout);
					return newContent;
				});
			}
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
				// Finalize any current streaming response first
				setCurrentResponse((prev) => {
					if (prev) {
						addAssistantMsg(setMessages, prev, "-streaming");
					}
					return "";
				});

				addAssistantMsg(setMessages, filtered);
				finalizeTyping(deps);
			}
			return;
		}

		// --- tool_call ---
		if (data.type === "tool_call") {
			setStatus(getStatusForEventType("tool_call"));

			// Flush any accumulated reasoning text as its own message.
			// Read from the closure variable (not nested setState) so the
			// message is created reliably regardless of React 18 batching.
			const reasoningText = lastStreamedContent.trim();
			lastStreamedContent = "";
			flushedReasoningText = reasoningText;
			setCurrentResponse("");
			if (reasoningText) {
				addAssistantMsg(setMessages, reasoningText, "-reasoning", false);
			}

			// Keep typing indicator visible between reasoning flush and tool
			// execution start.  Without this, the dots disappear briefly and
			// the UI feels "done" even though the agent is still working.
			setIsTyping(true);
			clearTypingTimeout(typingTimeoutRef);

			// Dispatch tool calls to the consumer (e.g. editor chat) for
			// client-side execution (block editing, style changes, etc.).
			const toolCalls = data.function_content;

			if (onToolCallRef?.current && Array.isArray(toolCalls) && toolCalls.length > 0) {
				const normalized = toolCalls.map((tc) => {
					try {
						const id = tc.id || `tool-${Date.now()}`;
						const rawName = tc.name || tc.function_name || "";
						const rawArgs =
							typeof tc.arguments === "string" ? JSON.parse(tc.arguments) : tc.arguments || {};

						// The gateway wraps WordPress MCP calls in a meta-tool
						// (e.g. "WordPressPlugin-call_wordpress_tool"). Unwrap to
						// expose the actual tool name and arguments to consumers.
						if (rawName.endsWith("-call_wordpress_tool") && rawArgs.tool_name) {
							let innerArgs = rawArgs.tool_arguments || {};
							if (typeof innerArgs === "string") {
								try {
									innerArgs = JSON.parse(innerArgs);
								} catch (_) {
									/* keep as-is */
								}
							}
							// Normalize: MCP uses slashes (blu/edit-block), client uses dashes (blu-edit-block)
							const toolName = rawArgs.tool_name.replace(/\//g, "-");
							return { id, name: toolName, arguments: innerArgs };
						}

						return { id, name: rawName, arguments: rawArgs };
					} catch (err) {
						console.error("[AI Chat] Failed to normalize tool call:", tc, err); // eslint-disable-line no-console
						return { id: tc.id || `tool-${Date.now()}`, name: tc.name || "unknown", arguments: {} };
					}
				});
				onToolCallRef.current(normalized);
			}
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
			return;
		}

		// --- message / complete ---
		if (data.type === "message" || data.type === "complete") {
			// Check if there's buffered streaming content (tracked synchronously)
			const buffered = lastStreamedContent.trim();
			lastStreamedContent = "";
			setCurrentResponse("");

			let hasContent = false;

			if (buffered) {
				const skip =
					buffered === "No content provided" ||
					buffered === "sales_requested" ||
					buffered.toLowerCase() === "sales_requested" ||
					(!hasUserMessageRef.current && buffered.length < 150 && isInitialGreeting(buffered));
				if (!skip) {
					addAssistantMsg(setMessages, buffered);
					hasContent = true;
				}
			}

			if (!hasContent) {
				const payloadMessage = data.message || data.response_content?.message;
				let filtered = filterMessage(payloadMessage, hasUserMessageRef.current);

				// Strip the reasoning prefix that was already shown in the
				// -reasoning message so the result doesn't repeat it.
				if (filtered && flushedReasoningText && filtered.startsWith(flushedReasoningText)) {
					filtered = filtered.substring(flushedReasoningText.length).trim() || null;
				}

				if (filtered) {
					addAssistantMsg(setMessages, filtered);
					hasContent = true;
				}
			}

			flushedReasoningText = "";

			if (hasContent) {
				finalizeTyping(deps);
			}
			return;
		}

		// --- handoff_accept ---
		if (data.type === "handoff_accept") {
			setStatus(getStatusForEventType("handoff_accept"));
			return;
		}

		// --- handoff_request ---
		if (data.type === "handoff_request") {
			setStatus(getStatusForEventType("handoff_request"));
			const messageContent = data.message || data.response_content?.message;
			const filtered = filterMessage(messageContent, hasUserMessageRef.current);

			if (!filtered) {
				setCurrentResponse("");
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
			setCurrentResponse("");
			return;
		}

		// --- generic fallback (message with content) ---
		if (data.message || data.response_content?.message) {
			const messageContent = data.message || data.response_content?.message;
			const filtered = filterMessage(messageContent, hasUserMessageRef.current);

			if (!filtered) {
				setCurrentResponse("");
				return;
			}

			addAssistantMsg(setMessages, filtered);
			finalizeTyping(deps);
		}
	};
}
