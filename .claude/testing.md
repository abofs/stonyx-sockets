# Testing

## Running Tests

```bash
pnpm test
```

**Use `pnpm test`.** It is what CI runs, and it is not interchangeable with
`npx stonyx test` — an earlier version of this file presented them as
alternatives and that was wrong:

| | bootstrap | notes |
|---|---|---|
| `pnpm test` | `--import ./test/setup.ts` (repo-local) | builds, then runs qunit. **This is CI.** |
| `npx stonyx test` | `stonyx/dist/cli/test-setup.js` | bypasses `test/setup.ts` entirely |

`test/setup.ts` exists because stonyx's own test-setup does not await
`Stonyx.ready`, so QUnit loads test files before `Stonyx.initialized` flips and
integration tests hit the "not initialized yet" guard. It is also where the #45
isolation guard runs. `npx stonyx test` gets neither.

What both paths do share: the config pin itself. Both resolve config through
`Stonyx.start()`'s merge of `test/config/environment.ts`, so the pin holds under
either. Only the guards are single-path.

Plain `qunit` with no bootstrap at all does not work — `stonyx/config` and
`log.socket()` are unavailable without it.

## Test Structure

```
test/
├── config/
│   └── environment.ts            # Test-specific config overrides (see Test Isolation)
├── sample/
│   └── socket-handlers/
│       ├── auth.ts               # Sample auth handler (server + client hooks)
│       └── echo.ts               # Simple echo handler (both hooks)
├── helpers/
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

Files under `test/helpers/` are shared helpers, not suites — the runner glob is
`test/**/*-test.ts`, so they are only loaded when a test imports them.

## Test Config

Abridged — see [`docs/configuration.md`](../docs/configuration.md#test-config-override)
for the full file, which also exports `PINNED_ENV_VARS`, the `resolveTestPort`
validator and the ignored-variable warning.

```typescript
// test/config/environment.ts
const port = resolveTestPort(TEST_SOCKET_PORT);   // validated; falls back to 2667

const config: TestEnvironmentConfig = {
  sockets: {
    port,
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
};

export default config;
```

`handlerDir` points into `dist-test/`, not `test/` — handlers are discovered as
compiled JS produced by `pnpm build:test`.

## Test Isolation

**Every variable `config/environment.js` reads must be pinned in
`test/config/environment.ts`.** All ten are, and that is a hard invariant.

The incident narrative, the measured evidence, what each guard does and does not
guarantee, and the consumer-facing guidance all live in **one** place:
[`docs/configuration.md` → Why all ten keys are pinned](../docs/configuration.md#why-all-ten-keys-are-pinned).
Do not restate it here — this file previously carried a paraphrase that had
already drifted from the `docs/` copy before it merged, which is this module's
own bug one layer up.

What to do, when working in this repo:

- **Adding a key to `config/environment.js` means adding it to
  `test/config/environment.ts` in the same change.** A1 deep-equals the entire
  resolved `config.sockets`, so an unpinned new key fails the suite.
- **Adding an environment *read* means adding the variable to
  `PINNED_ENV_VARS` too**, even if it feeds an existing key. A1 will not catch
  that one; A12 will, by parsing the destructure out of `config/environment.js`.
- **Adding a row to either config table** — `README.md` (published) or
  `docs/configuration.md` — is enforced by A14 against the same parse.
- **`address` and `port` must stay coupled.** `address` is computed from `port`
  at module-eval time in `config/environment.js`, so pinning `port` alone does
  *not* move `address`.
- **Assertions about this must spawn a subprocess.** Config resolves once, in
  `Stonyx.start()`, before qunit loads a single test file — setting
  `process.env` from a `beforeEach` is too late and passes against broken code.
  A0, A9 and A13's range cases are the labelled in-process exceptions.
- **Never point a test at a host you do not control.** The isolation suite uses
  a decoy listener bound to `127.0.0.1` on an ephemeral port.
- **Never render a resolved config or a captured frame raw in an assertion
  message.** Use `test/helpers/redact.ts`; a guard whose red state discloses the
  credential it protects is worse than no guard.

When a **watched** variable is present it is ignored and the suite prints one
warning naming exactly which. `SOCKET_AGENT_AUTH_KEY` matches `SOCKET_*` but is
deliberately not watched — nothing in this package reads it — so its presence
produces no warning, and that is correct rather than a broken guard.

If the suite refuses to start with `[@stonyx/sockets test isolation] refusing to
run: ...`, that is `test/setup.ts` failing closed: the override file is missing,
`NODE_ENV` is not `test`, or the resolved address is not loopback. Fix the cause
— it means the suite was about to run against ambient socket config.

## Sample Handlers

### auth.ts

Validates `authKey` against config, registers client in `clientMap`, resolves the connection promise. Has `static skipAuth = true`.

### echo.ts

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
- **`log.socket is not a function`:** Running `qunit` with no bootstrap. Use `pnpm test`, which supplies `--import ./test/setup.ts`.
- **`moduleClass is not a constructor`:** The `src/main.ts` default export must be a class (not just named exports). The `Sockets` class serves as the Stonyx auto-init entry point.
- **Port conflicts:** Integration tests use port 2667 by default. If tests run in parallel with other services, override **`TEST_SOCKET_PORT`** — not `SOCKET_PORT`, which the test config deliberately ignores (see Test Isolation). `TEST_SOCKET_PORT` moves the port and keeps `address` coupled to it; it can never move the suite off `localhost`.
- **`Ignoring ambient socket environment variable(s): ...`:** Expected, not an error. You have `SOCKET_*` variables exported; the suite is pinning over them so it does not reach an external host.
