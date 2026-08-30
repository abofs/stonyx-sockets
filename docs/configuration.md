# Configuration

## How Config Loads

The package provides `config/environment.js` with defaults. Stonyx merges this into `config.sockets`:

1. Stonyx reads `config/environment.js` (the raw export)
2. Wraps it under the `sockets` key (derived from package name `@stonyx/sockets` → `sockets`)
3. Merges any user overrides from the consumer app's environment config
4. In test mode, merges `test/config/environment.ts` on top

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
| `reconnectBaseDelay` | `SOCKET_RECONNECT_BASE_DELAY` | `1000` | Number | Base delay in ms for reconnect backoff |
| `reconnectMaxDelay` | `SOCKET_RECONNECT_MAX_DELAY` | `60000` | Number | Ceiling in ms for reconnect backoff |
| `maxReconnectAttempts` | `SOCKET_MAX_RECONNECT_ATTEMPTS` | `Infinity` | Number | Reconnect attempts before giving up |

That is **ten** environment variables, and the list is load-bearing: every one
of them must also be pinned in `test/config/environment.ts` (see
[Test Config Override](#test-config-override)). If you add a row here, add a pin
there in the same change.

`authData` (`{}`), `logColor` (`'white'`) and `logMethod` (`'socket'`) are also
part of the resolved config but are not settable from the environment.

> `SOCKET_AGENT_AUTH_KEY` is **not** read by this package. If you have seen it
> referenced in connection with these settings, it belongs to a consumer app.

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
  SOCKET_ENCRYPTION,
  SOCKET_RECONNECT_BASE_DELAY,
  SOCKET_RECONNECT_MAX_DELAY,
  SOCKET_MAX_RECONNECT_ATTEMPTS,
} = process.env;

const port = SOCKET_PORT ?? 2667;

export default {
  port,
  address: SOCKET_ADDRESS ?? `ws://localhost:${port}`,
  authKey: SOCKET_AUTH_KEY ?? 'AUTH_KEY',
  authData: {},
  heartBeatInterval: SOCKET_HEARTBEAT_INTERVAL ?? 30000,
  handlerDir: SOCKET_HANDLER_DIR ?? './socket-handlers',
  log: SOCKET_LOG ?? false,
  logColor: 'white',
  logMethod: 'socket',
  encryption: SOCKET_ENCRYPTION ?? 'true',
  reconnectBaseDelay: SOCKET_RECONNECT_BASE_DELAY ?? 1000,
  reconnectMaxDelay: SOCKET_RECONNECT_MAX_DELAY ?? 60000,
  maxReconnectAttempts: SOCKET_MAX_RECONNECT_ATTEMPTS ?? Infinity,
};
```

Note that `port` is **not** coerced: `SOCKET_PORT ?? 2667` yields the *string*
from the environment when the variable is set. And `address` is built from
`port` at module-eval time, so overriding `port` alone does not move `address`.

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

```typescript
// test/config/environment.ts
const { TEST_SOCKET_PORT } = process.env;
const port = TEST_SOCKET_PORT ? Number(TEST_SOCKET_PORT) : 2667;

export default {
  sockets: {
    port,
    address: `ws://localhost:${port}`,
    authKey: 'TEST_AUTH_KEY',
    heartBeatInterval: 60000,
    handlerDir: './dist-test/test/sample/socket-handlers',
    log: false,
    encryption: 'false',
    reconnectBaseDelay: 100,
    reconnectMaxDelay: 60000,
    maxReconnectAttempts: 0,
  }
}
```

Note: Test overrides use the namespaced key (`sockets: { ... }`) because they're merged after Stonyx has already namespaced the config.

### Why all ten keys are pinned

**Every environment-readable key is pinned unconditionally, and that is an
invariant rather than thoroughness for its own sake.**

The override used to pin five. On a developer machine with `SOCKET_ADDRESS` and
`SOCKET_AUTH_KEY` exported, `pnpm test` pointed the integration client at that
live external host and transmitted the real auth key to it — in cleartext,
because the `encryption: 'false'` pin strips the AES-256-GCM envelope that would
otherwise have protected the credential on the wire. Either pin alone prevents
that; the combination produced it. CI was green throughout, because CI has no
such variables set (#45).

Two of the unpinned keys were harmless only by coincidence:

- `reconnectMaxDelay` is never read *only because* `maxReconnectAttempts` is
  pinned to `0`, so `reconnect()` returns before consulting it. Raise that
  attempt count and an ambient value becomes live.
- `authKey` does not change pass/fail, because the test client and test server
  read the same value — a wrong key still matches itself. It is pinned for
  safety, not correctness.

`test/unit/config-isolation-test.ts` deep-equals the entire resolved
`config.sockets` against a literal, in a subprocess booted with all ten
variables set to sentinels. So the pinned list cannot drift from the read list
without failing the suite.

**`TEST_SOCKET_PORT`** is the one sanctioned override, for local port conflicts.
It is test-scoped so it cannot be inherited from a production environment, and
it can change the port but never the host — `address` is always rebuilt against
`localhost`. Ambient `SOCKET_PORT` is ignored.

When any watched variable is present the suite emits a single warning naming
exactly which, then proceeds with the pinned values. It warns rather than
hard-failing, so that developers who legitimately have these variables exported
can still run the suite.
