# SME Template: Validation Loop Team — stonyx-sockets

> **Inherits from:** `beatrix-shared/docs/framework/templates/agents/validation-loop-team.md`
> Load the base template first, then layer this project-specific context on top.

## Project Context

**Repo:** `abofs/stonyx-sockets`
**Framework:** Stonyx module (`@stonyx/sockets`) — WebSocket server/client for the Stonyx framework
**Domain:** Bidirectional WebSocket communication with mandatory authentication, AES-256-GCM encryption, heartbeat keep-alive, and automatic reconnection with exponential backoff

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (compiled to ESM) |
| Runtime | Node.js |
| WebSocket | ws (v8) |
| Encryption | Node.js native `crypto` — AES-256-GCM |
| Test | QUnit + Sinon |
| Build | tsc (src → dist, test → dist-test) |

## Architecture Patterns

- **Auth handler is a hard requirement:** `validateAuthHandler()` throws if `this.handlers.auth` is missing — validation must confirm this gate cannot be bypassed by naming a handler something else
- **Auth enforcement on every message path:** The `onMessage` handler checks `client.__authenticated` and `handler.constructor.skipAuth` — validation must confirm there is no code path where an unauthenticated client can invoke a non-skipAuth handler
- **Encryption key lifecycle:** Global key → auth handshake → session key swap — validation must confirm that after session key is set, the global key is never used for that client again
- **Heartbeat is handled before handler lookup:** The `heartBeat` request is checked before the handler dispatch — validation must confirm it cannot be spoofed to bypass auth (it checks `client.__authenticated` first)
- **Reconnection backoff correctness:** Exponential delay = `baseDelay * 2^(attempt-1)` capped at `maxDelay` + jitter — validation should verify the math at boundary values (attempt 1, max attempts, overflow)
- **Connection cleanup on disconnect:** `handleDisconnect` removes the client from `clientMap` and fires `onClientDisconnect` — validation must confirm no stale references remain

## Live Knowledge

- The `_intentionalClose` flag on `SocketClient` distinguishes graceful disconnects from unexpected ones — only unexpected disconnects trigger reconnection; validation should test both paths
- `prepareSend()` replaces `ws.send` with a closure that captures the server reference — if the server is reset while a client reference is held, the closure will still try to encrypt with a potentially stale key
- The `sendToByMeta` method returns `true` if a matching client was found, `false` otherwise — consumers may rely on this return value to detect delivery failures
- Server `onMessage` catches all errors and closes the connection — this means a single corrupt byte in an encrypted payload terminates the session; there is no retry mechanism at the protocol level
- The `encryption` config check uses strict equality against `'true'` and `true` — any other truthy value silently disables encryption, which is a potential misconfiguration vector
- `clientMap` is populated by consumer code in the auth handler (not by the framework) — the framework only manages `__authenticated` and `__sessionKey`; if the auth handler forgets to add to `clientMap`, `sendTo` and `broadcast` will not reach that client
