# SME Template: QA Test Engineer — stonyx-sockets

> **Inherits from:** `beatrix-shared/docs/framework/templates/agents/qa-test-engineer.md`
> Load the base template first, then layer this project-specific context on top.

## Project Context

**Repo:** `abofs/stonyx-sockets`
**Framework:** Stonyx module (`@stonyx/sockets`) — WebSocket server/client for the Stonyx framework
**Domain:** Bidirectional WebSocket communication with handler auto-discovery, mandatory authentication, AES-256-GCM encryption, heartbeat keep-alive, and automatic reconnection

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (compiled to ESM) |
| Test Framework | QUnit |
| Mocking | Sinon |
| Build | tsc with separate `tsconfig.test.json` |
| Test Runner | `stonyx test` CLI |
| CI | GitHub Actions (`ci.yml`) |

## Architecture Patterns

- **Test build pipeline:** Tests compile to `dist-test/` via `tsconfig.test.json`, then run with `stonyx test 'dist-test/test/**/*-test.js'`
- **Integration tests available:** `test/integration/` contains end-to-end tests that start a real `SocketServer` and `SocketClient`, testing the full auth → encrypt → heartbeat → handler flow
- **Sample handler files:** `test/sample/` contains sample handler files (including an `auth.js`) used during discovery and integration tests
- **Dual singleton cleanup:** Tests must call both `SocketServer.reset()` and `SocketClient.reset()` in teardown — forgetting either leaks state across tests
- **Port management in tests:** Integration tests must use unique ports or sequential execution to avoid `EADDRINUSE` — the server binds to the configured port on `init()`
- **Encryption toggle testing:** Tests should cover both `encryption: 'true'` and `encryption: 'false'` paths — the code branches significantly between encrypted and plaintext modes

## Live Knowledge

- The `forEachFileImport` utility must be stubbed in unit tests to avoid filesystem scanning — provide mock handler classes that return instances with `server()` and/or `client()` methods
- `prepareSend()` monkey-patches `client.send()` — integration tests can verify the actual wire format (Buffer for encrypted, string for plaintext)
- The `clientId` counter is module-level and only resets on `SocketServer.reset()` — tests that assert on client IDs must account for counter state from prior tests
- The reconnection logic uses `sleep()` from `@stonyx/utils/promise` — this must be stubbed in unit tests to avoid real delays; use Sinon fake timers or stub the import
- Testing the heartbeat cycle requires either fake timers or short intervals — the default 30-second interval is too long for test suites
- The `onMessage` try/catch closes the connection on any error — tests should verify that malformed JSON, invalid encryption, and missing handlers all result in `client.close()` or connection termination
- Auth handler validation (`validateAuthHandler`) throws synchronously during `init()` — test that `init()` rejects when no auth handler is found
