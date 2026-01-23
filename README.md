# WP Module AI Chat

A WordPress module providing AI chat capabilities.

## Installation

This module is installed via Composer as part of the Newfold plugin ecosystem.

## Usage

The module is automatically loaded when installed as a Composer dependency.

## Configuration

### NFD Agents Gateway URL

The AI chat connects to an NFD Agents backend over WebSocket. The gateway URL must be configured; it is not set by default.

- **`NFD_AGENTS_CHAT_GATEWAY_URL`** (in `wp-config.php`): Set the base URL for the agents gateway, e.g. `https://agents.example.com` for production or `http://localhost:8080` for local development.
- **`nfd_agents_chat_gateway_url` filter**: The host or another plugin can provide the URL:  
  `add_filter( 'nfd_agents_chat_gateway_url', fn() => 'https://agents.example.com' );`

If neither is set, the config API returns an error and the chat will not connect.

### Debug token (local / bypass Hiive)

When developing locally or debugging without Hiive, you can supply a JWT directly instead of fetching it from the Hiive API.

- **`NFD_AGENTS_CHAT_DEBUG_TOKEN`** (in `wp-config.php` only): If defined and non‑empty, it is used as the `huapi_token` instead of calling Hiive. Set this only in `wp-config.php` (or a local, uncommitted config); never commit the value.

  ```php
  define( 'NFD_AGENTS_CHAT_DEBUG_TOKEN', 'eyJ...' );
  ```
