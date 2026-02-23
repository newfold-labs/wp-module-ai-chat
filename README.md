# WP Module AI Chat

Reusable AI chat core for WordPress. Provides NFD Agents WebSocket chat, shared UI components, hooks, and utilities for Help Center, Editor Chat, and other Newfold AI interfaces.

## Overview

- **NFD Agents chat**: WebSocket-based chat backed by the Newfold agents gateway (config endpoint, session handling, typing indicators, tool execution display).
- **Shared UI**: Chat message list, input, header, welcome screen, history list/dropdown, typing indicator, tool execution list.
- **Optional backends**: MCP (WordPress MCP client) and OpenAI client exports for consumers that need them.
- **PHP**: REST API config endpoint (`nfd-agents/chat/v1/config`) that returns gateway URL, auth token, and consumer-based capabilities.

The module is consumer-agnostic: the host (e.g. Bluehost plugin) mounts the UI and passes a `consumer` (e.g. `help-center`, `editor-chat`) so the backend can enforce capabilities and branding.

## Installation

- **PHP**: Installed as a Composer dependency in a Newfold plugin (e.g. `wp-plugin-bluehost`). The module registers with the Newfold container via `bootstrap.php` and exposes the REST API.
- **Frontend**: Consuming plugins/apps depend on `@newfold-labs/wp-module-ai-chat` and use the built entry point and exports (see **Usage**).

## Usage

1. **Config**: Ensure the gateway URL is set (see **Configuration** below). The frontend calls the REST config endpoint with a `consumer` query parameter.
2. **Mount the chat**: Use the exported components (e.g. `ChatMessages`, `ChatInput`, `ChatHeader`, `WelcomeScreen`, `TypingIndicator`, `ToolExecutionList`) and hook `useNfdAgentsWebSocket` with the same `consumer` and config endpoint (full URL or relative path like `nfd-agents/chat/v1/config`).
3. **History**: Chat history is keyed by consumer; use `archiveConversation`, `removeConversationFromArchive`, `ChatHistoryList`, and `ChatHistoryDropdown` with the same consumer for consistency.

**Example (conceptual):**

```js
import {
  useNfdAgentsWebSocket,
  ChatMessages,
  ChatInput,
  ChatHeader,
  WelcomeScreen,
  TypingIndicator,
  ToolExecutionList,
} from "@newfold-labs/wp-module-ai-chat";

// In your app: fetch config (e.g. from REST), then:
// useNfdAgentsWebSocket({ configEndpoint, consumer: "help-center", ... });
// Render ChatMessages, ChatInput, TypingIndicator, etc.
```

REST API base URLs are built with `rest_route` (not `/wp-json/`) so the config request works regardless of permalink settings. The module provides `buildRestApiUrl` and `convertWpJsonToRestRoute` in `utils/restApi.js` (used internally by the config fetcher).

## Configuration

### NFD Agents Gateway URL

The chat connects to the NFD Agents backend over WebSocket. The gateway URL must be set; it is not set by default.

- **`NFD_AGENTS_CHAT_GATEWAY_URL`** (in `wp-config.php`): Base URL for the agents gateway, e.g. `https://agents.example.com` or `http://localhost:8080` for local development.
- **`nfd_agents_chat_gateway_url` filter**: The host or another plugin can provide the URL:
  ```php
  add_filter( 'nfd_agents_chat_gateway_url', fn() => 'https://agents.example.com' );
  ```

If neither is set, the config API returns an error and the chat will not connect.

### Debug token (local / bypass Hiive)

For local development or debugging without Hiive, you can supply a JWT instead of fetching it from Hiive.

- **`NFD_AGENTS_CHAT_DEBUG_TOKEN`** (in `wp-config.php` only): If defined and non-empty, it is used as the `huapi_token` instead of calling Hiive. Set only in `wp-config.php` or a local, uncommitted config; never commit the value.

  ```php
  define( 'NFD_AGENTS_CHAT_DEBUG_TOKEN', 'eyJ...' );
  ```

## Development

```bash
# Install JS dependencies
npm install

# Build (output is consumed by the host plugin’s build or enqueue)
npm run build

# Lint
npm run lint
```

PHP linting uses the project’s PHPCS config: `composer run lint` (and `composer run clean` to fix).

## Exports (JavaScript)

The package entry point is `src/index.js`. It exports:

- **Hooks**: `useAIChat`, `useNfdAgentsWebSocket`, `CHAT_STATUS`
- **Components**: Chat (e.g. `ChatMessage`, `ChatMessages`, `ChatInput`, `ChatHeader`, `WelcomeScreen`, `ChatHistoryList`, `ChatHistoryDropdown`), UI (`AILogo`, `BluBetaHeading`, `HeaderBar`, `ErrorAlert`, `SuggestionButton`, `ToolExecutionList`, `TypingIndicator`)
- **Utils**: `simpleHash`, `generateSessionId`, `debounce`; `containsMarkdown`, `parseMarkdown`; `sanitizeHtml`, `containsHtml`; NFD Agents URL helpers (`convertToWebSocketUrl`, `normalizeUrl`, `buildWebSocketUrl`, `isLocalhost`); `isInitialGreeting`; archive helpers (`archiveConversation`, `removeConversationFromArchive`)
- **Constants**: `NFD_AGENTS_WEBSOCKET`, `getChatHistoryStorageKeys`, `TYPING_STATUS`, `INPUT`
- **Services** (optional): `WordPressMCPClient`, `createMCPClient`, `mcpClient`, `MCPError`; `CloudflareOpenAIClient`, `createOpenAIClient`, `openaiClient`, `OpenAIError`

Subpath exports are available for `./services/*`, `./components/*`, `./hooks/*`, and `./utils/*` as defined in `package.json`.

## License

GPL-2.0-or-later
