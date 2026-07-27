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

Every outbound chat frame carries a per-message `client_message_id`. A backend that
supports it replies with a `message_received` ACK and uses the id for de-duplication.

The client tracks **user** chat messages (the ones with a bubble + Retry affordance)
in a bounded in-memory **outbox** and recovers them two ways:

- **Deliver on connect** — `ws.onopen` flushes the outbox. Only entries that have
  **never been handed to a socket** are sent automatically, so a message typed before
  the first connect completed is delivered as soon as the socket opens.
- **Retry for anything ambiguous** — an entry that was already sent once and never
  confirmed is retired and surfaced for **Retry**, never auto-resent. Once a frame has
  left the client we cannot tell whether the backend received and processed it: the ACK
  is not emitted by every backend, and the server-side de-dupe that would make a resend
  idempotent is opt-in (`WEBSOCKET_ENABLE_DURABLE_DEDUPE`, off by default; the
  per-connection in-memory de-dupe is discarded when the socket closes). Since this
  agent mutates the user's site, a re-run turn means a duplicate action, so recovery is
  one Retry click rather than an automatic resend. Entries evicted on outbox overflow
  are surfaced the same way rather than dropped silently.
- **Response-silence watchdog** — if a sent message sees no inbound frame at all within
  the silence window, it is surfaced for **Retry**. A late reply un-flags it. Note this
  only covers total silence: once any frame arrives for the turn (even `typing_start`),
  a later stall just hides the typing indicator.

For backends that do not emit the ACK, any turn-completing event (assistant content
or error) implicitly confirms delivery of one message and clears the **oldest** pending
outbox entry (the backend processes sends in order). Clearing one-at-a-time — rather
than the whole outbox — keeps the other messages' tracking intact when several were
queued during an offline streak and flushed together on reconnect.

System messages and approval (`convId`) sends are **best-effort**: they're sent with a
`client_message_id` (for backend de-dupe) but are not tracked in the outbox, since they
have no bubble/Retry affordance.

## Tuning constants

All in `src/constants/nfdAgents/websocket.js`:

| Constant | Default | Purpose |
|----------|---------|---------|
| `MAX_OUTBOX_SIZE` | 50 | Outbox cap; oldest is evicted (and surfaced for Retry) first. |
| `TYPING_TIMEOUT` | 180000 | Response-silence window; bumped by every inbound event, so it only fires on genuine silence. |
