# SME Template: Security Reviewer — stonyx-sockets

> **Inherits from:** `beatrix-shared/docs/framework/templates/agents/security-reviewer.md`
> Load the base template first, then layer this project-specific context on top.

## Project Context

**Repo:** `abofs/stonyx-sockets`
**Framework:** Stonyx module (`@stonyx/sockets`) — WebSocket server/client for the Stonyx framework
**Domain:** Bidirectional WebSocket communication with mandatory authentication, AES-256-GCM encryption, and auth enforcement on every message

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (compiled to ESM) |
| Runtime | Node.js |
| WebSocket | ws (v8) |
| Encryption | Node.js native `crypto` — AES-256-GCM |
| Key Derivation | `crypto.scryptSync` with salt `'stonyx-sockets'` |
| Session Keys | `crypto.randomBytes(32)` per authenticated client |

## Architecture Patterns

- **Defense-in-depth auth model:** Authentication is enforced at three levels: (1) the `auth` handler must exist or server init throws, (2) every incoming message is checked against `client.__authenticated`, (3) only handlers with `static skipAuth = true` bypass the check
- **Unauthenticated request rejection:** Any message from an unauthenticated client to a handler without `skipAuth` causes immediate `client.close()` — the connection is terminated, not just the request
- **AES-256-GCM encryption with per-session keys:** The global key (derived from `authKey` via scryptSync) is used only for the initial auth handshake; a fresh 32-byte random session key is generated for each client and used for all subsequent messages
- **Wire format integrity:** GCM provides both confidentiality and authentication — the auth tag (16 bytes) is verified on decrypt, preventing tampering
- **Key derivation:** `crypto.scryptSync(authKey, 'stonyx-sockets', 32)` — the salt is a hardcoded string `'stonyx-sockets'`
- **No TLS at WebSocket layer:** Encryption is at the application layer (AES-256-GCM over ws), not at the transport layer (wss) — transport security depends on the deployment environment
- **Client IP tracking:** `remoteAddress` is captured on connection and stored as `client.ip` — used for logging only, not for auth decisions

## Live Knowledge

- The `authKey` defaults to `'AUTH_KEY'` if not configured — this is a placeholder and must be overridden in production; there is no runtime check for weak keys
- The scryptSync salt is hardcoded as `'stonyx-sockets'` — all deployments using the same `authKey` will derive the same global key; the salt is not secret but adds domain separation
- `client.__authenticated` is a boolean flag set by the server after the auth handler returns a truthy value — there is no token expiration or session timeout mechanism; authentication lasts for the lifetime of the WebSocket connection
- The heartbeat mechanism is a keep-alive signal only — it does not re-authenticate or rotate session keys
- `prepareSend()` monkey-patches `client.send()` at connection time — any direct use of the underlying `ws.send()` would bypass encryption
- Error handling in `onMessage` catches parse/decrypt failures and closes the connection — this prevents oracle attacks but also means any malformed packet terminates the session
- The `sendToByMeta` method iterates all clients and checks `client.meta` — metadata is set by consumer code in the auth handler and is not validated by the framework
- `encryption` config defaults to `'true'` (string) — the comparison checks for both `'true'` and `true` (boolean), but any other truthy value (e.g., `'yes'`, `1`) will NOT enable encryption
