# SME Template: Architect — stonyx-sockets

> **Inherits from:** `beatrix-shared/docs/framework/templates/agents/architect.md`
> Load the base template first, then layer this project-specific context on top.

## Project Context

**Repo:** `abofs/stonyx-sockets`
**Framework:** Stonyx module (`@stonyx/sockets`) — WebSocket server/client for the Stonyx framework
**Domain:** Bidirectional WebSocket communication with handler auto-discovery, mandatory authentication, AES-256-GCM encryption, heartbeat keep-alive, and automatic reconnection with exponential backoff

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (compiled to ESM) |
| Runtime | Node.js |
| WebSocket | ws (v8) |
| Encryption | Node.js native `crypto` — AES-256-GCM, scryptSync key derivation |
| Framework | Stonyx (runtime dependency) — config, logging, file discovery |
| Build | tsc with dual tsconfig (src + test) |
| Test | QUnit + Sinon |
| Package Manager | pnpm |

## Architecture Patterns

- **Dual singleton:** `SocketServer` and `SocketClient` each have independent singleton instances — a process can run server, client, or both
- **Unified handler files:** A single handler file can define both `server(data, client)` and `client(response)` methods — discovery registers server-side hooks on `SocketServer` and client-side hooks on `SocketClient` independently
- **Handler auto-discovery via `forEachFileImport`:** Kebab-case filenames in the handler directory are converted to camelCase handler names (e.g., `validate-game.js` → `validateGame`)
- **Mandatory auth handler:** `SocketServer.init()` throws if no handler named `auth` with a `server()` method exists — this is a hard requirement, not a convention
- **Auth enforcement on every message:** Unauthenticated clients can only invoke handlers with `static skipAuth = true` — all other requests are rejected and the connection is closed
- **Per-session encryption keys:** During auth handshake, the server generates a `crypto.randomBytes(32)` session key and sends it (encrypted with the global key) to the client; all subsequent messages use the session key
- **Wire protocol:** All messages are JSON: `{ request, data }` for outgoing, `{ request, response }` for replies — the `request` field maps directly to the handler name
- **Built-in heartbeat:** After authentication, the client sends periodic `heartBeat` requests at the configured interval; the server responds automatically without a handler
- **Exponential backoff reconnection:** Client reconnects with `baseDelay * 2^(attempt-1)` capped at `maxDelay`, plus random jitter (0-1000ms), up to `maxReconnectAttempts`
- **Server-side client management:** Connected clients are tracked in `clientMap` (Map<id, client>) with `sendTo`, `sendToByMeta`, and `broadcast` methods

## Live Knowledge

- The `stonyx-async` keyword means Stonyx awaits `init()` during startup — both server and client are fully connected before the app is considered ready
- `client.send()` is monkey-patched in `prepareSend()` to transparently handle encryption — callers never deal with raw `ws.send()`
- The `onClientDisconnect` callback on `SocketServer` and the `onDisconnect`/`onReconnecting`/`onReconnected`/`onReconnectFailed` callbacks on `SocketClient` are pluggable hooks for consumer apps
- The `authData` config property allows consumer apps to send additional metadata during the auth handshake alongside the `authKey`
- `clientId` is a module-level incrementing counter — it resets only when `SocketServer.reset()` is called, which also clears the singleton
- Encryption wire format is `iv (12 bytes) + auth tag (16 bytes) + ciphertext` — a single `Buffer.concat` on both encrypt and decrypt paths
