/* eslint-disable no-console */
/**
 * OpenAI Client that proxies requests through WordPress REST API
 *
 * This client uses the OpenAI SDK configured to route requests through
 * the WordPress proxy endpoint, which then forwards to Cloudflare AI Gateway
 * or direct OpenAI API.
 *
 * Configurable for use across different modules.
 */
import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Custom error class for OpenAI errors
 */
export class OpenAIError extends Error {
	constructor(message, status = null, code = null) {
		super(message);
		this.name = "OpenAIError";
		this.status = status;
		this.code = code;
	}
}

/**
 * OpenAI client that proxies requests through WordPress REST API
 *
 * @param {Object} options           Configuration options
 * @param {string} options.configKey - Window config object name (default: 'nfdAIChat')
 * @param {string} options.apiPath   - REST API path suffix (default: 'ai')
 * @param {string} options.mode      - Mode for system prompt selection (default: 'help')
 */
export class CloudflareOpenAIClient {
	constructor(options = {}) {
		this.configKey = options.configKey || "nfdAIChat";
		this.apiPath = options.apiPath || "ai";
		this.mode = options.mode || "help";
		this.openai = null;
		this.config = null;
	}

	/**
	 * Get configuration from WordPress
	 *
	 * @return {Object} Configuration object
	 */
	getConfig() {
		if (this.config) {
			return this.config;
		}

		// Get config from WordPress localized script
		if (typeof window !== "undefined" && window[this.configKey]) {
			this.config = {
				nonce: window[this.configKey].nonce,
				restUrl: window[this.configKey].restUrl,
				homeUrl: window[this.configKey].homeUrl,
			};
		} else {
			this.config = {
				nonce: "",
				restUrl: "",
				homeUrl: "",
			};
		}

		return this.config;
	}

	/**
	 * Initialize the OpenAI client
	 *
	 * @return {OpenAI} OpenAI client instance
	 */
	getOpenAIClient() {
		if (this.openai) {
			return this.openai;
		}

		const config = this.getConfig();

		// Use WordPress proxy endpoint - all authentication handled server-side
		this.openai = new OpenAI({
			apiKey: "proxy", // Dummy key - real key is on the server
			baseURL: `${config.restUrl}${this.apiPath}`,
			dangerouslyAllowBrowser: true,
			defaultHeaders: {
				"X-WP-Nonce": config.nonce,
			},
		});

		return this.openai;
	}

	/**
	 * Create a chat completion request (non-streaming)
	 *
	 * @param {Object} request Chat completion request params
	 * @return {Promise<Object>} Chat completion response
	 */
	async createChatCompletion(request) {
		try {
			const openai = this.getOpenAIClient();
			const response = await openai.chat.completions.create({
				model: request.model || DEFAULT_MODEL,
				messages: request.messages,
				tools: request.tools,
				tool_choice: request.tool_choice,
				stream: false,
				max_tokens: request.max_tokens,
				temperature: request.temperature,
				mode: request.mode || this.mode,
			});

			return response;
		} catch (error) {
			throw new OpenAIError(error.message || "OpenAI API request failed", error.status, error.code);
		}
	}

