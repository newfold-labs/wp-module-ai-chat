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
replies with a `message_received` ACK (sent on receipt, before processing) and uses
the id for de-duplication, so resends are idempotent.

The client keeps unacknowledged messages in a bounded in-memory **outbox** and
recovers them three ways:

- **Resend on reconnect** — `ws.onopen` flushes the outbox, reusing the same id.
- **ACK-timeout resend** — while connected, a self-stopping sweep resends a message
  whose ACK hasn't arrived within `ACK_TIMEOUT_MS`. The full resend loop is gated on
  having seen at least one ACK this session (feature detection), so a backend that
  doesn't emit ACKs is never false-failed; before the first ACK, a single bootstrap
  resend covers a lost first frame.
- **Response-silence watchdog** — if a delivered message produces no response within
  the (activity-bumped) silence window, the message is surfaced for **Retry**. A late
  reply un-flags it.

Undeliverable messages are marked retryable in the UI (the existing per-message
Retry affordance) rather than being dropped silently — including on outbox eviction
and TTL/budget retirement.

For backends that do not emit the ACK, any turn-completing event (assistant content
or error) implicitly confirms delivery and clears the outbox.

## Tuning constants

All in `src/constants/nfdAgents/websocket.js`:

| Constant | Default | Purpose |
|----------|---------|---------|
| `MAX_ACK_RESEND_ATTEMPTS` | 3 | Total sends per message (initial + resends) before it's retired as undeliverable. Shared by the reconnect flush and the ack-timeout sweep. |
| `ACK_RESEND_TTL_MS` | 60000 | How long an already-sent message stays eligible for resend. |
| `MAX_OUTBOX_SIZE` | 50 | Outbox cap; oldest is evicted (and marked retryable) first. |
| `ACK_TIMEOUT_MS` | 5000 | Wait for the delivery ACK before resending. Short because the backend ACKs receipt immediately. |
| `ACK_SWEEP_INTERVAL_MS` | 2000 | Sweep cadence while a message is outstanding (runs only when connected with pending work). |
| `TYPING_TIMEOUT` | 180000 | Response-silence window; bumped by every inbound event, so it only fires on genuine silence. |
