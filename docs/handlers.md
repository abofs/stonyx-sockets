# Handlers

## Overview

Handlers are the primary extension point for consumers. Each handler is a class that extends `Handler` and defines a `server()` method, a `client()` method, or both. Handler files live in the handler directory (default: `./socket-handlers`).

## Base Class

```javascript
// src/handler.js
export default class Handler {
  static skipAuth = false;
}
```

That's it — 3 lines. The base class exists to provide the `skipAuth` default and a common prototype for `instanceof` checks.

## Defining a Handler

### Server-only handler

```javascript
import { Handler } from '@stonyx/sockets';

export default class ValidateGameHandler extends Handler {
  server(data, client) {
    // data = whatever the client sent in the 'data' field
    // client = the WebSocket client object (with .id, .ip, .meta, .send())

    // Return a value to send it back as the response
    return { valid: true };

    // Return undefined/null to send no response
  }
}
```

### Client-only handler

```javascript
import { Handler } from '@stonyx/sockets';

export default class ScanGamesHandler extends Handler {
  client(response) {
    // response = whatever the server sent back
    // this.client = reference to the SocketClient instance

    this.client.app.scanGames(response);
  }
}
```

### Dual handler (both sides)

```javascript
import { Handler } from '@stonyx/sockets';

export default class EchoHandler extends Handler {
  server(data) {
    return data;  // echo back
  }

  client(response) {
    console.log('Got echo:', response);
  }
}
```

## Auth Handler (Required)

The `auth` handler is special — `SocketServer.init()` throws if it doesn't find a handler named `auth` with a `server()` method.

```javascript
import { Handler } from '@stonyx/sockets';
import config from 'stonyx/config';

export default class AuthHandler extends Handler {
  static skipAuth = true;  // MUST be true — auth runs before authentication

  server(data, client) {
    if (data.authKey !== config.sockets.authKey) return client.close();

    // Register client in the server's client map
    this._serverRef.clientMap.set(client.id, client);

    // Optionally set app-level metadata
    client.meta = { role: 'worker' };

    // Returning a truthy value triggers the framework to:
    // 1. Set client.__authenticated = true
    // 2. Generate and send a per-session encryption key (if encryption enabled)
    // 3. Send the response back to the client
    return 'success';
  }

  client(response) {
    // this.client = the SocketClient instance
    if (response !== 'success') this.client.promise.reject(response);
    this.client.promise.resolve();
  }
}
```

### Auth enforcement rules

- If a message arrives from an unauthenticated client:
  - And the handler is the `auth` handler → allowed
  - And the handler has `static skipAuth = true` → allowed
  - Otherwise → rejected, connection closed
- The framework sets `client.__authenticated = true` when the auth handler returns a truthy value
- If the auth handler returns `undefined`/`null`/falsy, auth fails (no response sent)

## Handler Discovery

Both `SocketServer` and `SocketClient` call `forEachFileImport` on the handler directory:

```javascript
await forEachFileImport(handlerDir, (HandlerClass, { name }) => {
  const instance = new HandlerClass();
  if (typeof instance.server === 'function') {
    instance._serverRef = this;
    this.handlers[name] = instance;
  }
}, { ignoreAccessFailure: true });
```

- **Filename → handler name:** kebab-case to camelCase (`validate-game.js` → `validateGame`)
- **Exception:** `auth.js` stays as `auth`
- **ignoreAccessFailure:** If the handler directory doesn't exist, no error is thrown

## Handler Context

### Inside `server()` hooks

- `this._serverRef` — the `SocketServer` instance
- First argument `data` — the parsed `data` field from the message
- Second argument `client` — the WebSocket client object

### Inside `client()` hooks

- `this.client` — the `SocketClient` instance (set via `.call()` binding)
- First argument `response` — the parsed `response` field from the message

## Wire Protocol

All messages are JSON objects with a `request` field:

```javascript
// Client → Server (outgoing request)
{ request: 'handlerName', data: { ... } }

// Server → Client (response from handler return value)
{ request: 'handlerName', response: { ... } }

// Server → Client (explicit send via sendTo/broadcast)
{ request: 'handlerName', data: { ... } }
```

## Built-in Handlers

These are handled by the framework — consumers do NOT define handlers for them:

### heartBeat

- **Server:** Receives `heartBeat` request → responds with `{ request: 'heartBeat', response: true }`
- **Client:** Receives `heartBeat` response → schedules next heartbeat via `setTimeout`
- **Lifecycle:** Automatically started after successful auth; interval configured via `heartBeatInterval`

### auth (framework-level handling)

While consumers define the auth handler logic, the framework wraps it with:
- Auto-setting `client.__authenticated = true` on truthy return
- Auto-generating and transmitting per-session encryption keys
- Auto-starting the heartbeat cycle on the client side
