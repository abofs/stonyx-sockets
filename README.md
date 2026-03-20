# @stonyx/sockets

WebSocket server and client module for the [Stonyx framework](https://github.com/abofs/stonyx), providing plug-and-play handler discovery, built-in authentication enforcement, AES-256-GCM encryption, and automatic heartbeat keep-alive.

## Highlights

* **Handler auto-discovery:** Drop handler files into a directory and the framework registers them automatically.
* **Unified handler files:** A single file can define both `server()` and `client()` hooks.
* **Auth enforcement:** An `auth` handler is required. Unauthenticated requests are rejected by default.
* **Built-in heartbeat:** Keep-alive is managed by the framework — no handler needed.
* **Encryption by default:** AES-256-GCM with per-session keys, zero external dependencies.
* **Singleton pattern:** Matches the conventions of `@stonyx/rest-server` and `stonyx-orm`.

## Installation

```bash
npm install @stonyx/sockets
```

## Quick Start

### 1. Create handler files

```
socket-handlers/        # default directory (configurable)
  auth.js               # REQUIRED — must have a server() hook
  scan-games.js         # app-specific handlers
  validate-game.js
```

### 2. Write a handler

Each handler extends `Handler` and defines a `server()` method, a `client()` method, or both:

```javascript
// socket-handlers/auth.js
import { Handler } from '@stonyx/sockets';
import config from 'stonyx/config';

export default class AuthHandler extends Handler {
  static skipAuth = true;  // auth handler must work before authentication

  server(data, client) {
    if (data.authKey !== config.sockets.authKey) return client.close();

    this._serverRef.clientMap.set(client.id, client);
    return 'success';
  }

  client(response) {
    if (response !== 'success') this.client.promise.reject(response);
    this.client.promise.resolve();
  }
}
```

```javascript
// socket-handlers/scan-games.js — client-only handler
import { Handler } from '@stonyx/sockets';

export default class ScanGamesHandler extends Handler {
  client(validGames) {
    this.client.app.scanGames(validGames);
  }
}
```

### 3. Start the server / client

With Stonyx auto-initialization (recommended):

```bash
stonyx serve
```

Or manually:

```javascript
import { SocketServer, SocketClient } from '@stonyx/sockets';

// Server side
const server = new SocketServer();
await server.init();

// Client side
const client = new SocketClient();
await client.init();
```

## Handler Architecture

### How handlers are discovered

On `init()`, both `SocketServer` and `SocketClient` scan the handler directory using `forEachFileImport`. Each file's default export is inspected:

- Has a `server()` method → registered on `SocketServer`
- Has a `client()` method → registered on `SocketClient`
- Has both → registered on both sides

Handler filenames are converted from kebab-case to camelCase: `validate-game.js` → `validateGame`.

### Handler hooks

**Server hook:** `server(data, client)` — receives the request data and the client object. Return a value to send it back as a response.

**Client hook:** `client(response)` — receives the server's response. Inside the hook, `this.client` references the `SocketClient` instance.

### skipAuth

Set `static skipAuth = true` on a handler class to allow it to execute before the client is authenticated. The `auth` handler must always set this.

## Sending Messages

### Client → Server

```javascript
// From app code
client.send({ request: 'handlerName', data: { ... } });

// From within a client handler
this.client.send({ request: 'handlerName', data: { ... } });
```

### Server → Client

```javascript
// Auto-reply (return value from server() hook becomes the response)
server(data, client) {
  return 'success';  // sends { request, response: 'success' } back
}

// Send to a specific client by ID
server.sendTo(clientId, 'scanGames', gamesList);

// Broadcast to all authenticated clients
server.broadcast('announcement', { msg: 'shutdown in 5m' });

// Filter by metadata using clientMap directly
for (const [id, client] of server.clientMap) {
  if (client.meta?.role === 'worker') {
    client.send({ request: 'scanGames', data: games });
  }
}
```

### Wire Protocol

All messages are JSON:

```javascript
{ request: 'handlerName', data: { ... } }        // outgoing request
{ request: 'handlerName', response: { ... } }     // reply
```

## Client Object (Server-Side)

Each connected WebSocket client is augmented with:

| Property | Description |
|----------|-------------|
| `client.id` | Auto-assigned numeric ID (incrementing) |
| `client.ip` | Remote IP address |
| `client.meta` | App-defined metadata (set in your auth handler) |
| `client.__authenticated` | Framework-managed auth flag |
| `client.send(payload)` | Wrapped send that handles JSON + encryption |

## Built-in Mechanisms

### Heartbeat

The framework automatically manages keep-alive. After successful authentication, the client begins sending periodic `heartBeat` requests at the configured interval. The server responds automatically. No handler needed.

### Authentication Flow

1. Client connects and sends `{ request: 'auth', data: { authKey } }`
2. Server routes to the `auth` handler's `server()` method
3. If the handler returns a truthy value, `client.__authenticated` is set to `true`
4. Response is sent back; if encryption is enabled, a per-session key is included
5. Client's `auth` handler `client()` method processes the response
6. Heartbeat cycle begins automatically

**Auth enforcement:** Any message from an unauthenticated client is rejected and the connection is closed, unless the handler has `static skipAuth = true`.

**Missing auth handler:** `SocketServer.init()` throws if no `auth` handler with a `server()` method exists.

## Encryption

Enabled by default (`SOCKET_ENCRYPTION=true`). Uses Node.js native `crypto` — zero external dependencies.

- **Algorithm:** AES-256-GCM
- **Key derivation:** `crypto.scryptSync` from the `authKey` string
- **Handshake:** Auth request/response use the global key; server generates a per-session key for all subsequent messages
- **Wire format:** `iv (12 bytes) + auth tag (16 bytes) + ciphertext`

Disable with `SOCKET_ENCRYPTION=false`.

## Configuration

Configuration is read from `stonyx/config` under `sockets`:

| Option | Env Var | Default | Description |
|--------|---------|---------|-------------|
| `port` | `SOCKET_PORT` | `2667` | WebSocket server port |
| `address` | `SOCKET_ADDRESS` | `ws://localhost:2667` | Client connection address |
| `authKey` | `SOCKET_AUTH_KEY` | `'AUTH_KEY'` | Shared authentication key |
| `heartBeatInterval` | `SOCKET_HEARTBEAT_INTERVAL` | `30000` | Heartbeat interval in ms |
| `handlerDir` | `SOCKET_HANDLER_DIR` | `'./socket-handlers'` | Handler directory path |
| `encryption` | `SOCKET_ENCRYPTION` | `'true'` | Enable AES-256-GCM encryption |

## API Reference

### SocketServer

| Method | Description |
|--------|-------------|
| `new SocketServer()` | Singleton constructor |
| `async init()` | Discover handlers, validate auth, start WebSocket server |
| `sendTo(clientId, request, data)` | Send to one client by ID |
| `broadcast(request, data)` | Send to all authenticated clients |
| `clientMap` | `Map<id, client>` of connected clients |
| `close()` | Terminate all connections and stop the server |
| `reset()` | Close + clear all state (for testing) |

### SocketClient

| Method | Description |
|--------|-------------|
| `new SocketClient()` | Singleton constructor |
| `async init()` | Discover handlers, connect, authenticate |
| `send(payload)` | Send a message to the server |
| `close()` | Close the connection |
| `reconnect()` | Reconnect (max 5 retries) |
| `reset()` | Close + clear all state (for testing) |

### Handler

| Property / Method | Description |
|-------------------|-------------|
| `static skipAuth = false` | Set `true` to allow pre-auth access |
| `server(data, client)` | Server-side hook (optional) |
| `client(response)` | Client-side hook (optional) |
| `this._serverRef` | Reference to SocketServer (in server hooks) |
| `this.client` | Reference to SocketClient (in client hooks) |

## Example Project Structure

```
my-app/
├── config/
│   └── environment.js
├── socket-handlers/
│   ├── auth.js              # Required
│   ├── scan-games.js
│   └── validate-game.js
├── package.json
└── app.js
```

## License

Apache — do what you want, just keep attribution.
