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
 * Normalize a string for dedup comparison.
 * - Inserts a space after sentence-ending punctuation that butts against a
 *   letter (the model often concatenates like "accordingly.I will" or
 *   "plan.then do").
 * - Collapses all whitespace runs to a single space.
 *
 * Both sides of the dedup get the same transform, so over-normalizing
 * (e.g. "e.g.foo" → "e. g. foo") is safe — the match still holds.
 */
const normalizeSentences = (s) =>
	s
		.replace(/([.!?])([A-Za-z])/g, "$1 $2")
		.replace(/\s+/g, " ")
		.trim();

/**
 * Strip previously-displayed reasoning prefixes from the final response.
 *
 * The model re-includes its "planning" text (from one or more tool-call
 * rounds) at the start of the post-tool summary, often without whitespace
 * between the pieces.  This helper strips each reasoning text sequentially
 * from the beginning of the final response and returns only the new tail,
 * or null when the entire message is a duplicate.
 *
 * @param {string}   text       Final response text (already trimmed/filtered)
 * @param {string[]} reasonings Array of previously-flushed reasoning texts
 * @return {string|null}        Deduplicated text, or null if fully duplicate
 */
const deduplicateReasoning = (text, reasonings) => {
	if (!reasonings || reasonings.length === 0) {
		return text;
	}

	let remaining = normalizeSentences(text);

	for (const r of reasonings) {
		const normR = normalizeSentences(r);
		if (!normR) {
			continue;
		}
		if (remaining.startsWith(normR)) {
			remaining = remaining.substring(normR.length).trim();
			continue;
		}

		// Fallback: whitespace-insensitive prefix match.
		// Reasoning models can produce token-boundary artifacts where
		// streamed text differs from the final payload only by whitespace
		// (e.g. "a4-column" streamed vs "a 4-column" in final text).
		const compactR = normR.replace(/\s/g, "");
		const compactRemaining = remaining.replace(/\s/g, "");
		if (compactRemaining.startsWith(compactR)) {
			// Walk through `remaining` consuming non-space characters
			// until we've matched all of compactR, then strip that prefix.
			let matched = 0;
			let idx = 0;
			while (idx < remaining.length && matched < compactR.length) {
				if (remaining[idx] !== " ") {
					matched++;
				}
				idx++;
			}
			remaining = remaining.substring(idx).trim();
		}
	}

	// If we stripped everything, the message was fully duplicate.
	return remaining || null;
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
	let flushedReasoningTexts = [];
	let suppressDisplay = false;
	let reasoningStartTime = null;
	// Accumulated reasoning text across multiple tool-call rounds.
	// Merged into ONE thinking toggle instead of creating separate ones.
	let accumulatedReasoningContent = "";

	/**
	 * Mark any active (uncompleted) reasoning messages as complete.
	 * Called at the start of tool_call and message/complete handlers
	 * so the previously-active reasoning toggle collapses.
	 */
	const completeActiveReasoning = () => {
		setMessages((prev) => {
			const hasActive = prev.some(
				(m) => m.id?.endsWith("-reasoning") && !m.reasoningComplete
			);
			if (!hasActive) {
				return prev;
			}
			return prev.map((m) =>
				m.id?.endsWith("-reasoning") && !m.reasoningComplete
					? { ...m, reasoningComplete: true }
					: m
			);
		});
	};

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
			if (!reasoningStartTime) {
				reasoningStartTime = Date.now();
			}
			setIsTyping(true);
			setStatus(getStatusForEventType("typing_start"));
			clearTypingTimeout(typingTimeoutRef);
			return;
		}

		// --- typing_stop ---
		if (data.type === "typing_stop") {
			lastStreamedContent = "";
			flushedReasoningTexts = [];
			suppressDisplay = false;
			reasoningStartTime = null;
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

			// Between tool_call and tool_result, SK's streaming callback sends
			// a summary chunk containing the FULL accumulated text from the
			// previous round.  Allowing it through would re-populate
			// lastStreamedContent with already-flushed text, creating duplicate
			// reasoning toggles on the next tool_call flush.  The tool_result
			// handler resets suppressDisplay = false before real new-round
			// chunks arrive, so skipping here is safe.
			if (suppressDisplay) {
				return;
			}

			const content = data.content || data.chunk || data.text || data.message || "";
			if (content) {
				// Update the mirror variable SYNCHRONOUSLY before React's
				// batched setState so that tool_call (which may arrive in
				// the very next macrotask) always reads the latest value.
				lastStreamedContent += content;

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
				suppressDisplay = false;
				completeActiveReasoning();
				accumulatedReasoningContent = "";
				const bufferedContent = lastStreamedContent.trim();
				lastStreamedContent = "";
				setCurrentResponse("");

				let finalText = filtered;
				if (flushedReasoningTexts.length > 0) {
					finalText = deduplicateReasoning(filtered, flushedReasoningTexts);
					// Keep reasoning messages — they're permanent collapsed toggles.
					// Only add the final response as a new message below them.
					if (finalText) {
						addAssistantMsg(setMessages, finalText);
					}
					reasoningStartTime = null;
				} else {
					if (bufferedContent) {
						addAssistantMsg(setMessages, bufferedContent, "-streaming");
					}
					addAssistantMsg(setMessages, finalText);
				}

				flushedReasoningTexts = [];
				finalizeTyping(deps);
			}
			return;
		}

		// --- tool_call ---
		if (data.type === "tool_call") {
			setStatus(getStatusForEventType("tool_call"));

			// Do NOT call completeActiveReasoning() here — we want to keep
			// the toggle open and APPEND text from subsequent reasoning rounds
			// so the user sees ONE unified thinking toggle, not separate ones.

			// Flush any accumulated reasoning text into the single toggle.
			const reasoningText = lastStreamedContent.trim();
			lastStreamedContent = "";
			setCurrentResponse("");
			if (reasoningText) {
				flushedReasoningTexts.push(reasoningText);

				// Append to the accumulated reasoning for the unified toggle.
				accumulatedReasoningContent +=
					(accumulatedReasoningContent ? "\n\n" : "") + reasoningText;

				const durationSeconds = reasoningStartTime
					? Math.round((Date.now() - reasoningStartTime) / 1000)
					: 0;

				// Update existing active reasoning message or create one.
				setMessages((prev) => {
					const idx = prev.findLastIndex(
						(m) => m.id?.endsWith("-reasoning") && !m.reasoningComplete
					);
					if (idx !== -1) {
						// Append to existing — single unified toggle
						return [
							...prev.slice(0, idx),
							{
								...prev[idx],
								content: accumulatedReasoningContent,
								durationSeconds,
							},
							...prev.slice(idx + 1),
						];
					}
					// Create new active reasoning message
					return [
						...prev,
						{
							id: `msg-${Date.now()}-reasoning`,
							role: "assistant",
							type: "assistant",
							content: accumulatedReasoningContent,
							timestamp: new Date(),
							animateTyping: false,
							reasoningComplete: false,
							durationSeconds,
						},
					];
				});
			}

			// Suppress post-tool streaming so the deduped final response
			// can appear fresh with typewriter animation.
			suppressDisplay = true;

			// Reset the reasoning timer so each streaming round is measured
			// from when it begins.
			reasoningStartTime = Date.now();

			// Keep typing indicator visible between reasoning flush and tool
			// execution start.  Without this, the dots disappear briefly and
			// the UI feels "done" even though the agent is still working.
			setIsTyping(true);
			clearTypingTimeout(typingTimeoutRef);

			// Dispatch tool calls to the consumer (e.g. editor chat) for
			// client-side execution (block editing, style changes, etc.).
			const toolCalls = data.function_content;

			if (onToolCallRef?.current && Array.isArray(toolCalls) && toolCalls.length > 0) {
				const normalized = toolCalls.map((tc, idx) => {
					try {
						const id = tc.id || `tool-${Date.now()}-${idx}`;
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
						return {
							id: tc.id || `tool-${Date.now()}-${idx}`,
							name: tc.name || "unknown",
							arguments: {},
						};
					}
				});
				try {
					onToolCallRef.current(normalized);
				} catch (err) {
					console.error("[AI Chat] Tool call handler threw an error:", err); // eslint-disable-line no-console
				}
			}
			return;
		}

		// --- tool_result ---
		if (data.type === "tool_result") {
			// Allow the next reasoning round to stream to the UI.
			// Without this, suppressDisplay stays true from the prior tool_call
			// and all subsequent reasoning text goes to lastStreamedContent only
			// (invisible to the user for the entire duration).
			suppressDisplay = false;
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
			suppressDisplay = false;

			// Collapse any still-active reasoning toggle.
			completeActiveReasoning();
			accumulatedReasoningContent = "";

			const buffered = lastStreamedContent.trim();
			lastStreamedContent = "";
			setCurrentResponse("");

			// Determine final content.
			// IMPORTANT: prefer the payload text over the buffer.
			// lastStreamedContent may be truncated due to React 18 batching —
			// setCurrentResponse callbacks update it inside state transitions
			// which may not have flushed by the time this handler reads it.
			// The payload is authoritative (complete text from the backend).
			const payloadMessage = data.message || data.response_content?.message;
			const payloadFiltered = filterMessage(payloadMessage, hasUserMessageRef.current);

			let finalContent = null;
			// If there was streaming, the user already saw the text — skip animation.
			let fromBuffer = buffered.length > 0;

			if (payloadFiltered) {
				finalContent = payloadFiltered;
			} else if (buffered) {
				finalContent = filterMessage(buffered, hasUserMessageRef.current);
			}

			// Deduplicate reasoning prefixes from the final response
			if (finalContent && flushedReasoningTexts.length > 0) {
				finalContent = deduplicateReasoning(finalContent, flushedReasoningTexts);
			}

			// Keep reasoning messages — they're permanent collapsed toggles.
			// Only add the final response as a new message below them.
			if (flushedReasoningTexts.length > 0) {
				if (finalContent) {
					addAssistantMsg(setMessages, finalContent);
				}
				reasoningStartTime = null;
			} else if (finalContent) {
				// No tool calls — standard message commit.
				// fromBuffer means user already saw it streamed, skip animation.
				addAssistantMsg(setMessages, finalContent, "", !fromBuffer);
			}

			flushedReasoningTexts = [];
			finalizeTyping(deps);
			return;
		}

		// --- handoff_accept ---
		if (data.type === "handoff_accept") {
			setStatus(getStatusForEventType("handoff_accept"));
			return;
		}

		// --- handoff_request ---
		if (data.type === "handoff_request") {
			lastStreamedContent = "";
			flushedReasoningTexts = [];
			accumulatedReasoningContent = "";
			reasoningStartTime = null;
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
			lastStreamedContent = "";
			flushedReasoningTexts = [];
			accumulatedReasoningContent = "";
			suppressDisplay = false;
			reasoningStartTime = null;
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
