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
│   └── environment.js            # Test-specific config overrides
├── sample/
│   └── socket-handlers/
│       ├── auth.js               # Sample auth handler (server + client hooks)
│       └── echo.js               # Simple echo handler (both hooks)
├── unit/
│   ├── handler-test.js           # Base Handler class tests
│   ├── encryption-test.js        # AES-256-GCM encrypt/decrypt tests
│   ├── server-test.js            # SocketServer unit tests (no network)
│   └── client-test.js            # SocketClient unit tests (no network)
└── integration/
    └── socket-test.js            # Full server+client round-trip tests
```

## Test Config

```javascript
// test/config/environment.js
export default {
  sockets: {
    handlerDir: './test/sample/socket-handlers',
    heartBeatInterval: 60000,   // Long interval so timers don't fire during tests
    encryption: 'false',        // Disabled for test simplicity
  }
}
```

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
- **Port conflicts:** Integration tests use port 2667 by default. If tests run in parallel with other services, override `SOCKET_PORT`.
