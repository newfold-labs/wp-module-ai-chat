/**
 * AI Chat Module - Main Entry Point
 *
 * This module provides reusable AI chat functionality for WordPress.
 * Use this as a foundation for editor chat, help center chat, and other AI interfaces.
 */

// Services
export { WordPressMCPClient, createMCPClient, mcpClient, MCPError } from "./services/mcpClient";

export {
	CloudflareOpenAIClient,
	createOpenAIClient,
	openaiClient,
	OpenAIError,
} from "./services/openaiClient";

// Hooks
export { useAIChat, CHAT_STATUS } from "./hooks/useAIChat";

// Utils
export { simpleHash, generateSessionId, debounce } from "./utils/helpers";
export { containsMarkdown, parseMarkdown } from "./utils/markdownParser";
export { sanitizeHtml, containsHtml } from "./utils/sanitizeHtml";

// Chat Components
export { default as ChatMessage } from "./components/chat/ChatMessage";
export { default as ChatMessages } from "./components/chat/ChatMessages";
export { default as ChatInput } from "./components/chat/ChatInput";
export { default as WelcomeScreen } from "./components/chat/WelcomeScreen";

// UI Components
export { default as AILogo } from "./components/ui/AILogo";
export { default as ErrorAlert } from "./components/ui/ErrorAlert";
export { default as SuggestionButton } from "./components/ui/SuggestionButton";
export { default as ToolExecutionList } from "./components/ui/ToolExecutionList";
export { default as TypingIndicator } from "./components/ui/TypingIndicator";
