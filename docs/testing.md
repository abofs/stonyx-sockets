# Testing

## Running Tests

```bash
pnpm test
```

`pnpm test` builds `src/` and `test/` (`tsc`, then `tsc -p tsconfig.test.json` into `dist-test/`), then runs QUnit over `test/**/*-test.ts` through `tsx` with `NODE_ENV=test`. `test/setup.ts` is loaded with `--import`: it boots Stonyx (config, logging, module init) and awaits `Stonyx.ready` before any test file loads. Run the suite through `pnpm test`, not plain `qunit`.

## Test Structure

```
test/
├── config/
│   └── environment.ts            # Test-specific config overrides
├── sample/
│   └── socket-handlers/
│       ├── auth.ts               # Sample auth handler (server + client hooks)
│       └── echo.ts               # Simple echo handler (both hooks)
├── unit/
│   ├── client-test.ts            # SocketClient unit tests (no network)
│   ├── encryption-test.ts        # AES-256-GCM encrypt/decrypt tests
│   ├── handler-test.ts           # Base Handler class tests
│   ├── publish-surface-test.ts   # Published-file surface tests
│   └── server-test.ts            # SocketServer unit tests (no network)
├── integration/
│   └── socket-test.ts            # Full server+client round-trip tests
└── setup.ts                      # Boots Stonyx and awaits Stonyx.ready
```

## Test Config

```typescript
// test/config/environment.ts
const config = {
  sockets: {
    handlerDir: './dist-test/test/sample/socket-handlers',
    heartBeatInterval: 60000,   // Long interval so timers don't fire during tests
    encryption: 'false',        // Disabled for test simplicity
    maxReconnectAttempts: 0,    // No reconnect loop after a test closes the server
    reconnectBaseDelay: 100,
  }
};
```

The handler directory points at the compiled samples in `dist-test/`. The test config does not set `port`, `address` or `authKey`, so those come from `config/environment.js` and therefore from `SOCKET_PORT`, `SOCKET_ADDRESS` and `SOCKET_AUTH_KEY` if they are set in your shell. Unset them before running the suite; otherwise the integration tests connect to whatever `SOCKET_ADDRESS` names.

## Sample Handlers

### auth.ts

Validates `authKey` against config, registers the client in `clientMap`, and resolves the connection promise. Has `static skipAuth = true`.

### echo.ts

The server returns whatever data it receives. The client stores the response on `client._lastEchoResponse` for test assertions.

## Writing Unit Tests

Unit tests do NOT start a WebSocket server. They test class behaviour directly:

```typescript
import QUnit from 'qunit';
import sinon from 'sinon';
import SocketServer from '../../src/server.js';

const { module, test } = QUnit;

module('[Unit] SocketServer', function (hooks) {
  hooks.afterEach(function () {
    const server = SocketServer.instance;
    if (server) server.reset();
    sinon.restore();
  });

  test('Singleton pattern', function (assert) {
    const s1 = new SocketServer();
    const s2 = new SocketServer();
    assert.strictEqual(s1, s2);
  });
});
```

Key patterns:
- Call `reset()` in `afterEach` to clear the singleton, and `sinon.restore()` to undo stubs.
- To exercise `init()` without scanning the filesystem, stub `discoverHandlers` (`sinon.stub(server, 'discoverHandlers').resolves()`) and set `server.handlers` yourself.
- `init()` rejects when there is no `auth` handler (`validateAuthHandler()` throws), and also when `config.sockets.encryption` or `handlerDir` is `undefined`.
- The client ID counter is module-level and resets only in `SocketServer.reset()`. Tests that assert on `client.id` depend on that reset.
- The server's `onMessage` closes the connection when parsing or decryption throws. A request naming an unknown handler is logged and ignored; the connection stays open. An unauthenticated request to a handler without `skipAuth` closes the connection.
- With encryption on, `client.send` sends a `Buffer`; with it off, a JSON string.

## Writing Integration Tests

Integration tests start a real server and client:

```typescript
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
    await client.connect();   // init() does not connect under NODE_ENV=test

    client.send({ request: 'echo', data: { msg: 'hello' } });
    await new Promise(resolve => setTimeout(resolve, 200));

    assert.deepEqual((client as any)._lastEchoResponse, { msg: 'hello' });
  });
});
```

Key patterns:
- `SocketClient.init()` returns before connecting when `NODE_ENV` is `test`. Call `connect()` yourself.
- `setupIntegrationTests(hooks)` adds a `hooks.before` that awaits `Stonyx.ready`.
- Always clean up in `afterEach`: `reset()` terminates connections and clears state.
- Messages are asynchronous. Use `setTimeout` + `await` before asserting on a response.
- For multiple clients, set `SocketClient.instance = null` between creations and track the extra clients for cleanup.
- Heartbeats use `heartBeatInterval` (60 s in the test config, 30 s by default). Use fake timers or a short interval to test the cycle.

## Common Gotchas

- **Process hangs after tests:** usually un-cleared heartbeat timers or unclosed WebSocket servers. Make sure `reset()` runs for every instance.
- **`moduleClass is not a constructor`:** the default export of `src/main.ts` must be a class. The `Sockets` class is the Stonyx auto-init entry point.
- **Port conflicts:** the server listens on 2667 by default. Override `SOCKET_PORT` if something else holds it, and see Test Config above for the other `SOCKET_*` variables.
