# API Reference

## Exports

```javascript
// Main entry (src/main.ts)
import { SocketServer, SocketClient, Handler } from '@stonyx/sockets';

// Sub-path exports
import SocketServer from '@stonyx/sockets/server';
import SocketClient from '@stonyx/sockets/client';
import Handler from '@stonyx/sockets/handler';
```

The default export from `@stonyx/sockets` is the `Sockets` class (used by Stonyx for auto-init). Consumer code should use the named exports.

---

## SocketServer

**File:** `src/server.ts`

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `clientMap` | `Map<number, client>` | Connected clients keyed by auto-assigned ID |
| `handlers` | `Object<string, Handler>` | Discovered server handlers keyed by name |
| `wss` | `WebSocketServer \| null` | The underlying `ws` WebSocketServer instance |
| `encryptionEnabled` | `boolean` | Whether AES-256-GCM encryption is active |
| `globalKey` | `Buffer` | Derived encryption key from authKey (if encryption enabled) |
| `onClientDisconnect` | `(client, code, reason) => void \| null` | Called after a client is removed from `clientMap` on disconnect |

### Static

| Property | Type | Description |
|----------|------|-------------|
| `SocketServer.instance` | `SocketServer \| null` | Singleton instance |

### Methods

#### `constructor()`

Returns the existing singleton or creates a new one. Does NOT start the server.

#### `async init()`

Full initialization sequence:
1. Discovers handlers from `config.sockets.handlerDir`
2. Validates that an `auth` handler exists
3. Configures encryption if enabled
4. Starts `WebSocketServer` on `config.sockets.port`
5. Wires connection/message/close events

#### `sendTo(clientId, request, data)`

Send a message to a specific client by numeric ID.

- `clientId` — number, the client's auto-assigned ID
- `request` — string, the handler name
- `data` — any serializable value

Does nothing if the client doesn't exist.

#### `sendToByMeta(key, value, request, data)`

Send to the first authenticated client in `clientMap` whose `meta[key] === value`. Returns `true` if one matched, `false` otherwise. `meta` is set by the consumer's `auth` handler.

#### `broadcast(request, data)`

Send a message to all authenticated clients in `clientMap`.

- `request` — string, the handler name
- `data` — any serializable value

#### `close()`

Terminates all connected clients and closes the WebSocket server.

#### `reset()`

Calls `close()`, clears `clientMap`, clears `handlers`, resets the client ID counter, sets `SocketServer.instance = null`. Used in tests.

### Internal Methods

#### `async discoverHandlers()`

Scans handler directory. For each file: instantiates the class, checks for `server()` method, registers it in `this.handlers`.

#### `validateAuthHandler()`

Throws `Error` if `this.handlers.auth` doesn't exist.

#### `onMessage(payload, client)`

Main message dispatcher. Decrypts (if enabled), parses JSON, routes to handler or built-in heartbeat, enforces auth gate.

#### `prepareSend(client)`

Replaces `client.send()` with a wrapper that JSON-stringifies and encrypts (if enabled).

#### `handleDisconnect(client)`

Removes client from `clientMap`, logs disconnection.

---

## SocketClient

**File:** `src/client.ts`

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `handlers` | `Object<string, Handler>` | Discovered client handlers keyed by name |
| `socket` | `WebSocket \| null` | The underlying `ws` WebSocket instance |
| `reconnectCount` | `number` | Current reconnection attempt count |
| `promise` | `{ resolve, reject }` | Connection promise callbacks |
| `encryptionEnabled` | `boolean` | Whether AES-256-GCM encryption is active |
| `globalKey` | `Buffer` | Derived encryption key from authKey (if encryption enabled) |
| `sessionKey` | `Buffer \| null` | Per-session key received from server after auth |
| `onDisconnect` | `(code, reason) => void \| null` | Called when the socket closes, before any reconnect. Not called after `close()`, which removes the listeners first |
| `onReconnecting` | `(attempt, delay) => void \| null` | Called before each reconnect attempt |
| `onReconnected` | `() => void \| null` | Called after a reconnect authenticates |
| `onReconnectFailed` | `() => void \| null` | Called once `maxReconnectAttempts` is exceeded |

### Static

| Property | Type | Description |
|----------|------|-------------|
| `SocketClient.instance` | `SocketClient \| null` | Singleton instance |

### Methods

#### `constructor()`

Returns the existing singleton or creates a new one. Does NOT connect.

#### `async init()`

Full initialization:
1. Discovers handlers from `config.sockets.handlerDir`
2. Configures encryption if enabled
3. Calls `connect()`

