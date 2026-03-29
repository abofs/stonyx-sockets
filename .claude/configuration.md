# Configuration

## How Config Loads

The package provides `config/environment.js` with defaults. Stonyx merges this into `config.sockets`:

1. Stonyx reads `config/environment.js` (the raw export)
2. Wraps it under the `sockets` key (derived from package name `@stonyx/sockets` → `sockets`)
3. Merges any user overrides from the consumer app's environment config
4. In test mode, merges `test/config/environment.js` on top

Access in code: `import config from 'stonyx/config'` → `config.sockets.port`, etc.

## Config Options

| Key | Env Var | Default | Type | Description |
|-----|---------|---------|------|-------------|
| `port` | `SOCKET_PORT` | `2667` | Number | WebSocket server listening port |
| `address` | `SOCKET_ADDRESS` | `ws://localhost:{port}` | String | Client connection URL |
| `authKey` | `SOCKET_AUTH_KEY` | `'AUTH_KEY'` | String | Shared secret for authentication |
| `heartBeatInterval` | `SOCKET_HEARTBEAT_INTERVAL` | `30000` | Number | Heartbeat interval in milliseconds |
| `handlerDir` | `SOCKET_HANDLER_DIR` | `'./socket-handlers'` | String | Path to handler files directory |
| `log` | `SOCKET_LOG` | `false` | Boolean | Enable verbose logging (unused currently) |
| `encryption` | `SOCKET_ENCRYPTION` | `'true'` | String | `'true'` or `'false'` — enables AES-256-GCM |

### Logging config (framework-internal)

| Key | Value | Purpose |
|-----|-------|---------|
| `logColor` | `'white'` | Chronicle log color for `log.socket()` |
| `logMethod` | `'socket'` | Creates `log.socket()` method |

## Default Config File

```javascript
// config/environment.js
const {
  SOCKET_AUTH_KEY,
  SOCKET_PORT,
  SOCKET_ADDRESS,
  SOCKET_HEARTBEAT_INTERVAL,
  SOCKET_HANDLER_DIR,
  SOCKET_LOG,
  SOCKET_ENCRYPTION
} = process.env;

const port = SOCKET_PORT ?? 2667;

export default {
  port,
  address: SOCKET_ADDRESS ?? `ws://localhost:${port}`,
  authKey: SOCKET_AUTH_KEY ?? 'AUTH_KEY',
  heartBeatInterval: SOCKET_HEARTBEAT_INTERVAL ?? 30000,
  handlerDir: SOCKET_HANDLER_DIR ?? './socket-handlers',
  log: SOCKET_LOG ?? false,
  logColor: 'white',
  logMethod: 'socket',
  encryption: SOCKET_ENCRYPTION ?? 'true',
};
```

## Consumer Override Example

In a consumer app's `config/environment.js`:

```javascript
export default {
  sockets: {
    port: 3000,
    authKey: process.env.MY_SECRET_KEY,
    handlerDir: './my-handlers',
    encryption: 'false',
  }
}
```

Only the keys you specify are overridden — the rest keep their defaults via Stonyx's `mergeObject`.

## Test Config Override

```javascript
// test/config/environment.js
export default {
  sockets: {
    handlerDir: './test/sample/socket-handlers',
    heartBeatInterval: 60000,
    encryption: 'false',
  }
}
```

Note: Test overrides use the namespaced key (`sockets: { ... }`) because they're merged after Stonyx has already namespaced the config.
