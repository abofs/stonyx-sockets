// Test-scoped socket configuration overrides.
//
// Stonyx merges this over the package's own `config/environment.js` whenever
// NODE_ENV=test (see Stonyx.start). Every key `config/environment.js` reads
// from the ambient environment MUST be pinned here.
//
// WHY ALL TEN, AND NOT JUST THE THREE THAT BREAK THE SUITE (#45)
// --------------------------------------------------------------
// `config/environment.js` reads ten SOCKET_* variables. This file used to pin
// five. On a developer machine exporting SOCKET_ADDRESS and SOCKET_AUTH_KEY,
// the integration suite dialled a live external host and sent the real
// 64-character auth key to it -- in cleartext, because the `encryption:'false'`
// pin below strips the AES-256-GCM envelope that would otherwise have wrapped
// it. Either pin alone would have prevented that; the combination produced it.
// So the invariant is over the SET, not over individual keys: nothing in the
// resolved socket config may come from the ambient environment.
//
// Two of the five that were unpinned were inert only by luck:
//   - `reconnectMaxDelay` is unread only because `maxReconnectAttempts` is
//     pinned to 0, so reconnect() returns before the delay is consulted. The
//     moment a reconnect story raises that attempt count, an ambient
//     SOCKET_RECONNECT_MAX_DELAY becomes live inside timing-sensitive tests.
//   - `authKey` is pass/fail-inert because the test client and test server read
//     the same value, so a wrong key still matches itself. It is pinned for the
//     safety reason above, not a correctness one.
//
// TWO MECHANICS NOT TO GET WRONG
//   1. `address` is computed from `port` at module-eval time in
//      config/environment.js. Pinning `port` does NOT update `address`. They
//      must be pinned together and kept coupled -- see `port`/`address` below.
//   2. Anything importing `config/environment.js` directly still sees ambient
//      values; this override only governs `Stonyx.config.sockets`.
//
// WHY THE FIX LIVES HERE AND NOWHERE ELSE
//   - Not in `test/setup.ts`: bypassed by the documented `stonyx test`
//     invocation, which runs stonyx's own test-setup instead of ours.
//   - Not by gating `config/environment.js` on NODE_ENV: that file is
//     PUBLISHED, so any downstream consumer running their own suite under
//     NODE_ENV=test would have their socket config silently reset by us.
//   - Not `env -u` in the test script: a blocklist stops covering any variable
//     added later, and does not protect a direct qunit invocation.
//
// Guarded by test/unit/config-isolation-test.ts. A1 there deep-equals the whole
// resolved object, so this list cannot silently drift from the read list again.

interface TestSocketsConfig {
  port: number;
  address: string;
  authKey: string;
  heartBeatInterval: number;
  handlerDir: string;
  log: boolean;
  encryption: string;
  reconnectBaseDelay: number;
  reconnectMaxDelay: number;
  maxReconnectAttempts: number;
}

interface TestEnvironmentConfig {
  sockets: TestSocketsConfig;
}

/**
 * Ambient variables this override neutralises. Exactly the set that
 * `config/environment.js` destructures -- no more, no less.
 *
 * SOCKET_AGENT_AUTH_KEY is deliberately absent: nothing in this package reads
 * it, and a warning that fires on a variable which has never influenced a test
 * run is a warning nobody trusts.
 */
const PINNED_ENV_VARS = [
  'SOCKET_PORT',
  'SOCKET_ADDRESS',
  'SOCKET_AUTH_KEY',
  'SOCKET_HEARTBEAT_INTERVAL',
  'SOCKET_HANDLER_DIR',
  'SOCKET_LOG',
  'SOCKET_ENCRYPTION',
  'SOCKET_RECONNECT_BASE_DELAY',
  'SOCKET_RECONNECT_MAX_DELAY',
  'SOCKET_MAX_RECONNECT_ATTEMPTS',
];

const DEFAULT_TEST_PORT = 2667;

/**
 * The one sanctioned override, and it is test-scoped so it can never be
 * inherited from a production/agent environment the way SOCKET_* can. It exists
 * for the documented port-conflict workaround in .claude/testing.md. It can
 * change the port; it can never change the host -- `address` below is always
 * built against localhost.
 */
const { TEST_SOCKET_PORT } = process.env;
const port = TEST_SOCKET_PORT ? Number(TEST_SOCKET_PORT) : DEFAULT_TEST_PORT;

// Warn, do not hard-fail. Silence is what let #45 sit undetected, so the
// warning is non-negotiable -- but a hard failure would break `pnpm test` by
// default for exactly the developers most likely to be working on this module,
// and would delete the sanctioned TEST_SOCKET_PORT escape hatch along with it.
const ignored = PINNED_ENV_VARS.filter(name => process.env[name] !== undefined);

if (ignored.length) {
  console.warn(
    `[@stonyx/sockets test config] Ignoring ambient socket environment variable(s): ${ignored.join(', ')}. ` +
    `The test suite pins socket config unconditionally so it never reaches a host outside this machine (#45). ` +
    `Use TEST_SOCKET_PORT to change the test port.`
  );
}

const config: TestEnvironmentConfig = {
  sockets: {
    // Pinned together and kept coupled -- see mechanic (1) above.
    port,
    address: `ws://localhost:${port}`,

    authKey: 'TEST_AUTH_KEY',
    heartBeatInterval: 60000,     // long enough that timers never fire mid-test
    handlerDir: './dist-test/test/sample/socket-handlers',
    log: false,
    encryption: 'false',          // disabled for test simplicity
    reconnectBaseDelay: 100,
    reconnectMaxDelay: 60000,
    maxReconnectAttempts: 0,      // no reconnect storms during tests
  }
};

export default config;
