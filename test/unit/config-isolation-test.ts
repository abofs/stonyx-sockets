// Regression guards for stonyx-sockets#45.
//
// Defect: `config/environment.js` reads TEN SOCKET_* variables from the ambient
// environment. `test/config/environment.ts` pinned only five of them, so on any
// machine exporting SOCKET_ADDRESS / SOCKET_AUTH_KEY the integration suite
// pointed at a live external host and transmitted the real auth key in
// cleartext -- the test override pins `encryption: 'false'`, which strips the
// AES-256-GCM envelope that would otherwise have protected it on the wire.
// Neither pin alone produces that; the combination does. Hence the pinned set
// is asserted AS A SET (A1/A3), not key by key.
//
// WHY EVERY GUARD HERE SPAWNS A SUBPROCESS
// ----------------------------------------
// Config resolves exactly once, inside `Stonyx.start()`, before qunit loads a
// single test file. Mutating `process.env` from a `beforeEach` is too late --
// the value is already baked in, so such a test passes against UNFIXED code
// while looking like coverage of exactly the right thing. A subprocess is the
// only place this defect can be exhibited.
//
// AND NO GUARD DEPENDS ON A VARIABLE BEING ABSENT
// -----------------------------------------------
// "The variable happens not to be set" is not a safety property -- the machine
// this was found on had SOCKET_ADDRESS, SOCKET_AUTH_KEY and
// SOCKET_AGENT_AUTH_KEY exported at real values. Every guard below therefore
// SETS the polluting variables to unreachable sentinels. A0 and A7 are the two
// deliberate exceptions and are labelled for what they are.
//
// Nothing in this file ever contacts a host off this machine: the only remote
// endpoint used is a decoy listener bound to 127.0.0.1 on an ephemeral port.

