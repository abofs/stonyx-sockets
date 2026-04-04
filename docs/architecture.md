# Architecture

## Module Structure

```
stonyx-sockets/
├── config/environment.js      # Default config, env var overrides
├── src/
│   ├── main.js                # Sockets class (Stonyx entry) + barrel exports
│   ├── server.js              # SocketServer singleton
│   ├── client.js              # SocketClient singleton
│   ├── handler.js             # Base Handler class
│   └── encryption.js          # AES-256-GCM utilities
└── test/
    ├── config/environment.js  # Test config overrides
    ├── sample/socket-handlers # Auth + echo sample handlers
    ├── unit/                  # Handler, encryption, server, client unit tests
    └── integration/           # Full server+client round-trip tests
```

## Stonyx Integration

### Auto-Initialization

The package declares `stonyx-async` + `stonyx-module` keywords. When Stonyx starts:

1. Reads `config/environment.js` and merges into `config.sockets`
2. Registers `log.socket()` via `logColor: 'white'` + `logMethod: 'socket'`
3. Imports `src/main.js`, instantiates the default `Sockets` class, calls `.init()`

The `Sockets` default export is a thin entry point — it does NOT auto-start the WebSocket server. The actual server/client initialization is deferred to when the consumer explicitly creates `new SocketServer()` or `new SocketClient()` and calls `.init()`.

### Standalone Mode (Testing)

When running `stonyx test` from within the package directory, Stonyx detects the `stonyx-` prefix in the path and transforms the config:

```javascript
// config/environment.js exports { port, address, authKey, ... }
// Stonyx wraps it as: { sockets: { port, address, authKey, ... } }
```

Test overrides from `test/config/environment.js` are merged on top.

## Singleton Pattern

Both `SocketServer` and `SocketClient` use the Stonyx singleton convention:

```javascript
constructor() {
  if (SocketServer.instance) return SocketServer.instance;
  SocketServer.instance = this;
}
```

`reset()` sets the static instance back to `null` (used in tests).

## Initialization Lifecycle

### SocketServer.init()

1. **discoverHandlers()** — scans `config.sockets.handlerDir` via `forEachFileImport`
   - For each file: instantiates the class, checks for `server()` method
   - Stores instance in `this.handlers[name]` (kebab-to-camelCase)
   - Sets `instance._serverRef = this` for access to the server within handlers
2. **validateAuthHandler()** — throws if `this.handlers.auth` doesn't exist
3. **Configure encryption** — if enabled, derives global key from `authKey`
4. **Start WebSocketServer** on configured port
5. **Wire connection events** — on each connection: assign ID, set IP, wrap send, bind message/close listeners

### SocketClient.init()

1. **discoverHandlers()** — same as server, but checks for `client()` method
   - Sets `instance._clientRef = this` for access to the client within handlers
2. **Configure encryption** — if enabled, derives global key from `authKey`
3. **connect()** — returns Promise that resolves after auth completes
   - Creates WebSocket to `config.sockets.address`
   - On open: sends auth request
   - On auth response: resolves the promise, starts heartbeat

## Message Flow

### Server onMessage

```
payload received
  → decrypt (if encryption enabled, using session key or global key for auth)
  → JSON.parse
  → heartBeat? → respond with true, return
  → handler lookup by request name
  → auth gate: if not auth handler, not skipAuth, not authenticated → reject + close
  → call handler.server(data, client)
  → if return value is truthy:
      → if auth request: set __authenticated, generate session key, respond
      → else: send { request, response } back to client
```

### Client onMessage

```
payload received
  → decrypt (if encryption enabled, using session key or global key)
  → JSON.parse
  → auth response? → store session key, start heartbeat
  → heartBeat response? → schedule next heartbeat, return
  → handler lookup by request name
  → call handler.client(response) with this.client bound
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `ws` | WebSocket server (`WebSocketServer`) and client (`WebSocket`) |
| `stonyx` | Framework core — config, logging, module lifecycle |
| `@stonyx/utils` (dev) | `forEachFileImport` for handler auto-discovery |
| `qunit` (dev) | Test framework |
| `sinon` (dev) | Stubs and spies for unit tests |
