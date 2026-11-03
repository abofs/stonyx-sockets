# @stonyx/sockets Architecture

## Overview

`@stonyx/sockets` is a Stonyx framework module providing a WebSocket server and client built on
[`ws`](https://github.com/websockets/ws), with handler auto-discovery, mandatory auth enforcement,
AES-256-GCM encryption on by default, and a built-in heartbeat keep-alive. It contributes no WebSocket
framing/protocol logic of its own — `ws` owns the actual socket connection, upgrade handshake, and frame
parsing. This repo's responsibility is discovering handler files on disk, dispatching the small JSON wire
protocol described below, gating unauthenticated traffic, and encrypting/decrypting message payloads at
the application layer above `ws`.

Unlike `@stonyx/discord`, the `Sockets` entry point is a thin Stonyx auto-init hook that does **not**
itself start anything — consumers explicitly construct `new SocketServer()` / `new SocketClient()` and
call `.init()` when they want the socket layer running. The module follows the same singleton convention
as `@stonyx/discord` and `@stonyx/events`.

## Areas

### SocketServer / SocketClient and the singleton pattern

Both `SocketServer` (`src/server.ts`) and `SocketClient` (`src/client.ts`) follow the Stonyx singleton
convention (`if (SocketServer.instance) return SocketServer.instance;`), with `reset()` clearing the
static instance and internal state for tests. `SocketServer.init()` discovers handlers, requires an
`auth` handler to exist, configures encryption, starts a `ws` `WebSocketServer` on the configured port,
and wires per-connection send/message/close plumbing. `SocketClient.init()` discovers handlers, configures
encryption, and (outside `NODE_ENV=test`) connects immediately, resolving only once the auth handshake
completes; it also owns reconnect-with-backoff (`reconnectBaseDelay`/`reconnectMaxDelay`/
`maxReconnectAttempts`) when the connection drops. See [architecture.md](./architecture.md) for the full
initialization sequence and the server/client message-flow diagrams.

### Handler auto-discovery and the wire protocol

A handler is a class extending `Handler` (`src/handler.ts`) that defines a `server(data, client)` method,
a `client(response)` method, or both — one file can serve both sides of a connection. Both
`SocketServer` and `SocketClient` scan the configured `handlerDir` (default `./socket-handlers`) via
`forEachFileImport`, keying each discovered instance by its kebab-to-camelCase filename (`auth.js` stays
`auth`). Every message on the wire is a JSON object keyed by `request` (accepted as either camelCase or
kebab-case, normalized on dispatch), carrying `data` outbound or `response` on the way back. `heartBeat`
is a built-in request name consumers never define a handler for — the server auto-replies and the client
auto-schedules the next beat. See [handlers.md](./handlers.md) for the base class, the wire protocol
table, and the built-in handlers.

### Auth flow and skipAuth

`SocketServer.init()` throws if no handler named `auth` with a `server()` method is discovered — auth is
not optional. The auth handler runs before authentication by declaring `static skipAuth = true`; every
other handler defaults to `skipAuth = false` and is rejected (connection closed) when called by a client
that has not yet authenticated. When the `auth` handler's `server()` returns a truthy value, the
framework marks `client.__authenticated = true`, generates a per-session encryption key (if encryption is
on), and sends the response back — the handler itself is only responsible for validating credentials and
registering the client into `this._serverRef.clientMap` (that registry is populated by the consumer's
auth handler, not automatically). See [handlers.md](./handlers.md#auth-handler-required) for the full
auth handler contract and enforcement rules.

### AES-256-GCM encryption, handshake, and session keys

Encryption defaults on (`SOCKET_ENCRYPTION=true`) and uses Node's native `crypto`, with no external
crypto dependency. The configured `authKey` is run through `crypto.scryptSync` (fixed salt
`'stonyx-sockets'`) to derive a 32-byte global AES key. The auth request/response pair is encrypted with
that global key; on successful auth the server generates a random 32-byte per-session key and sends it
(base64-encoded) to the client, and every message after that, in both directions, is encrypted with the
session key instead. Encrypted frames are sent as `iv(12) + tag(16) + ciphertext` binary buffers. See
[encryption.md](./encryption.md) for the key-derivation code, the full handshake sequence, and security
notes (e.g. the `'AUTH_KEY'` default, the fixed salt, and the lack of session-key rotation/expiry).

### Heartbeat mechanism

Once a client authenticates, the client side starts sending `heartBeat` requests on
`config.sockets.heartBeatInterval` (default 30s); the server always replies `{ request: 'heartBeat',
response: true }` without any handler being discovered or invoked for it. The client schedules its next
heartbeat only after receiving that reply, and a response timeout closes a stale connection if none
arrives — this is a keep-alive only, not a liveness/session-renewal mechanism, and it starts automatically
after auth with no handler for consumers to write. See [handlers.md](./handlers.md#built-in-handlers) and
[architecture.md](./architecture.md#message-flow) for the exact message sequencing.

## Build, Run, Test

All commands below were run from the repo root on node v24.13.0 / pnpm 10.23.0 and verified to pass.

```bash
pnpm install --frozen-lockfile   # verified: succeeds, no lockfile changes
pnpm build                       # tsc — compiles src/ to dist/
pnpm build:test                  # tsc -p tsconfig.test.json — compiles test/ to dist-test/
pnpm test                        # build + build:test, then QUnit over test/**/*-test.ts — verified: 86 passed, 0 failed
```

`pnpm test` runs `NODE_ENV=test node --import tsx/esm --import ./test/setup.ts node_modules/qunit/bin/qunit.js 'test/**/*-test.ts'`.
The integration suite (`test/integration/socket-test.ts`) does start a real `ws` `WebSocketServer` and a
real `WebSocket` client — but both run in-process against `localhost`, confirmed locally
(`WebSocket server is listening on port 2667` / `Connecting to remote server: ws://localhost:2667`); no
live external socket server was reached. **Caveat found while verifying:** the test config
(`test/config/environment.ts`) does not override `port`, `address`, or `authKey`, so if `SOCKET_PORT`,
`SOCKET_ADDRESS`, or `SOCKET_AUTH_KEY` are already set in the shell, the client tests will target
whatever address those name instead of `localhost:2667` — testing.md already calls this out, and this
machine's shell profile did in fact have `SOCKET_ADDRESS`/`SOCKET_AUTH_KEY` set to non-local values; the
suite only ran fully offline after explicitly unsetting them. Unset `SOCKET_PORT`/`SOCKET_ADDRESS`/
`SOCKET_AUTH_KEY` before running `pnpm test` to guarantee a clean local run.

There is no standalone "run" command for this package by itself (see Delivery below). The nearest thing
to a canonical usage reference is [`test/sample/socket-handlers/`](https://github.com/abofs/stonyx-sockets/tree/dev/test/sample/socket-handlers)
(`auth.ts`, `echo.ts`) — the integration tests run against these samples directly, so iterating on them
and re-running `pnpm test` is the fastest way to exercise real handler/auth/encryption behavior without a
standalone socket server process.

## Delivery

`@stonyx/sockets` ships as an npm package (`@stonyx/sockets`) consumed as a library inside a Node.js
backend that runs Stonyx. It does not ship or run a standalone WebSocket server process of its own —
Stonyx's module loader instantiates the `Sockets` entry point at boot, but that entry point does not
auto-start networking; the consuming application must explicitly construct and `init()` a `SocketServer`
and/or `SocketClient` to actually open a port or a connection. There is no web, iOS, or Android surface
here; this package's only artifact is the compiled `dist/` published to npm (`files: ["dist", "config",
"LICENSE.md", "README.md"]` in `package.json`).

## Dependencies

- **`ws`** (`^8.18.1`, runtime dependency) — owns the actual WebSocket protocol implementation: the
  HTTP upgrade handshake, frame parsing/masking, ping/pong at the protocol level, and close-code
  semantics. `@stonyx/sockets` only owns handler discovery, the auth gate, and the AES-256-GCM
  encryption layered on top of whatever `ws` delivers as a message payload — it does not reimplement
  any part of raw WebSocket framing. Raw framing/protocol-level behavior is `ws`'s own responsibility
  and is tested there, not here: this repo's tests exercise its own handler/auth/encryption layer
  (unit tests stub `discoverHandlers`/use fake handlers rather than touching the wire; the integration
  suite does open real local `ws` sockets over `localhost`, but never against an external/live server).
- **`stonyx`** (runtime dependency, pinned to `0.2.3-beta.107` in this checkout) — the Stonyx framework
  core: config loading/merging, logging (`log.socket()`), the module auto-init lifecycle
  (`stonyx-async`/`stonyx-module` keywords), and `test-helpers`' `setupIntegrationTests` used by this
  repo's own integration tests. `stonyx`'s own `docs/index.md` was not found in this checkout (only
  `stonyx-discord` and `stonyx-sockets` were in scope for this onboarding pass); consult the `stonyx`
  package's README for its own architecture until its docs exist.
