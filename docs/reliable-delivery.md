---
name: wp-module-ai-chat
title: Reliable delivery & config
description: client_message_id/ACK delivery model, tuning constants, and the bypass_jwt_expiry config field.
updated: 2026-06-18
---

# Reliable delivery & config

## Config REST response

`GET` of the chat config endpoint returns the fields the client needs to open the
WebSocket. Relevant fields:

| Field | Meaning |
|-------|---------|
| `gateway_url` | WebSocket gateway URL. |
| `jarvis_jwt` | Token used to authenticate the WebSocket. |
| `site_url`, `site_id`, `brand_id`, `agent_type` | Routing / scoping metadata. |
| `bypass_jwt_expiry` | **Local-dev only.** `true` when the site is running on the `NFD_AI_CHAT_JARVIS_DEBUG_TOKEN` wp-config constant (see `JarvisJWTHelper::is_using_debug_token()`). The client then skips all client-side JWT-expiry handling (pre-connect refetch, proactive refresh, on-close expiry refetch) so a hand-crafted local token with no/expired `exp` works as-is. It is `false` in production (the constant is absent) and is **not** an auth control — the gateway still validates the token server-side. |

## Reliable delivery (client_message_id + ACK)

Every outbound chat frame carries a per-message `client_message_id`. The backend
replies with a `message_received` ACK and uses the id for de-duplication, so resends
are idempotent.

The client tracks **user** chat messages (the ones with a bubble + Retry affordance)
in a bounded in-memory **outbox** and recovers them two ways:

- **Resend on reconnect** — `ws.onopen` flushes the outbox, reusing the same id. A
  message queued while offline is delivered on the next connect; one that was sent but
  never acknowledged before the socket dropped is resent. Entries that exhaust the
  resend budget or age past the TTL (and any evicted on overflow) are surfaced for
  **Retry** rather than dropped silently.
- **Response-silence watchdog** — if a delivered message produces no response within
  the (activity-bumped) silence window, the message is surfaced for **Retry**. A late
  reply un-flags it. This also covers the "frame lost while the socket stayed open"
  case (recovered via Retry rather than an automatic resend).

For backends that do not emit the ACK, any turn-completing event (assistant content
or error) implicitly confirms delivery and clears the outbox. This clear assumes a
single in-flight user turn at a time, which the UI enforces by disabling the composer
while a response is pending.

System messages and approval (`convId`) sends are **best-effort**: they're sent with a
`client_message_id` (for backend de-dupe) but are not tracked in the outbox, since they
have no bubble/Retry affordance.

## Tuning constants

All in `src/constants/nfdAgents/websocket.js`:

| Constant | Default | Purpose |
|----------|---------|---------|
| `MAX_ACK_RESEND_ATTEMPTS` | 3 | Total sends per message (initial + resends) before it's retired as undeliverable (surfaced for Retry). |
| `ACK_RESEND_TTL_MS` | 60000 | How long an already-sent message stays eligible for resend on reconnect. |
| `MAX_OUTBOX_SIZE` | 50 | Outbox cap; oldest is evicted (and surfaced for Retry) first. |
| `TYPING_TIMEOUT` | 180000 | Response-silence window; bumped by every inbound event, so it only fires on genuine silence. |
