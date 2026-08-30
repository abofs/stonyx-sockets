# Testing

## Running Tests

```bash
# From the stonyx-sockets directory
npx stonyx test

# Or via pnpm
pnpm test
```

**Important:** Use `stonyx test`, not plain `qunit`. The Stonyx test runner bootstraps the framework (config, logging, module init) before running QUnit. Without it, `stonyx/config` and `log.socket()` won't be available.

## Test Structure

```
test/
├── config/
│   └── environment.ts            # Test-specific config overrides (see Test Isolation)
├── sample/
│   └── socket-handlers/
│       ├── auth.ts               # Sample auth handler (server + client hooks)
│       └── echo.ts               # Simple echo handler (both hooks)
├── support/
│   ├── print-resolved-config.ts  # Subprocess probe: prints resolved config.sockets
│   └── decoy-listener.ts         # Local 127.0.0.1 decoy WebSocket listener
├── unit/
│   ├── handler-test.ts           # Base Handler class tests
│   ├── encryption-test.ts        # AES-256-GCM encrypt/decrypt tests
│   ├── server-test.ts            # SocketServer unit tests (no network)
│   ├── client-test.ts            # SocketClient unit tests (no network)
│   ├── publish-surface-test.ts   # npm pack surface guard (#26)
│   └── config-isolation-test.ts  # Ambient-env isolation guards (#45)
└── integration/
    └── socket-test.ts            # Full server+client round-trip tests
```

Files under `test/support/` are helpers, not suites — the runner glob is
`test/**/*-test.ts`, so they are only loaded when a test imports them.

## Test Config

```typescript
// test/config/environment.ts
export default {
  sockets: {
    port,                        // 2667, or TEST_SOCKET_PORT if set
    address: `ws://localhost:${port}`,
    authKey: 'TEST_AUTH_KEY',
    heartBeatInterval: 60000,    // Long interval so timers don't fire during tests
    handlerDir: './dist-test/test/sample/socket-handlers',
    log: false,
    encryption: 'false',         // Disabled for test simplicity
    reconnectBaseDelay: 100,
    reconnectMaxDelay: 60000,
    maxReconnectAttempts: 0,     // No reconnect storms during tests
  }
}
```

`handlerDir` points into `dist-test/`, not `test/` — handlers are discovered as
compiled JS produced by `pnpm build:test`.

## Test Isolation

**Every variable `config/environment.js` reads must be pinned in
`test/config/environment.ts`.** All ten are, and that is a hard invariant, not a
style preference.

It was not always true. `config/environment.js` reads ten `SOCKET_*` variables
and the test override pinned five. On a developer machine exporting
`SOCKET_ADDRESS` and `SOCKET_AUTH_KEY` — which is a normal thing for a machine
that talks to a socket server to have — `pnpm test` pointed the integration
client at that live external host and sent the real auth key to it. In
cleartext, because the `encryption: 'false'` pin here strips the AES-256-GCM
envelope that would otherwise have wrapped the credential on the wire. Either
pin alone would have prevented that; the combination produced it. CI never saw
it, because CI has no such variables set (#45).

Rules that follow from it:

- **Adding a key to `config/environment.js` means adding it to
  `test/config/environment.ts` in the same change.** `test/unit/config-isolation-test.ts`
  deep-equals the entire resolved `config.sockets`, so an unpinned new key fails
  the suite rather than quietly becoming ambient.
- **`address` and `port` must stay coupled.** `address` is computed from `port`
  at module-eval time in `config/environment.js`, so pinning `port` alone does
  *not* move `address`.
- **Assertions about this must spawn a subprocess.** Config resolves once, in
  `Stonyx.start()`, before qunit loads a single test file — setting
  `process.env` from a `beforeEach` is too late and passes against broken code.
- **Never point a test at a host you do not control.** The isolation suite uses
  a decoy listener bound to `127.0.0.1` on an ephemeral port.

When ambient `SOCKET_*` variables are present they are ignored, and the suite
prints one warning naming exactly which. It warns rather than failing, so a
developer with these variables exported can still run the suite.

## Sample Handlers

### auth.js

Validates `authKey` against config, registers client in `clientMap`, resolves the connection promise. Has `static skipAuth = true`.

### echo.js

Server returns whatever data it receives. Client stores the response on `client._lastEchoResponse` for test assertions.

## Writing Unit Tests

Unit tests do NOT start a WebSocket server. They test class behavior directly:

```javascript
import QUnit from 'qunit';
import SocketServer from '../../src/server.js';

const { module, test } = QUnit;

module('[Unit] SocketServer', function (hooks) {
  hooks.afterEach(function () {
    const server = SocketServer.instance;
    if (server) server.reset();
  });

  test('Singleton pattern', function (assert) {
    const s1 = new SocketServer();
    const s2 = new SocketServer();
    assert.strictEqual(s1, s2);
    s1.reset();
  });
});
```

Key patterns:
- Always call `reset()` in `afterEach` to clear the singleton
- Use `sinon` for stubs/spies when needed
- Restore sinon in `afterEach` with `sinon.restore()`

## Writing Integration Tests

Integration tests start a real server and client:

```javascript
import QUnit from 'qunit';
import SocketServer from '../../src/server.js';
import SocketClient from '../../src/client.js';
import { setupIntegrationTests } from 'stonyx/test-helpers';

const { module, test } = QUnit;

module('[Integration] Sockets', function (hooks) {
  setupIntegrationTests(hooks);  // Waits for Stonyx.ready

  hooks.afterEach(function () {
    const client = SocketClient.instance;
    const server = SocketServer.instance;
    if (client) client.reset();
    if (server) server.reset();
  });

  test('Round-trip', async function (assert) {
    const server = new SocketServer();
    await server.init();

    const client = new SocketClient();
    await client.init();

    client.send({ request: 'echo', data: { msg: 'hello' } });
    await new Promise(resolve => setTimeout(resolve, 200));

    assert.deepEqual(client._lastEchoResponse, { msg: 'hello' });
  });
});
```

Key patterns:
- `setupIntegrationTests(hooks)` — adds a `hooks.before` that `await Stonyx.ready`
- Always clean up in `afterEach` — `reset()` terminates connections and clears state
- Use `setTimeout` + `await` for async message assertions (messages are async)
- For multiple clients: null out `SocketClient.instance` between creations, track extras for cleanup

## Common Gotchas

- **Process hangs after tests:** Usually caused by un-cleared heartbeat timers or unclosed WebSocket servers. Ensure `reset()` is called for all instances.
- **`log.socket is not a function`:** Running `qunit` directly instead of `stonyx test`. The Stonyx bootstrap is required.
- **`moduleClass is not a constructor`:** The `src/main.js` default export must be a class (not just named exports). The `Sockets` class serves as the Stonyx auto-init entry point.
- **Port conflicts:** Integration tests use port 2667 by default. If tests run in parallel with other services, override **`TEST_SOCKET_PORT`** — not `SOCKET_PORT`, which the test config deliberately ignores (see Test Isolation). `TEST_SOCKET_PORT` moves the port and keeps `address` coupled to it; it can never move the suite off `localhost`.
- **`Ignoring ambient socket environment variable(s): ...`:** Expected, not an error. You have `SOCKET_*` variables exported; the suite is pinning over them so it does not reach an external host.