Returns the Promise from `connect()`.

#### `send(payload, useGlobalKey = false)`

Send a message to the server.

- `payload` — object with `request` and optionally `data` fields
- `useGlobalKey` — boolean, use the global key instead of session key (internal, for auth)

#### `close()`

Sets the intentional-close flag, clears heartbeat timers, then forcefully tears down the socket: removes all listeners, attaches a no-op error handler (to prevent uncaught errors during teardown), calls `terminate()`, and nulls the reference.

#### `reconnect()`

Increments `reconnectCount`, waits `getReconnectDelay()`, then calls `connect()`. Once `reconnectCount` exceeds `config.sockets.maxReconnectAttempts` (default `Infinity`) it calls `onReconnectFailed` and stops. A successful connection resets the count. Called from `onClose()` unless the close was intentional (`close()` sets `_intentionalClose`).

#### `getReconnectDelay()`

`min(reconnectBaseDelay * 2^(reconnectCount - 1), reconnectMaxDelay)` plus 0-999 ms of random jitter. Defaults: base 1000 ms, max 60000 ms.

#### `reset()`

Calls `close()`, clears handlers, clears session key, resets reconnect counter, sets `SocketClient.instance = null`. Used in tests.

### Internal Methods

#### `async discoverHandlers()`

Scans handler directory. For each file: instantiates the class, checks for `client()` method, registers it.

#### `async connect()`

If an existing socket is present, cleans it up first (removes listeners, terminates, nulls). Then creates a new WebSocket, wires message/close/error/open events, and sends auth on open. Returns Promise that resolves when auth handler resolves it.

#### `onMessage({ data: payload })`

Decrypts, parses, handles built-in auth/heartbeat, routes to handler.

#### `heartBeat()`

Sends `{ request: 'heartBeat' }` to the server.

#### `nextHeartBeat()`

Schedules `heartBeat()` via `setTimeout` at `config.sockets.heartBeatInterval`.

#### `onClose()`

Logs disconnection, clears both heartbeat timers, calls `onDisconnect`, and calls `reconnect()` unless the close was intentional.

---

## Handler

**File:** `src/handler.ts`

### Static Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `skipAuth` | `boolean` | `false` | Set `true` to allow pre-auth access (server side only) |

### Instance Methods (defined by subclasses)

#### `server(data, client)`

Server-side hook. Called when a message with the matching handler name arrives.

- `data` — the parsed `data` field from the incoming message
- `client` — the WebSocket client object with `.id`, `.ip`, `.meta`, `.send()`, `.__authenticated`
- **Return value:** sent back as the `response` field. Return `undefined`/`null` to send nothing.

#### `client(response)`

Client-side hook. Called when a response with the matching handler name arrives from the server.

- `response` — the parsed `response` field from the message
- **Context:** `this.client` references the `SocketClient` instance

### Instance Properties (set by framework)

| Property | Set by | Description |
|----------|--------|-------------|
| `_serverRef` | `SocketServer.discoverHandlers()` | Reference to the SocketServer instance |
| `_clientRef` | `SocketClient.discoverHandlers()` | Reference to the SocketClient instance |

---

## Client Object (Server-Side)

The raw WebSocket client is augmented by the framework:

| Property | Type | Set by | Description |
|----------|------|--------|-------------|
| `id` | `number` | Framework (on connect) | Auto-incrementing numeric ID |
| `ip` | `string` | Framework (on connect) | Remote IP address |
| `__authenticated` | `boolean` | Framework (on auth) | Auth state |
| `__sessionKey` | `Buffer` | Framework (on auth, if encryption) | Per-session encryption key |
| `meta` | `any` | Consumer (in auth handler) | App-defined metadata |
| `send(payload)` | `function` | Framework (`prepareSend`) | Sends JSON, auto-encrypts if enabled |

---

## Encryption Functions

**File:** `src/encryption.ts`

| Function | Signature | Description |
|----------|-----------|-------------|
| `encrypt` | `(data: string, key: Buffer) → Buffer` | AES-256-GCM encrypt, returns `iv + tag + ciphertext` |
| `decrypt` | `(buffer: Buffer, key: Buffer) → string` | AES-256-GCM decrypt, returns UTF-8 string |
| `generateSessionKey` | `() → Buffer` | `crypto.randomBytes(32)` |
| `deriveKey` | `(authKey: string) → Buffer` | `crypto.scryptSync(authKey, 'stonyx-sockets', 32)` |
