# @stonyx/sockets — Agent Documentation Index

Comprehensive reference for AI agents working on the `@stonyx/sockets` package. Start here, then drill into specific docs as needed.

## Quick Orientation

`@stonyx/sockets` is a Stonyx framework module providing WebSocket server/client with handler auto-discovery, auth enforcement, AES-256-GCM encryption, and built-in heartbeat. It follows the same conventions as `@stonyx/rest-server` and `stonyx-orm`.

## Documentation

- [architecture.md](./architecture.md) — Module structure, singleton pattern, Stonyx integration, handler discovery lifecycle
- [handlers.md](./handlers.md) — Handler class API, server/client hooks, auth flow, skipAuth, wire protocol
- [encryption.md](./encryption.md) — AES-256-GCM encryption, key derivation, handshake flow, session keys
- [configuration.md](./configuration.md) — All config options, env vars, defaults, how config loads via Stonyx
- [testing.md](./testing.md) — Test structure, running tests, sample handlers, writing new tests
- [api-reference.md](./api-reference.md) — Complete method/property reference for SocketServer, SocketClient, Handler

## Key Files

| File | Purpose |
|------|---------|
| `src/main.js` | Entry point — `Sockets` default class (Stonyx auto-init) + barrel exports |
| `src/server.js` | `SocketServer` — singleton, handler discovery, auth gate, message dispatch |
| `src/client.js` | `SocketClient` — singleton, handler discovery, connect/auth/heartbeat |
| `src/handler.js` | `Handler` base class (3 lines — just `skipAuth` flag) |
| `src/encryption.js` | AES-256-GCM encrypt/decrypt, key derivation, session key generation |
| `config/environment.js` | Default config with env var overrides |

## Conventions

- **Singleton pattern:** `if (Class.instance) return Class.instance;` in constructor
- **Stonyx module keywords:** `stonyx-async` + `stonyx-module` in package.json
- **Config namespace:** `config.sockets` (camelCase of package name minus `@stonyx/`)
- **Logging:** `log.socket()` via `logColor: 'white'` + `logMethod: 'socket'` in config
- **Handler discovery:** `forEachFileImport` from `@stonyx/utils/file`, kebab-to-camelCase naming
- **Test runner:** `stonyx test` (not plain `qunit`) — bootstraps Stonyx before running tests
