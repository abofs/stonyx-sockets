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
// config/environment.js -- reproduced in full; `const config = {...}; export default config;`
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

const config = {
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

export default config;
```

**No environment value here is coerced.** `SOCKET_PORT ?? 2667` yields the
*string* from the environment when the variable is set, and so do
`SOCKET_HEARTBEAT_INTERVAL`, `SOCKET_RECONNECT_BASE_DELAY`,
`SOCKET_RECONNECT_MAX_DELAY` and `SOCKET_MAX_RECONNECT_ATTEMPTS`. Those four are
harmless only because every consumer of them (`src/client.ts:228-229`, `:239`,
`:191-192`) is an arithmetic or relational context that coerces. The Type column
above is the type of the **default**, not of the resolved value.

The one to watch is `SOCKET_LOG`, typed Boolean: `SOCKET_LOG=false` yields the
**string** `"false"`, which is truthy. Inert today -- nothing in `src/` reads
`config.sockets.log` -- but "inert only because nothing happens to read it" is
the same shape as the `reconnectMaxDelay` case described below.

And `address` is built from `port` at module-eval time, so overriding `port`
alone does not move `address`.

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

> **Scope:** this section describes **@stonyx/sockets' own test suite**.
> `test/` is not in the npm tarball, so `TEST_SOCKET_PORT` is not part of the
> published surface and setting it in a consumer app does nothing. If you
> consume this package and run your own suite, see
> [If your app consumes this package](#if-your-app-consumes-this-package) below.

Abridged -- the real file also exports `PINNED_ENV_VARS`, the `resolveTestPort`
validator and the `console.warn` block that names ignored ambient variables:

```typescript
// test/config/environment.ts
const { TEST_SOCKET_PORT } = process.env;
const port = resolveTestPort(TEST_SOCKET_PORT);   // validates, warns, falls back to 2667

const config: TestEnvironmentConfig = {
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
};

export default config;
```

Note: Test overrides use the namespaced key (`sockets: { ... }`) because they're merged after Stonyx has already namespaced the config.

### Why all ten keys are pinned

**Every environment-readable key is pinned unconditionally, and that is an
invariant rather than thoroughness for its own sake.**

The override used to pin five. On a developer machine with `SOCKET_ADDRESS` and
`SOCKET_AUTH_KEY` exported, `pnpm test` pointed the client at that live external
host and transmitted the real auth key to it, in cleartext. CI was green
throughout, because CI has no such variables set (#45).

**The cleartext is not caused by the `encryption: 'false'` pin.** An earlier
version of this page said it was, and that either pin alone would have prevented
it. Measured, that is wrong. `SocketClient.encryptionEnabled` is assigned in
`init()`, and `test/unit/client-test.ts` calls `connect()` on a client that was
never `init()`ed, so `send()` takes the unencrypted branch regardless of what
`encryption` resolves to. With `encryption` left at the package default
`'true'`, a `127.0.0.1` decoy still recorded the auth frame as plain UTF-8 JSON:

```
__RESOLVED_SOCKETS_CONFIG__{... "encryption":"true" ...}
decoy frames: ["{\"request\":\"auth\",\"data\":{\"authKey\":\"<sentinel>\"}}"]
```

So an unpinned `address` plus an unpinned `authKey` is **by itself** sufficient
for cleartext credential disclosure. The `encryption: 'false'` pin additionally
strips the AES-256-GCM envelope on the integration path, where the client *is*
`init()`ed — it widens the exposure, it does not create it. The invariant is
still over the set, but the reason is that **any** single unpinned read can be
the one that matters, not that one specific pair has to combine.

Two of the unpinned keys were harmless only by coincidence:

- `reconnectMaxDelay` is never read *only because* `maxReconnectAttempts` is
  pinned to `0`, so `reconnect()` returns before consulting it. Raise that
  attempt count and an ambient value becomes live.
- `authKey` does not change pass/fail, because the test client and test server
  read the same value — a wrong key still matches itself. It is pinned for
  safety, not correctness.

### What the guards actually guarantee

`test/unit/config-isolation-test.ts` deep-equals the entire resolved
`config.sockets` against a literal, in a subprocess booted with all ten
variables set to sentinels (A1). That catches a **new config key** going
unpinned. It does **not** catch a **new environment read feeding an existing
key** — such a read adds no key to the resolved object and resolves identically
on both sides of the comparison. A12 covers that by parsing the `= process.env`
destructure out of `config/environment.js` and holding `PINNED_ENV_VARS`,
`READ_ENV_VARS` and `POLLUTION` against it, and A14 holds this table and the
README table against the same parse.

Both are *tests*, and tests only run if the suite reaches them — which in the
two drift scenarios it did not, because it hung while connecting out before file
ordering got there. `test/helpers/assert-test-isolation.ts`, called from
`test/setup.ts` before QUnit loads any test file, is what makes those cases fail
closed: it refuses to boot unless the override file exists, `NODE_ENV` is
`test`, and the resolved `address` is loopback.

**`TEST_SOCKET_PORT`** is the one sanctioned override, for local port conflicts.
It is test-scoped so it cannot be inherited from a production environment, and
it can change the port but never the host — `address` is always rebuilt against
`localhost`, and the value is coerced with `Number()` and range-checked, which
is what stops `2667@evil.example.com` from smuggling a host through the URL's
userinfo component. An invalid value warns and falls back to `2667`. Ambient
`SOCKET_PORT` is ignored.

When any watched variable is present the suite emits a single warning naming
exactly which, then proceeds with the pinned values. It warns rather than
hard-failing, so that developers who legitimately have these variables exported
can still run the suite. `SOCKET_AGENT_AUTH_KEY` is deliberately **not** watched
— nothing in this package reads it, and a warning that fires on a variable which
has never influenced a test run is a warning nobody trusts.

## If your app consumes this package

`test/` is not published, so **this fix does not protect you** — your own
`test/config/environment.js` governs your suite. `config/environment.js` *is*
published and is unchanged: it still reads all ten ambient `SOCKET_*` variables.
Gating it on `NODE_ENV` was rejected precisely because it would silently reset
socket config for any consumer running their own suite under `NODE_ENV=test`.

So if you run tests in a shell that exports `SOCKET_*`, you have the same defect:

1. Pin **all ten** keys from the table above in your own
   `test/config/environment.js`.
2. Keep `port` and `address` coupled — `address` is computed from `port` at
   module-eval time, so pinning `port` alone does not move it.
3. Assert the resolved config as a whole object, not key by key, so a key added
   by a future version of this package fails your suite rather than silently
   becoming ambient.

`abofs/stonyx#86` is scoped to land this as a shared, package-independent
pattern; this page carries only the `@stonyx/sockets` specifics.