import QUnit from 'qunit';
import { spawn, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import config from 'stonyx/config';
import { startDecoy, freePort, type Decoy } from '../helpers/decoy-listener.js';
import { redactSecrets, redactFrames, safeAddress } from '../helpers/redact.js';
import { checkTestIsolation, TEST_CONFIG_RELATIVE_PATH } from '../helpers/assert-test-isolation.js';

const { module, test } = QUnit;

/** Every SOCKET_* variable `config/environment.js` actually destructures. */
const READ_ENV_VARS = [
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

/**
 * Unreachable sentinel values for all ten read variables. `.invalid` is
 * reserved by RFC 2606 and never resolves, so even a regression that tried to
 * dial `address` could not reach a real host from here.
 */
const POLLUTION: Record<string, string> = {
  SOCKET_PORT: '39999',
  SOCKET_ADDRESS: 'ws://polluted.invalid:9999',
  SOCKET_AUTH_KEY: 'polluted-auth-key',
  SOCKET_HEARTBEAT_INTERVAL: '11111',
  SOCKET_HANDLER_DIR: './polluted-handlers',
  SOCKET_LOG: 'true',
  SOCKET_ENCRYPTION: 'true',
  SOCKET_RECONNECT_BASE_DELAY: '7777',
  SOCKET_RECONNECT_MAX_DELAY: '8888',
  SOCKET_MAX_RECONNECT_ATTEMPTS: '42',
};

/**
 * The complete resolved `config.sockets` the test environment must produce.
 *
 * This is deliberately a deep-equal target over the WHOLE object rather than a
 * set of per-key checks. That is the anti-drift guard: `config/environment.js`
 * reads ten variables and the test override must pin all ten, so if anyone adds
 * an eleventh config key without pinning it, the resolved object grows a key
 * this literal does not have and A1 fails. Weakening this to per-key assertions
 * re-opens exactly the drift that caused #45. Do not.
 */
function expectedConfig(port: number) {
  return {
    port,
    address: `ws://localhost:${port}`,
    authKey: 'TEST_AUTH_KEY',
    authData: {},
    heartBeatInterval: 60000,
    handlerDir: './dist-test/test/sample/socket-handlers',
    log: false,
    logColor: 'white',
    logMethod: 'socket',
    encryption: 'false',
    reconnectBaseDelay: 100,
    reconnectMaxDelay: 60000,
    maxReconnectAttempts: 0,
  };
}

const MARKER = '__RESOLVED_SOCKETS_CONFIG__';
const PROBE_ARGS = ['--import', 'tsx/esm', '--import', './test/setup.ts', 'test/helpers/print-resolved-config.ts'];

interface ProbeResult {
  /** Resolved `config.sockets`, with non-test secret values already redacted. */
  sockets: Record<string, unknown>;
  /**
   * Paths of secret-shaped fields the probe redacted. Non-empty exactly when a
   * secret-shaped field held something other than the pinned test literal, so
   * assertions can catch an ambient credential surviving without ever
   * rendering it. See `test/helpers/redact.ts`.
   */
  redactedFields: string[];
  stdout: string;
  stderr: string;
  warnings: string[];
}

/**
 * Boot Stonyx in a child process under a caller-supplied environment and return
 * the config it resolved. `overrides` set to `null` delete the variable.
 */
function probe(overrides: Record<string, string | null>): ProbeResult {
  const env: Record<string, string> = { ...process.env as Record<string, string>, NODE_ENV: 'test' };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete env[key];
    else env[key] = value;
  }

  const result = spawnSync(process.execPath, PROBE_ARGS, {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    timeout: 60000,
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const line = stdout.split('\n').find(l => l.startsWith(MARKER));

  if (!line) {
    throw new Error(`config probe produced no ${MARKER} line.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  const payload = JSON.parse(line.slice(MARKER.length)) as {
    sockets: Record<string, unknown>;
    redactedFields: string[];
  };

  return {
    sockets: payload.sockets,
    redactedFields: payload.redactedFields,
    stdout,
    stderr,
    warnings: stderr.split('\n').filter(l => l.includes('[@stonyx/sockets test config]')),
  };
}

/** All ten polluting variables set, plus the two ambient extras seen in the wild. */
function fullPollution(): Record<string, string | null> {
  return {
    ...POLLUTION,
    // Present on the machine where #45 was found; this module never reads it.
    SOCKET_AGENT_AUTH_KEY: 'polluted-agent-auth-key',
    // Deleted deliberately (not incidentally): the sanctioned test-scoped
    // escape hatch, whose "set" behaviour is covered by A8.
    TEST_SOCKET_PORT: null,
  };
}

module('[Unit] Test-config isolation (#45)', function () {

  // ---------------------------------------------------------------------
  // A0 -- DIAGNOSTIC, NOT A REGRESSION GUARD.
  //
  // Labelled honestly: under a scrubbed environment this assertion cannot
  // fail, because the polluting variable is precisely what is absent. It
  // earns its place by printing the ambient SOCKET_* environment the suite
  // is running under, so the scrub (or the lack of one) is visible in the
  // output of every run rather than inferred. The load-bearing version of
  // this same check, with the variables deliberately set, is A1.
  // ---------------------------------------------------------------------
  test('A0 [diagnostic] prints the ambient SOCKET_* environment and shows in-process config is pinned', function (assert) {
    const watched = [...READ_ENV_VARS, 'SOCKET_AGENT_AUTH_KEY', 'TEST_SOCKET_PORT'];
    const present = watched.filter(name => process.env[name] !== undefined);
    const absent = watched.filter(name => process.env[name] === undefined);

    console.log(`[#45 scrub guard] ambient PRESENT: ${present.length ? present.join(', ') : '(none)'}`);
    console.log(`[#45 scrub guard] ambient ABSENT:  ${absent.join(', ')}`);

    const sockets = (config as Record<string, unknown>).sockets as Record<string, unknown>;
    const port = Number(process.env.TEST_SOCKET_PORT ?? 2667);

    // A0 is the ONLY assertion that runs against the ambient environment, and
    // QUnit renders the whole `actual` object on failure. Unredacted, a dropped
    // pin wrote the developer's real SOCKET_AUTH_KEY into the TAP stream and
    // from there into the public CI log. Redacting first keeps the diff just as
    // actionable -- `authKey: "<redacted non-test secret>"` against an expected
    // `"TEST_AUTH_KEY"` says exactly what went wrong -- without disclosing it.
    // Same helper as the subprocess probe; one root cause, one fix.
    const { value: redacted, redactedFields } = redactSecrets(sockets);

    // Likewise not printed raw: on a dropped pin this is the real internal host.
    console.log(`[#45 scrub guard] resolved address in this process: ${safeAddress(sockets.address)}`);

    assert.deepEqual(redacted, expectedConfig(port), 'this process resolved the pinned test config');
    assert.deepEqual(
      redactedFields,
      [],
      'no secret-shaped field in the resolved config holds a non-test value'
    );
  });

  // ---------------------------------------------------------------------
  // A1 -- the load-bearing anti-drift guard.
  // ---------------------------------------------------------------------
  test('A1 resolved config.sockets deep-equals the pinned object under full ambient pollution', function (assert) {
    const { sockets } = probe(fullPollution());

    assert.deepEqual(
      sockets,
      expectedConfig(2667),
      'every key of the resolved socket config is pinned by the test environment, with all ten read variables set to sentinels'
    );
  });

  test('A2 port is pinned as a strict number and address stays coupled to it', function (assert) {
    const { sockets } = probe(fullPollution());

    // Unfixed code resolved the STRING "39999" here (`SOCKET_PORT ?? 2667`
    // never coerces). A loose assert.equal would have accepted "2667"; the
    // strict typeof check is the part that cannot be satisfied by a string.
    assert.strictEqual(sockets.port, 2667, 'port is the number 2667');
    assert.strictEqual(typeof sockets.port, 'number', 'port is typed number, not a string from the environment');

    // `address` is computed from `port` at module-eval in config/environment.js,
    // so pinning `port` alone does NOT update `address`. They must be pinned
    // together and stay coupled.
    assert.strictEqual(sockets.address, 'ws://localhost:2667', 'address is derived from the pinned port and targets localhost');
  });

  // ---------------------------------------------------------------------
  // A3 -- the pinned set evaluated AS A SET.
  //
  // Asks what combination of pins makes an unpinned value more dangerous
  // than it would be alone. Here: `encryption: 'false'` (pinned) plus an
  // unpinned `authKey`/`address` is what put a real credential in cleartext
  // on the wire. So rather than checking keys individually, this scans the
  // entire resolved object for ANY surviving ambient value.
  // ---------------------------------------------------------------------
  test('A3 no ambient sentinel value survives anywhere in the resolved config', function (assert) {
    const { sockets, redactedFields } = probe(fullPollution());
    const serialised = JSON.stringify(sockets);

    for (const [name, sentinel] of Object.entries(POLLUTION)) {
      // SOCKET_AUTH_KEY is excluded from the string scan ON PURPOSE, and the
      // exclusion is not a weakening. Its value is redacted before it crosses
      // the process boundary (see test/helpers/redact.ts), so scanning the
      // serialised object for that sentinel could no longer fail -- it would be
      // a vacuous assertion dressed as a real one. The `redactedFields` check
      // below replaces it and is strictly stronger: it fires for ANY ambient
      // value in a secret-shaped field, not only the one sentinel this test
      // happens to set.
      if (name === 'SOCKET_AUTH_KEY') continue;

      assert.notOk(
        serialised.includes(sentinel),
        `no value from ${name} (${sentinel}) survives anywhere in the resolved config`
      );
    }

    assert.deepEqual(
      redactedFields,
      [],
      'no secret-shaped field held an ambient value -- the probe had nothing to redact'
    );

    // The set property, stated directly: with encryption pinned off, anything
    // in this object is something the suite would put on the wire in cleartext.
    assert.strictEqual(sockets.encryption, 'false', 'encryption is pinned off for the suite, so nothing above may be ambient');
    assert.strictEqual(sockets.authKey, 'TEST_AUTH_KEY', 'the credential the suite transmits is a test literal, never an ambient secret');
  });

  // ---------------------------------------------------------------------
  // A4 / A5 -- one polluted integration run against a local decoy, two
  // independent properties asserted on it.
  // ---------------------------------------------------------------------
  module('polluted integration run against a local decoy listener', function (hooks) {
    const BUDGET_MS = 90000;

    let decoy: Decoy;
    let elapsedMs = 0;
    let timedOut = false;
    let exitCode: number | null = null;
    let output = '';

    hooks.before(async function () {
      decoy = await startDecoy();
      const innerPort = await freePort();

      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        NODE_ENV: 'test',
        // Point the ambient address at the decoy. On unfixed code the client
        // dials this and hands over the auth key; on fixed code it is ignored.
        SOCKET_ADDRESS: decoy.address,
        SOCKET_AUTH_KEY: 'decoy-sentinel-auth-key',
        SOCKET_AGENT_AUTH_KEY: 'polluted-agent-auth-key',
        // Sanctioned escape hatch, used here for its documented purpose: keep
        // the child's server off the port the outer suite is already using.
        TEST_SOCKET_PORT: String(innerPort),
      };

      const started = Date.now();

      const run = await new Promise<{ out: string; code: number | null; killed: boolean }>(resolve => {
        const child = spawn(
          process.execPath,
          ['--import', 'tsx/esm', '--import', './test/setup.ts', 'node_modules/qunit/bin/qunit.js', 'test/integration/socket-test.ts'],
          { cwd: process.cwd(), env }
        );

        let out = '';
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { out += d; });

        // A test that hangs is not a failing test, it is no result at all.
        // The budget converts the observed indefinite hang into a hard signal.
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve({ out, code: null, killed: true });
        }, BUDGET_MS);

        child.on('close', code => {
          clearTimeout(timer);
          resolve({ out, code, killed: false });
        });
      });

      elapsedMs = Date.now() - started;
      timedOut = run.killed;
      exitCode = run.code;
      output = run.out;
    });

    hooks.after(async function () {
      if (decoy) await decoy.close();
    });

    test('A4 the integration suite opens zero connections to the foreign host', function (assert) {
      assert.strictEqual(decoy.connections, 0, 'decoy listener accepted no connections from the suite');
      // Frames are redacted before rendering: on a real regression the auth
      // frame carries the developer's ambient SOCKET_AUTH_KEY, and a failure
      // message that prints it is BLOCKER-2 in a second location.
      assert.strictEqual(decoy.frames.length, 0, `decoy listener received no frames (got: ${JSON.stringify(redactFrames(decoy.frames))})`);

      // A suite that connected nowhere at all would also satisfy the above.
      // This pins that it connected to its OWN local server and passed.
      assert.ok(/^# fail 0$/m.test(output), `polluted integration run reported zero failures\n${output.slice(-2000)}`);
      assert.strictEqual(exitCode, 0, 'polluted integration run exited 0');
    });

    test('A5 the polluted integration run terminates within a bounded budget', function (assert) {
      assert.notOk(timedOut, `run terminated on its own rather than being killed at the ${BUDGET_MS}ms budget`);
      assert.ok(elapsedMs < BUDGET_MS, `run completed in ${elapsedMs}ms, under the ${BUDGET_MS}ms budget`);
    });
  });

  // ---------------------------------------------------------------------
  // A6 / A7 -- the warning. Pinning silently is what let this sit undetected,
  // so the warning is asserted rather than left to rot. It warns and does NOT
  // hard-fail: a hard failure would break `pnpm test` by default for exactly
  // the developers most likely to be working on this module.
  // ---------------------------------------------------------------------
  test('A6 one warning names exactly the present-and-ignored variables', function (assert) {
    const { warnings, sockets } = probe({
      SOCKET_ADDRESS: 'ws://polluted.invalid:9999',
      SOCKET_AUTH_KEY: 'polluted-auth-key',
      // Set but NOT read by this module. A guard that fired on this would be
      // firing on a variable that has never influenced a test run.
      SOCKET_AGENT_AUTH_KEY: 'polluted-agent-auth-key',
      SOCKET_PORT: null,
      SOCKET_HEARTBEAT_INTERVAL: null,
      SOCKET_HANDLER_DIR: null,
      SOCKET_LOG: null,
      SOCKET_ENCRYPTION: null,
      SOCKET_RECONNECT_BASE_DELAY: null,
      SOCKET_RECONNECT_MAX_DELAY: null,
      SOCKET_MAX_RECONNECT_ATTEMPTS: null,
      TEST_SOCKET_PORT: null,
    });

    assert.strictEqual(warnings.length, 1, `exactly one warning was emitted (got ${warnings.length}): ${warnings.join(' // ')}`);

    // Parse the named set out of the warning rather than substring-matching it.
    // Substring matching is wrong here: 'SOCKET_PORT' is a substring of the
    // 'TEST_SOCKET_PORT' the same sentence advertises as the escape hatch.
    const named = (/variable\(s\): ([^.]+)\./.exec(warnings[0] ?? '')?.[1] ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .sort();

    assert.deepEqual(
      named,
      ['SOCKET_ADDRESS', 'SOCKET_AUTH_KEY'],
      'warning names exactly the two watched variables that were present, and no others'
    );
    assert.notOk(
      named.includes('SOCKET_AGENT_AUTH_KEY'),
      'warning does NOT name SOCKET_AGENT_AUTH_KEY -- this module never reads it, and a guard that fires on an inert variable is worse than none'
    );

    // Warn, do not hard-fail: the boot still completed and produced config.
    assert.strictEqual(sockets.address, 'ws://localhost:2667', 'the run was warned, not failed -- config still resolved to the pin');
  });

  // A7 is the deliberate complement to A6: it is the one assertion that is
  // ABOUT absence, and it exists so the warning cannot become unconditional
  // noise that developers learn to ignore.
  test('A7 no warning is emitted when no watched variable is present', function (assert) {
    const scrubbed: Record<string, string | null> = { TEST_SOCKET_PORT: null, SOCKET_AGENT_AUTH_KEY: null };
    for (const name of READ_ENV_VARS) scrubbed[name] = null;

    const { warnings } = probe(scrubbed);

    assert.strictEqual(warnings.length, 0, `no warning on a clean environment (got: ${warnings.join(' // ')})`);
  });

  test('A8 TEST_SOCKET_PORT escape hatch overrides the pin and keeps address coupled', function (assert) {
    const { sockets } = probe({ ...fullPollution(), TEST_SOCKET_PORT: '27667' });

    assert.strictEqual(sockets.port, 27667, 'TEST_SOCKET_PORT wins over the pinned default');
    assert.strictEqual(typeof sockets.port, 'number', 'the escape hatch coerces to a number, unlike SOCKET_PORT');
    assert.strictEqual(
      sockets.address,
      'ws://localhost:27667',
      'address follows the escape-hatch port and still targets localhost -- the hatch can change the port, never the host'
    );

    // The ambient SOCKET_PORT=39999 sentinel is still ignored.
    assert.notOk(JSON.stringify(sockets).includes('39999'), 'ambient SOCKET_PORT is still ignored when the escape hatch is in use');
  });
  // ---------------------------------------------------------------------
  // A9 / A10 / A11 -- the fail-CLOSED boot guard (#45 CRITICAL).
  //
  // A1 is the right assertion but it is a TEST, and tests only run if the
  // suite reaches them. Measured on the previous head, the two drift scenarios
  // that reopen #45 both hang the suite before file ordering reaches this
  // file -- one connection to the ambient host, a cleartext auth frame, killed
  // at 120s (missing override) and 200s (address pin removed), with no `# fail`
  // line ever emitted. In CI that reads as a job timeout, not a regression.
  //
  // So the invariant is now enforced in `test/setup.ts`, before qunit loads any
  // test file. A9 covers the guard's branch logic directly; A10/A11 prove it is
  // actually WIRED IN and fires before a single byte leaves the process.
  // ---------------------------------------------------------------------

  // A9 is an in-process unit test of a pure function, and deliberately so:
  // Rule 4's subprocess requirement exists because config resolves once at boot,
  // so a `beforeEach` mutation is too late to exhibit a resolution defect.
  // `checkTestIsolation` takes its inputs as arguments and resolves nothing, so
  // there is no boot to be too late for. The resolution-path coverage is A10/A11.
  test('A9 the boot guard rejects every un-isolated boot shape it is responsible for', function (assert) {
    const cwd = process.cwd();

    // Missing override. This is the branch A10/A11 cannot exercise without
    // moving a tracked file out from under a concurrently running suite, so it
    // is covered here, on the same code path setup.ts calls.
    const missing = checkTestIsolation({ sockets: { address: 'ws://localhost:2667' }, cwd: tmpdir(), nodeEnv: 'test' });
    assert.ok(missing, 'a missing test/config/environment.ts is refused');
    assert.ok(missing?.includes(TEST_CONFIG_RELATIVE_PATH), 'the message names the file that is missing');
    assert.ok(missing?.includes('abofs/stonyx#86'), 'the message points at the framework issue for the silent swallow');

    // Not test mode: stonyx never merges the override, so config is ambient.
    const notTest = checkTestIsolation({ sockets: { address: 'ws://localhost:2667' }, cwd, nodeEnv: undefined });
    assert.ok(notTest, 'a boot outside NODE_ENV=test is refused even though the address happens to be loopback');

    // The #45 shape itself: a non-loopback address survived into the config.
    const foreign = checkTestIsolation({ sockets: { address: 'ws://polluted.invalid:9999' }, cwd, nodeEnv: 'test' });
    assert.ok(foreign, 'a non-loopback address is refused');
    assert.notOk(
      foreign?.includes('polluted.invalid'),
      'the refusal message does NOT name the foreign host -- on a real machine that is the internal address the pin exists to keep out of logs'
    );

    assert.ok(checkTestIsolation({ sockets: undefined, cwd, nodeEnv: 'test' }), 'a config with no sockets namespace is refused');
    assert.ok(checkTestIsolation({ sockets: { address: 'ws://localhost:NaN' }, cwd, nodeEnv: 'test' }), 'an unparseable address is refused');

    // The negative control. Without this, every assertion above is satisfied by
    // a function that returns a string unconditionally.
    for (const address of ['ws://localhost:2667', 'ws://127.0.0.1:2667', 'ws://[::1]:2667']) {
      assert.strictEqual(
        checkTestIsolation({ sockets: { address }, cwd, nodeEnv: 'test' }),
        null,
        `a properly isolated boot on ${address} is permitted`
      );
    }
  });

  module('un-isolated boot is refused before anything leaves the process', function (hooks) {
    // Generous next to the ~160ms the guard actually takes, but small enough
    // that a regression to the observed 120s/200s hang cannot pass.
    const BUDGET_MS = 30000;

    let decoy: Decoy;
    let elapsedMs = 0;
    let timedOut = false;
    let exitCode: number | null = null;
    let output = '';

    hooks.before(async function () {
      decoy = await startDecoy();

      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        SOCKET_ADDRESS: decoy.address,
        SOCKET_AUTH_KEY: 'unisolated-sentinel-auth-key',
      };

      // Deleting NODE_ENV is how this run is made un-isolated WITHOUT touching a
      // tracked file: stonyx only merges test/config/environment.ts under
      // NODE_ENV=test, so the child resolves the ambient socket config -- the
      // same end state as the missing-override scenario, reached safely while
      // other agents may be running suites over the same checkout family.
      delete env.NODE_ENV;

      const started = Date.now();

      const run = await new Promise<{ out: string; code: number | null; killed: boolean }>(resolve => {
        const child = spawn(
          process.execPath,
          [
            '--import', 'tsx/esm',
            '--import', './test/setup.ts',
            'node_modules/qunit/bin/qunit.js',
            // Both files that were observed dialling out. client-test.ts is
            // listed first because it is the one that actually leaked.
            'test/unit/client-test.ts',
            'test/integration/socket-test.ts',
          ],
          { cwd: process.cwd(), env }
        );

        let out = '';
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { out += d; });

        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve({ out, code: null, killed: true });
        }, BUDGET_MS);

        child.on('close', code => {
          clearTimeout(timer);
          resolve({ out, code, killed: false });
        });
      });

      elapsedMs = Date.now() - started;
      timedOut = run.killed;
      exitCode = run.code;
      output = run.out;
    });

    hooks.after(async function () {
      if (decoy) await decoy.close();
    });

    test('A10 an un-isolated boot fails fast and loudly instead of hanging', function (assert) {
      assert.notOk(timedOut, `the run terminated on its own rather than being killed at the ${BUDGET_MS}ms budget`);
      assert.ok(elapsedMs < BUDGET_MS, `refused in ${elapsedMs}ms, well under the ${BUDGET_MS}ms budget`);
      assert.notStrictEqual(exitCode, 0, `the un-isolated run exited non-zero (got ${exitCode})`);
      assert.ok(
        output.includes('[@stonyx/sockets test isolation] refusing to run'),
        `the failure names the isolation guard rather than reading as a timeout\n${output.slice(-1500)}`
      );
    });

    test('A11 an un-isolated boot makes zero contact with the ambient host', function (assert) {
      assert.strictEqual(decoy.connections, 0, 'decoy listener accepted no connections');
      assert.strictEqual(decoy.frames.length, 0, `decoy listener received no frames (got: ${JSON.stringify(redactFrames(decoy.frames))})`);
      assert.notOk(
        output.includes('unisolated-sentinel-auth-key'),
        'the sentinel credential appears nowhere in the run output'
      );
    });
  });
});
