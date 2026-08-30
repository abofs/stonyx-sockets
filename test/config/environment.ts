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
// the suite dialled a live external host and sent the real 64-character auth
// key to it, in cleartext.
//
// THE CLEARTEXT IS NOT CAUSED BY THE `encryption:'false'` PIN BELOW. An earlier
// version of this comment said it was, and that the combination of pins was
// required. Measured, that is wrong: `SocketClient.encryptionEnabled` is
// assigned in `init()`, and `test/unit/client-test.ts` calls `connect()` on a
// client that was never `init()`ed, so the flag stays false and `send()` takes
// the unencrypted branch regardless of config. With `encryption` left at the
// package default `'true'`, a 127.0.0.1 decoy still recorded the auth frame as
// plain UTF-8 JSON:
//
//   __RESOLVED_SOCKETS_CONFIG__{... "encryption":"true" ...}
//   decoy frames: ["{\"request\":\"auth\",\"data\":{\"authKey\":\"<sentinel>\"}}"]
//
// So an unpinned `address` plus an unpinned `authKey` is BY ITSELF sufficient
// for cleartext credential disclosure. The `encryption:'false'` pin additionally
// strips the AES-256-GCM envelope on the integration path, where the client is
// init()ed -- it widens the exposure, it does not create it.
//
// The invariant is still over the SET, not over individual keys -- nothing in
// the resolved socket config may come from the ambient environment -- but the
// reason is that ANY single unpinned read can be the one that matters, not that
// one specific pair has to combine.
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
// GUARDS, AND WHAT EACH ONE ACTUALLY GUARANTEES
//   - A1 (test/unit/config-isolation-test.ts) deep-equals the whole resolved
//     object, so a NEW CONFIG KEY cannot go unpinned. It does NOT catch a new
//     environment read feeding an EXISTING key -- that adds no key and resolves
//     identically on both sides. A12 covers that by parsing the destructure out
//     of config/environment.js and holding PINNED_ENV_VARS, READ_ENV_VARS and
//     POLLUTION against it.
//   - Both are TESTS, so both only run if the suite gets that far. It did not:
//     a missing override or an unpinned address hung the suite before file
//     ordering reached them. test/helpers/assert-test-isolation.ts, called from
//     test/setup.ts, is what makes that case fail closed.

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
 * `config/environment.js` destructures -- no more, no less. That claim is
 * MACHINE-CHECKED: A12 in test/unit/config-isolation-test.ts parses the
 * destructure out of `config/environment.js` and deep-equals it against this
 * array, so adding an env read there without adding it here fails the suite.
 * Exported for that assertion.
 *
 * SOCKET_AGENT_AUTH_KEY is deliberately absent: nothing in this package reads
 * it, and a warning that fires on a variable which has never influenced a test
 * run is a warning nobody trusts.
 */
export const PINNED_ENV_VARS = [
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

/**
 * Resolve the escape hatch to a usable port, or fall back to the default.
 *
 * `Number()` is what stands between TEST_SOCKET_PORT and HOST INJECTION, and
 * that is not obvious enough to leave implicit. `address` is built by string
 * interpolation, and the `@` in a URL authority is userinfo, so an
 * un-coerced `TEST_SOCKET_PORT=2667@evil.example.com` would yield
 * `ws://localhost:2667@evil.example.com` -- whose hostname is
 * `evil.example.com`, not localhost. Coercion defuses it (the result is NaN),
 * and A13 pins that behaviour so a future edit mirroring
 * `config/environment.js`'s own un-coerced `SOCKET_PORT ?? 2667` style cannot
 * silently reopen it.
 *
 * Validation is warn-and-fall-back rather than throw, matching the posture of
 * the ambient-variable warning below: this is a documented developer hatch, and
 * a typo in it should produce a message, not a confusing `ws://localhost:NaN`
 * connection failure somewhere unrelated.
 */
export function resolveTestPort(raw: string | undefined): number {
  if (!raw) return DEFAULT_TEST_PORT;

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.warn(
      `[@stonyx/sockets test config] Ignoring invalid TEST_SOCKET_PORT=${JSON.stringify(raw)}: ` +
      `it must be an integer between 1 and 65535. Falling back to ${DEFAULT_TEST_PORT}.`
    );

    return DEFAULT_TEST_PORT;
  }

  return parsed;
}

const port = resolveTestPort(TEST_SOCKET_PORT);

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
