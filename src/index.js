/**
 * AI Chat Module - Main Entry Point
 *
 * This module provides reusable AI chat functionality for WordPress.
 * Use this as a foundation for editor chat, help center chat, and other AI interfaces.
 */

import "./styles/app.scss";

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
export { default as useNfdAgentsWebSocket } from "./hooks/useNfdAgentsWebSocket";

// Utils
export { simpleHash, generateSessionId, debounce } from "./utils/helpers";
export { containsMarkdown, parseMarkdown } from "./utils/markdownParser";
export { sanitizeHtml, containsHtml } from "./utils/sanitizeHtml";

// NFD Agents Utilities
export {
	convertToWebSocketUrl,
	normalizeUrl,
	isLocalhost,
	buildWebSocketUrl,
} from "./utils/nfdAgents/url";
export { isInitialGreeting } from "./utils/nfdAgents/greeting";

// Constants
export { NFD_AGENTS_WEBSOCKET } from "./constants/nfdAgents/websocket";
export { getChatHistoryStorageKeys } from "./constants/nfdAgents/storageKeys";
export { TYPING_STATUS } from "./constants/nfdAgents/typingStatus";
export { INPUT } from "./constants/nfdAgents/input";

// Chat Components
export { default as ChatMessage } from "./components/chat/ChatMessage";
export { default as ChatMessages } from "./components/chat/ChatMessages";
export { default as ChatInput } from "./components/chat/ChatInput";
export { default as ChatHeader } from "./components/chat/ChatHeader";
export { default as WelcomeScreen } from "./components/chat/WelcomeScreen";

// Chat history (consumer must match useNfdAgentsWebSocket for same consumer)
export {
	archiveConversation,
	removeConversationFromArchive,
} from "./utils/nfdAgents/archiveConversation";
export { default as ChatHistoryList } from "./components/chat/ChatHistoryList";
export { default as ChatHistoryDropdown } from "./components/chat/ChatHistoryDropdown";

// UI Components
export { default as AILogo } from "./components/ui/AILogo";
export { default as BluBetaHeading } from "./components/ui/BluBetaHeading";
export { default as HeaderBar } from "./components/ui/HeaderBar";
export { default as ErrorAlert } from "./components/ui/ErrorAlert";
export { default as SuggestionButton } from "./components/ui/SuggestionButton";
export { default as ToolExecutionList } from "./components/ui/ToolExecutionList";
export { default as TypingIndicator } from "./components/ui/TypingIndicator";