	/**
	 * Create a streaming chat completion
	 *
	 * @param {Object}   request    Chat completion request params
	 * @param {Function} onChunk    Callback for each chunk
	 * @param {Function} onComplete Callback when complete
	 * @param {Function} onError    Callback for errors
	 * @return {Promise<void>}
	 */
	async createStreamingCompletion(request, onChunk, onComplete, onError) {
		try {
			const openai = this.getOpenAIClient();
			const stream = await openai.chat.completions.create({
				...request,
				messages: request.messages,
				stream: true,
				stream_options: { include_usage: true },
				mode: request.mode || this.mode,
			});

			let fullMessage = "";
			let usage = null;
			const toolCallsInProgress = {};

			let finishReason = null;

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta;

				if (delta?.reasoning) {
					onChunk({
						type: "reasoning",
						content: delta.reasoning,
					});
				}

				if (delta?.content) {
					fullMessage += delta.content;
					onChunk({
						type: "content",
						content: delta.content,
					});
				}

				// Handle streaming tool calls
				if (delta?.tool_calls) {
					for (const toolCall of delta.tool_calls) {
						const index = toolCall.index;

						if (!toolCallsInProgress[index]) {
							toolCallsInProgress[index] = {
								id: toolCall.id || "",
								type: "function",
								function: {
									name: toolCall.function?.name || "",
									arguments: "",
								},
							};
						}

						if (toolCall.id) {
							toolCallsInProgress[index].id = toolCall.id;
						}

						if (toolCall.function?.name) {
							toolCallsInProgress[index].function.name = toolCall.function.name;
						}

						if (toolCall.function?.arguments) {
							toolCallsInProgress[index].function.arguments += toolCall.function.arguments;
						}
					}

					onChunk({
						type: "tool_calls",
						tool_calls: Object.values(toolCallsInProgress),
					});
				}

				if (chunk.choices[0]?.finish_reason) {
					finishReason = chunk.choices[0].finish_reason;
				}

				// Usage arrives in a separate final chunk after finish_reason
				if (chunk.usage) {
					usage = chunk.usage;
					console.log(
						`[Token Usage] prompt: ${usage.prompt_tokens} | completion: ${usage.completion_tokens} | total: ${usage.total_tokens}`
					);
				}
			}

			// Fallback: SDK stores usage on the stream object after iteration
			if (!usage && stream.usage) {
				usage = stream.usage;
			}

			if (usage) {
				console.log(
					`[Token Usage] prompt: ${usage.prompt_tokens} | completion: ${usage.completion_tokens} | total: ${usage.total_tokens}`
				);
			}

			// Stream ended — call onComplete with collected data
			if (finishReason) {
				const finalToolCalls = Object.values(toolCallsInProgress).map((tc) => ({
					id: tc.id,
					name: tc.function.name,
					arguments: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
				}));

				await onComplete(fullMessage, finalToolCalls.length > 0 ? finalToolCalls : null, usage);
			}
		} catch (error) {
			onError(
				new OpenAIError(error.message || "Streaming request failed", error.status, error.code)
			);
		}
	}

	/**
	 * Convert chat messages to OpenAI format
	 * Optimizes token usage by truncating assistant content and summarizing tool results
	 *
	 * @param {Array} messages Array of chat messages
	 * @return {Array} OpenAI formatted messages
	 */
	convertMessagesToOpenAI(messages) {
		const openaiMessages = [];

		for (const message of messages) {
			if (message.role === "system" || message.role === "user") {
				openaiMessages.push({
					role: message.role,
					content: message.content ?? "",
				});
			} else if (message.role === "assistant") {
				const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
				const hasContent =
					message.content !== null && message.content !== undefined && message.content !== "";

				// Skip invalid assistant messages
				if (!hasContent && !hasToolCalls) {
					console.warn("Skipping invalid assistant message with no content and no tool calls");
					continue;
				}

				// Truncate assistant content when tool calls present to save tokens
				let content = message.content ?? "";
				if (hasToolCalls && content.length > 200) {
					content = content.substring(0, 200) + "...";
				}

				const assistantMessage = {
					role: "assistant",
					content: hasToolCalls ? content || null : content,
				};

				if (hasToolCalls) {
					assistantMessage.tool_calls = message.toolCalls.map((call) => ({
						id: call.id,
						type: "function",
						function: {
							name: call.name,
							arguments:
								typeof call.arguments === "string"
									? call.arguments
									: JSON.stringify(call.arguments),
						},
					}));
				}

				openaiMessages.push(assistantMessage);

				// Add summarized tool results if present (save tokens by only sending status)
				if (hasToolCalls && message.toolResults && message.toolResults.length > 0) {
					for (const result of message.toolResults) {
						const hasMatchingCall = message.toolCalls.some((call) => call.id === result.id);
						if (hasMatchingCall) {
							// Summarize result to save tokens - just status, not full content
							const summary = result.error ? `Error: ${result.error.substring(0, 100)}` : "Success";
							openaiMessages.push({
								role: "tool",
								content: summary,
								tool_call_id: result.id,
							});
						}
					}
				}
			}
		}

		return openaiMessages;
	}

	/**
	 * Convert MCP tools to OpenAI tools format
	 *
	 * @param {Array} mcpTools Array of MCP tools
	 * @return {Array} OpenAI tools array
	 */
	convertMCPToolsToOpenAI(mcpTools) {
		return mcpTools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema,
			},
		}));
	}

	/**
	 * Process tool calls from OpenAI response
	 *
	 * @param {Array} toolCalls Raw tool calls from OpenAI
	 * @return {Array} Processed tool calls
	 */
	processToolCalls(toolCalls) {
		return toolCalls.map((call) => ({
			id: call.id,
			name: call.function.name,
			arguments: JSON.parse(call.function.arguments || "{}"),
		}));
	}

	/**
	 * Send a simple chat message
	 *
	 * @param {string} message User message
	 * @param {Array}  context Previous messages for context
	 * @param {Array}  tools   Available MCP tools
	 * @return {Promise<Object>} Response with message and optional tool calls
	 */
	async sendMessage(message, context = [], tools = []) {
		const messages = this.convertMessagesToOpenAI([
			...context,
			{
				id: `user-${Date.now()}`,
				role: "user",
				content: message,
				timestamp: new Date(),
			},
		]);

		const request = {
			model: DEFAULT_MODEL,
			messages,
			tools: tools.length > 0 ? this.convertMCPToolsToOpenAI(tools) : undefined,
			tool_choice: tools.length > 0 ? "auto" : undefined,
			temperature: 0.1,
			max_tokens: 4000,
		};

		try {
			const response = await this.createChatCompletion(request);
			const choice = response.choices[0];

			if (!choice) {
				throw new OpenAIError("No response from OpenAI");
			}

			const result = {
				message: choice.message.content || "",
			};

			if (choice.message.tool_calls) {
				result.toolCalls = this.processToolCalls(choice.message.tool_calls);
			}

			return result;
		} catch (error) {
			if (error instanceof OpenAIError) {
				throw error;
			}
			throw new OpenAIError(`Failed to send message: ${error}`);
		}
	}
}

/**
 * Create a new OpenAI client instance
 *
 * @param {Object} options Configuration options
 * @return {CloudflareOpenAIClient} New client instance
 */
export const createOpenAIClient = (options = {}) => {
	return new CloudflareOpenAIClient(options);
};

// Default singleton instance for backwards compatibility
export const openaiClient = new CloudflareOpenAIClient();

export default openaiClient;
