/**
 * WordPress dependencies
 */
import { useState, useCallback, useRef, useEffect } from "@wordpress/element";

/**
 * Internal dependencies
 */
import { generateSessionId } from "../utils/helpers";

/**
 * Chat status enumeration
 */
export const CHAT_STATUS = {
	IDLE: "idle",
	RECEIVED: "received",
	GENERATING: "generating",
	TOOL_CALL: "tool_call",
	SUMMARIZING: "summarizing",
	COMPLETED: "completed",
	FAILED: "failed",
};

/**
 * Default system prompt
 */
const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant. Be concise and helpful in your responses.`;

/**
 * useAIChat Hook
 *
 * A configurable React hook for managing AI chat conversations.
 * Provides extension points for tool handling and message processing.
 *
 * @param {Object}   options                   - Hook configuration options
 * @param {Object}   options.mcpClient         - MCP client instance for tool execution
 * @param {Object}   options.openaiClient      - OpenAI client instance for chat completions
 * @param {string}   options.systemPrompt      - System prompt for the AI
 * @param {Function} options.onToolCall        - Callback before tool execution (can intercept)
 * @param {Function} options.onToolResult      - Callback after tool execution (for glue code)
 * @param {Function} options.onMessageComplete - Callback when a message is complete
 * @param {Function} options.onError           - Callback for errors
 * @param {boolean}  options.autoInitialize    - Auto-initialize MCP client (default: true)
 * @return {Object} Chat state and controls
 */
export const useAIChat = ({
	mcpClient = null,
	openaiClient = null,
	systemPrompt = DEFAULT_SYSTEM_PROMPT,
	onToolCall = null,
	onToolResult = null,
	onMessageComplete = null,
	onError = null,
	autoInitialize = true,
} = {}) => {
	// Chat state
	const [messages, setMessages] = useState([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState(null);
	const [status, setStatus] = useState(CHAT_STATUS.IDLE);
	const [sessionId, setSessionId] = useState(() => generateSessionId());

	// Streaming state
	const [streamingContent, setStreamingContent] = useState("");

	// Tool execution state
	const [activeToolCall, setActiveToolCall] = useState(null);
	const [executedTools, setExecutedTools] = useState([]);
	const [pendingTools, setPendingTools] = useState([]);
	const [toolProgress, setToolProgress] = useState(null);

	// MCP state
	const [mcpConnected, setMcpConnected] = useState(false);
	const [mcpTools, setMcpTools] = useState([]);

	// Refs
	const isProcessingRef = useRef(false);
	const abortControllerRef = useRef(null);

	/**
	 * Initialize MCP client
	 */
	const initializeMCP = useCallback(async () => {
		if (!mcpClient) {
			return false;
		}

		try {
			if (!mcpClient.isConnected()) {
				await mcpClient.connect();
			}
			await mcpClient.initialize();
			setMcpTools(mcpClient.getTools());
			setMcpConnected(true);
			return true;
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error("Failed to initialize MCP:", err);
			setError(`Failed to initialize MCP: ${err.message}`);
			onError?.(err);
			return false;
		}
	}, [mcpClient, onError]);

	/**
	 * Auto-initialize MCP on mount
	 */
	useEffect(() => {
		if (autoInitialize && mcpClient) {
			initializeMCP();
		}

		// Copy ref to variable for cleanup function
		const abortController = abortControllerRef.current;

		return () => {
			if (abortController) {
				abortController.abort();
			}
		};
	}, [autoInitialize, mcpClient, initializeMCP]);

	/**
	 * Create a new message object
	 */
	const createMessage = useCallback((role, content, extras = {}) => {
		return {
			id: `${role}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			role,
			type: role,
			content,
			timestamp: new Date(),
			...extras,
		};
	}, []);

	/**
	 * Execute a single tool call
	 *
	 * The onToolCall callback can return an object with { intercepted: true, result: {...} }
	 * to handle the tool call locally instead of calling MCP.
	 */
	const executeTool = useCallback(
		async (toolCall) => {
			if (!mcpClient) {
				throw new Error("MCP client not available");
			}

			const { name, arguments: args } = toolCall;

			// Call onToolCall - it can optionally intercept and return a result
			if (onToolCall) {
				const interceptResult = await onToolCall(toolCall);

				// If the callback intercepted the call, use its result
				if (interceptResult && interceptResult.intercepted) {
					const result = interceptResult.result || {
						content: [],
						isError: false,
					};

					// Notify after execution (for glue code to react to changes)
					if (onToolResult) {
						await onToolResult(toolCall, result);
					}

					return {
						id: toolCall.id,
						name,
						result,
						isError: result.isError || false,
						hasChanges: result.hasChanges || false,
						undoData: interceptResult.undoData,
					};
				}
			}

			try {
				const result = await mcpClient.callTool(name, args);

				// Notify after execution (for glue code to react to changes)
				if (onToolResult) {
					await onToolResult(toolCall, result);
				}

				return {
					id: toolCall.id,
					name,
					result,
					isError: result.isError || false,
				};
			} catch (err) {
				return {
					id: toolCall.id,
					name,
					error: err.message,
					isError: true,
				};
			}
		},
		[mcpClient, onToolCall, onToolResult]
	);

	/**
	 * Execute all tool calls
	 */
	const executeToolCalls = useCallback(
		async (toolCalls) => {
			const results = [];
			setPendingTools(toolCalls.slice(1));

			for (let i = 0; i < toolCalls.length; i++) {
				const toolCall = toolCalls[i];

				setActiveToolCall({
					...toolCall,
					index: i + 1,
					total: toolCalls.length,
				});

				const result = await executeTool(toolCall);
				results.push(result);

				setExecutedTools((prev) => [...prev, { ...toolCall, ...result }]);
				setPendingTools(toolCalls.slice(i + 2));
			}

			setActiveToolCall(null);
			setPendingTools([]);
			return results;
		},
		[executeTool]
	);

	/**
	 * Send a message and get AI response
	 */
	const sendMessage = useCallback(
		async (userMessage) => {
			if (!openaiClient) {
				setError("OpenAI client not configured");
				return;
			}

			if (isProcessingRef.current) {
				return;
			}

			isProcessingRef.current = true;
			setIsLoading(true);
			setError(null);
			setStatus(CHAT_STATUS.RECEIVED);
			setExecutedTools([]);

			// Add user message
			const userMsg = createMessage("user", userMessage);
			setMessages((prev) => [...prev, userMsg]);

			try {
				// Build conversation history
				const conversationHistory = [
					{ role: "system", content: systemPrompt },
					...messages.map((msg) => ({
						role: msg.role === "user" ? "user" : "assistant",
						content: msg.content,
						toolCalls: msg.toolCalls,
						toolResults: msg.toolResults,
					})),
					{ role: "user", content: userMessage },
				];

				// Get tools in OpenAI format
				const tools = mcpConnected && mcpClient ? mcpClient.getToolsForOpenAI() : [];

				setStatus(CHAT_STATUS.GENERATING);

				let response = null;
				let allToolResults = [];

				// Clear streaming content before starting
				setStreamingContent("");

				// Streaming completion
				await openaiClient.createStreamingCompletion(
					{
						messages: openaiClient.convertMessagesToOpenAI(conversationHistory),
						tools: tools.length > 0 ? tools : undefined,
						tool_choice: tools.length > 0 ? "auto" : undefined,
					},
					// onChunk - update streaming content for real-time display
					(chunk) => {
						setStreamingContent((prev) => prev + chunk);
					},
					// onComplete
					async (fullMessage, toolCalls) => {
						if (toolCalls && toolCalls.length > 0) {
							setStatus(CHAT_STATUS.TOOL_CALL);

							// Execute tool calls
							const toolResults = await executeToolCalls(toolCalls);
							allToolResults = toolResults;

							// Continue conversation with tool results
							setStatus(CHAT_STATUS.SUMMARIZING);

							const followUpHistory = [
								...conversationHistory,
								{
									role: "assistant",
									content: fullMessage || null,
									toolCalls,
									toolResults: toolResults.map((r) => ({
										id: r.id,
										result: r.result,
										error: r.error,
									})),
								},
							];

							// Get follow-up response
							const followUp = await openaiClient.createChatCompletion({
								messages: openaiClient.convertMessagesToOpenAI(followUpHistory),
							});

							response = followUp.choices?.[0]?.message?.content || "";
						} else {
							response = fullMessage;
						}
					},
					// onError
					(err) => {
						throw err;
					}
				);

				// Add assistant message
				if (response) {
					const assistantMsg = createMessage("assistant", response, {
						toolCalls: allToolResults.length > 0 ? allToolResults : undefined,
						executedTools: allToolResults.length > 0 ? allToolResults : undefined,
					});
					setMessages((prev) => [...prev, assistantMsg]);
					onMessageComplete?.(assistantMsg);
				}

				setStatus(CHAT_STATUS.COMPLETED);
			} catch (err) {
				// eslint-disable-next-line no-console
				console.error("Chat error:", err);
				setError(err.message);
				setStatus(CHAT_STATUS.FAILED);
				onError?.(err);
			} finally {
				isProcessingRef.current = false;
				setIsLoading(false);
				setActiveToolCall(null);
				setExecutedTools([]);
				setPendingTools([]);
				setStreamingContent("");
			}
		},
		[
			openaiClient,
			mcpClient,
			mcpConnected,
			messages,
			systemPrompt,
			createMessage,
			executeToolCalls,
			onMessageComplete,
			onError,
		]
	);

	/**
	 * Stop the current request
	 */
	const stopRequest = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}
		isProcessingRef.current = false;
		setIsLoading(false);
		setStatus(CHAT_STATUS.IDLE);
		setActiveToolCall(null);
	}, []);

	/**
	 * Clear conversation history
	 */
	const clearMessages = useCallback(() => {
		setMessages([]);
		setError(null);
		setStatus(CHAT_STATUS.IDLE);
		setSessionId(generateSessionId());
	}, []);

	/**
	 * Add a message programmatically
	 */
	const addMessage = useCallback(
		(role, content, extras = {}) => {
			const msg = createMessage(role, content, extras);
			setMessages((prev) => [...prev, msg]);
			return msg;
		},
		[createMessage]
	);

	return {
		// State
		messages,
		isLoading,
		error,
		status,
		sessionId,
		streamingContent,

		// Tool execution state
		activeToolCall,
		executedTools,
		pendingTools,
		toolProgress,

		// MCP state
		mcpConnected,
		mcpTools,

		// Actions
		sendMessage,
		stopRequest,
		clearMessages,
		addMessage,
		initializeMCP,

		// Setters for advanced usage
		setError,
		setToolProgress,
	};
};

export default useAIChat;
