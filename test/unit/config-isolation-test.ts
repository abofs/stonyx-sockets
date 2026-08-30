// Regression guards for stonyx-sockets#45.
//
// Defect: `config/environment.js` reads TEN SOCKET_* variables from the ambient
// environment. `test/config/environment.ts` pinned only five of them, so on any
// machine exporting SOCKET_ADDRESS / SOCKET_AUTH_KEY the suite pointed at a live
// external host and transmitted the real auth key in cleartext.
//
// The cleartext is NOT a consequence of the `encryption: 'false'` pin, and an
// earlier version of this header said it was. `SocketClient.encryptionEnabled`
// is assigned in `init()`, and `test/unit/client-test.ts` calls `connect()`
// without it, so `send()` takes the unencrypted branch whatever config says.
// Measured with `encryption` at the package default `'true'`, a 127.0.0.1 decoy
// still recorded the auth frame as plain UTF-8 JSON. An unpinned address plus an
// unpinned authKey is sufficient on its own; the `encryption: 'false'` pin
// widens the exposure to the integration path, it does not create it.
//
// The pinned set is still asserted AS A SET (A1/A3) rather than key by key --
// because any single unpinned read can be the one that matters.
//
// WHY AN ASSERTION ABOUT CONFIG RESOLUTION SPAWNS A SUBPROCESS -- AND THE
// PRINCIPLE THAT SAYS WHEN ONE NEED NOT
// ----------------------------------------
// Config resolves exactly once, inside `Stonyx.start()`, before qunit loads a
// single test file. Mutating `process.env` from a `beforeEach` is too late --
// the value is already baked in, so such a test passes against UNFIXED code
// while looking like coverage of exactly the right thing. A subprocess is the
// only place that defect can be exhibited, so every assertion ABOUT RESOLUTION
// spawns one: A1, A2, A3, A6, A7, A8, A10, A11 and A13's injection half.
//
// The rule's reason is also its boundary, and stating the boundary HERE, at the
// rule, is deliberate. It binds assertions about RESOLUTION. A pure function
// handed its inputs as ARGUMENTS resolves nothing, so there is no boot for a
// `beforeEach` to be too late for and a subprocess buys no coverage. Three
// guards are in-process on exactly that principle, and each carries the label
// in its TAP name so a reader scanning a CI log sees it:
//
//   A0  [diagnostic] -- reads THIS process's already-resolved config, which is
//                       the one thing a subprocess cannot report back. Its
//                       resolution-path twin is A1.
//   A9  [in-process] -- calls `checkTestIsolation()` with crafted inputs. Its
//                       resolution-path twin is A10/A11, which prove the guard
//                       is wired into the boot.
//   A13 [in-process range + subprocess injection] -- `resolveTestPort()` with
//                       crafted inputs for the range/parse cases; the host-
//                       injection case goes through a real subprocess, because
//                       there the claim is about what the whole pipeline
//                       produces.
//
// A12, A14 and A15 assert properties of source artefacts and of the redaction
// helper rather than of resolution, so the rule does not reach them at all;
// A16 spawns regardless, because its claim is about what a bootstrap does.
//
// Argue any fourth exception from the PRINCIPLE -- "is this assertion resolving
// config, or is it handed its inputs?" -- and never from the fact that there
// are already three. Precedent is how a rule dies.
//
// AND NO GUARD DEPENDS ON A VARIABLE BEING ABSENT
// -----------------------------------------------
// A SEPARATE rule from the one above, with a separate exception list -- they
// sit next to each other and have been conflated before. "The variable happens
// not to be set" is not a safety property: the machine this was found on had
// SOCKET_ADDRESS, SOCKET_AUTH_KEY and SOCKET_AGENT_AUTH_KEY exported at real
// values. Every guard below therefore SETS the polluting variables to
// unreachable sentinels. A0 and A7 are the two deliberate exceptions to THIS
// rule and are labelled for what they are -- note that A7 spawns a subprocess
// like everything else, so it is not an exception to the subprocess rule.
//
// Nothing in this file ever contacts a host off this machine: the only remote
// endpoint used is a decoy listener bound to 127.0.0.1 on an ephemeral port.

import QUnit from 'qunit';
import { spawn, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { readFileSync } from 'fs';
import config from 'stonyx/config';
import { startDecoy, freePort, type Decoy } from '../helpers/decoy-listener.js';
import { redactSecrets, redactFrames, safeAddress, stripUserinfo } from '../helpers/redact.js';
import { checkTestIsolation, TEST_CONFIG_RELATIVE_PATH } from '../helpers/assert-test-isolation.js';
import { PINNED_ENV_VARS, resolveTestPort } from '../config/environment.js';

const { module, test } = QUnit;

/**
 * Every SOCKET_* variable `config/environment.js` actually destructures.
 *
 * Hand-maintained, and A12 is what keeps it honest -- it parses the destructure
 * out of the source file and deep-equals it against this array and against
 * `PINNED_ENV_VARS`. Before A12 this was one of three hand-duplicated copies of
 * the same list with only one of them enforced.
 */
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

/**
 * The SOCKET_* names `config/environment.js` actually destructures from
 * `process.env`, parsed out of the source rather than restated.
 *
 * This is the single source of truth A12 and A14 hold every hand-maintained
 * copy against: PINNED_ENV_VARS (drives the warning), READ_ENV_VARS and
 * POLLUTION (drive these guards), and the two config tables in the docs.
 * Parsing an artefact rather than restating it is the in-repo idiom --
 * test/unit/publish-surface-test.ts does the same against `npm pack`.
 */
function declaredEnvVars(): string[] {
  const source = readFileSync('config/environment.js', 'utf8');
  const destructure = /const\s*\{([\s\S]*?)\}\s*=\s*process\.env\s*;/.exec(source);

  return (destructure?.[1] ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)
    .sort();
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

    // The diff goes through THE SAME helper as the console.log above. It did
    // not, and the two disagreed on the same value in the same run: the log
    // line printed `<non-loopback address withheld>` while the deepEqual --
    // the more visible of the two -- rendered the real ambient host into the
    // TAP stream of a public repo. `safeAddress` returns a loopback address
    // verbatim, so the healthy run still deep-equals `expectedConfig` exactly
    // and this assertion is no weaker than before; a drifted address renders
    // as the withheld marker against the expected pin, which says what went
    // wrong without naming the host.
    const forDiff = { ...redacted, address: safeAddress((redacted as Record<string, unknown>).address) };

    assert.deepEqual(forDiff, expectedConfig(port), 'this process resolved the pinned test config');
    assert.deepEqual(
      redactedFields,
      [],
      'no secret-shaped field in the resolved config holds a non-test value'
    );
  });

  // ---------------------------------------------------------------------
  // A1 / A2 / A3 -- three independent properties of ONE fully polluted boot.
  //
  // These used to call probe(fullPollution()) three times: three identical
  // Stonyx boots of the same environment for three assertions. A4/A5 twenty
  // lines below already demonstrate the right idiom -- a nested module whose
  // hooks.before performs the expensive run once. Same file, one idiom now.
  // Saves two of the suite's subprocess spawns.
  // ---------------------------------------------------------------------
  module('one fully polluted config probe', function (hooks) {
    let polluted: ProbeResult;

    hooks.before(function () {
      polluted = probe(fullPollution());
    });

    // ---------------------------------------------------------------------
    // A1 -- the load-bearing anti-drift guard.
    // ---------------------------------------------------------------------
    test('A1 resolved config.sockets deep-equals the pinned object under full ambient pollution', function (assert) {
      const { sockets } = polluted;

      assert.deepEqual(
        sockets,
        expectedConfig(2667),
        'every key of the resolved socket config is pinned by the test environment, with all ten read variables set to sentinels'
      );
    });

    test('A2 port is pinned as a strict number and address stays coupled to it', function (assert) {
      const { sockets } = polluted;

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
    // Rather than checking keys individually, this scans the entire resolved
    // object for ANY surviving ambient value, because any one of them can be
    // the one that matters. An unpinned `address` plus an unpinned `authKey`
    // already puts a real credential on the wire in cleartext on the unit-test
    // path, whatever `encryption` resolves to -- see the file header.
    // ---------------------------------------------------------------------
    test('A3 no ambient sentinel value survives anywhere in the resolved config', function (assert) {
      const { sockets, redactedFields } = polluted;
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

      // The set property, stated directly. Note what this does NOT claim:
      // pinning encryption back on would not make an ambient authKey safe,
      // because the unit-test path never init()s the client and so never
      // encrypts at all.
      assert.strictEqual(sockets.encryption, 'false', 'encryption is pinned off for the suite');
      assert.strictEqual(sockets.authKey, 'TEST_AUTH_KEY', 'the credential the suite transmits is a test literal, never an ambient secret');
    });

  });

  // ---------------------------------------------------------------------
  // A4 / A5 -- one polluted run of every suite that dials out, against a local
  // decoy, with two independent properties asserted on it.
  // ---------------------------------------------------------------------
  module('polluted run of the outbound-dialling suites against a local decoy listener', function (hooks) {
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
          [
            '--import', 'tsx/esm',
            '--import', './test/setup.ts',
            'node_modules/qunit/bin/qunit.js',
            // BOTH files that dial out, not just the integration suite.
            //
            // This guard originally spawned test/integration/socket-test.ts
            // alone, and that was the wrong file. The leak actually observed in
            // the missing-override scenario came from test/unit/client-test.ts:
            // `client.connect().catch(() => {})` at :103 and :237 dials
            // config.sockets.address and swallows the error, while every
            // integration test failed fast at `SocketServer requires an "auth"
            // handler` (ambient handlerDir) and opened zero connections. So in
            // the exact scenario this guard exists for, it would have observed
            // zero connections from its child and passed GREEN while the suite
            // leaked. client-test.ts is listed first because it is the one that
            // leaked. config-isolation-test.ts is deliberately excluded to
            // avoid recursion.
            'test/unit/client-test.ts',
            'test/integration/socket-test.ts',
          ],
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

    test('A4 the outbound-dialling suites open zero connections to the foreign host', function (assert) {
      // COUNTED AT THE TCP LAYER, and that is the load-bearing one.
      //
      // This assertion used to read `decoy.connections`, which counts COMPLETED
      // WebSocket upgrades. `client-test.ts` -- the file A4 was re-pointed at
      // last round precisely because it is the one that dials -- calls
      // `connect()` and tears the socket down immediately, so its dial to the
      // foreign host frequently completes at the TCP layer and never at the
      // upgrade layer. Measured over three runs of this exact scenario:
      // `tcp=1 ws=0`, `tcp=1 ws=0`, `tcp=0 ws=0`. A4 therefore reported GREEN on
      // two of three runs that DID dial out. Re-pointing the guard at the right
      // file exposed that its instrument was one layer too high.
      //
      // Both counters are asserted, in leak order: contact, then upgrade, then
      // disclosure. A red on the first with the others green is a dial that was
      // torn down before it could hand anything over -- still a failure of "the
      // suite may only talk to itself", and no longer invisible.
      assert.strictEqual(decoy.tcpConnections, 0, 'decoy listener accepted no TCP connections from the suite -- the layer the dial actually happens at');
      assert.strictEqual(decoy.connections, 0, 'decoy listener completed no WebSocket handshakes from the suite');
      // Frames are redacted before rendering: on a real regression the auth
      // frame carries the developer's ambient SOCKET_AUTH_KEY, and a failure
      // message that prints it is BLOCKER-2 in a second location.
      assert.strictEqual(decoy.frames.length, 0, `decoy listener received no frames (got: ${JSON.stringify(redactFrames(decoy.frames))})`);

      // A suite that connected nowhere at all would also satisfy the above.
      // This pins that it connected to its OWN local server and passed.
      //
      // freePort() is a TOCTOU race -- it binds :0, reads the port, closes, and
      // the child binds it milliseconds later -- so a bind collision can turn
      // this precondition red and point the reader at ambient-env pollution
      // when the real cause is an unrelated process taking the port. Naming
      // that case keeps a confusing red from being misdiagnosed as a security
      // regression. (The port-collision defect itself is abofs/stonyx-sockets#51.)
      const bindCollision = /EADDRINUSE/.test(output);

      assert.notOk(bindCollision, 'the child suite bound its port -- a red here is a port collision, NOT ambient pollution');
      assert.ok(/^# fail 0$/m.test(output), `polluted run reported zero failures\n${output.slice(-2000)}`);
      assert.strictEqual(exitCode, 0, 'polluted run exited 0');
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
  test('A9 [in-process] the boot guard rejects every un-isolated boot shape it is responsible for', function (assert) {
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
      // Same layering correction as A4, and it matters more here: A11's whole
      // claim is that NOTHING left the process before the guard fired. A dial
      // that opened a TCP socket and was torn down before the upgrade is a
      // packet to the ambient host, and at the upgrade layer it was invisible.
      assert.strictEqual(decoy.tcpConnections, 0, 'decoy listener accepted no TCP connections -- nothing reached the ambient host at all');
      assert.strictEqual(decoy.connections, 0, 'decoy listener completed no WebSocket handshakes');
      assert.strictEqual(decoy.frames.length, 0, `decoy listener received no frames (got: ${JSON.stringify(redactFrames(decoy.frames))})`);
      assert.notOk(
        output.includes('unisolated-sentinel-auth-key'),
        'the sentinel credential appears nowhere in the run output'
      );
    });
  });
  // ---------------------------------------------------------------------
  // A12 -- close the deep-equal's blind spot (#45 HIGH).
  //
  // A1 catches a NEW CONFIG KEY. It does not catch a NEW ENVIRONMENT READ
  // FEEDING AN EXISTING KEY, because such a read adds no key to the resolved
  // object and resolves identically on both sides of the comparison. Proven on
  // the previous head: making `logMethod` read a new SOCKET_LOG_METHOD left the
  // suite 9/9 GREEN when scrubbed -- which is what CI always is -- and went
  // 6/3 red only on a machine that exports that variable. No warning named it
  // either, because it was not in PINNED_ENV_VARS. That is precisely the #45
  // failure shape restored for a new variable, with this file's own anti-drift
  // guard reporting green over it.
  //
  // Root cause: the read-list was hand-duplicated in THREE places -- the
  // destructure in config/environment.js, PINNED_ENV_VARS (which drives the
  // warning), and READ_ENV_VARS/POLLUTION (which drive these tests) -- and only
  // the resolved-key shape was enforced. So this derives the list from the
  // source of truth and asserts the other two against it.
  //
  // Parsing an artefact rather than restating it is the in-repo idiom:
  // test/unit/publish-surface-test.ts does the same against `npm pack`.
  // ---------------------------------------------------------------------
  test('A12 the read-list is derived from config/environment.js and the two hand-maintained copies match it', function (assert) {
    const declared = declaredEnvVars();

    // Control 1: the parse found the destructure at all. Without this a regex
    // that stopped matching would compare [] against [] further down and this
    // whole test would pass while enforcing nothing.
    assert.ok(declared.length > 0, 'the `= process.env` destructure was located and yielded identifiers');

    // Control 2: it found a name we know is there, so the parse reflects the
    // real file rather than having matched something unrelated.
    assert.ok(declared.includes('SOCKET_AUTH_KEY'), 'the parsed list contains SOCKET_AUTH_KEY, so the parse reflects the real file');

    // The load-bearing pair. Either one going red means someone added or
    // removed an environment read without updating the list that drives the
    // warning, or the list that drives these guards.
    assert.deepEqual(
      [...PINNED_ENV_VARS].sort(),
      declared,
      'PINNED_ENV_VARS (test/config/environment.ts -- drives the ignored-variable warning) equals the set config/environment.js reads'
    );
    assert.deepEqual(
      [...READ_ENV_VARS].sort(),
      declared,
      'READ_ENV_VARS (this file) equals the set config/environment.js reads'
    );

    // Third copy: the sentinel map every polluted probe is built from. If a new
    // read is added and POLLUTION does not cover it, A1/A3 stop exercising it.
    assert.deepEqual(
      Object.keys(POLLUTION).sort(),
      declared,
      'POLLUTION covers exactly the set config/environment.js reads, so no read goes un-exercised by A1/A3'
    );
  });
  // ---------------------------------------------------------------------
  // A13 -- TEST_SOCKET_PORT cannot smuggle a host, and cannot yield NaN.
  //
  // A8 exercised exactly one input, '27667' -- the happy path. The hatch's
  // host-safety rests entirely on `Number()`: `address` is built by string
  // interpolation and the `@` in a URL authority is userinfo, so an un-coerced
  // value is a host-injection primitive. It is safe as written and was
  // measured safe; what was missing is anything that would notice if it
  // stopped being. A future edit mirroring config/environment.js's own
  // un-coerced `SOCKET_PORT ?? 2667` style is a natural-looking consistency
  // change that reopens it.
  //
  // Split deliberately: the range/parse cases run in-process against the pure
  // `resolveTestPort`, and the injection case runs through a real subprocess
  // config resolution, because that is the one where the thing being asserted
  // is what the WHOLE PIPELINE produces rather than what one function returns.
  // ---------------------------------------------------------------------
  test('A13 [in-process range + subprocess injection] TEST_SOCKET_PORT is validated and cannot move the suite off localhost', function (assert) {
    // Pure-function half: every shape that must fall back to the default.
    for (const bad of ['abc', '', '2667.5', '0', '-1', '70000', 'NaN', '2667@evil.example.com', '80/../@attacker.test']) {
      assert.strictEqual(
        resolveTestPort(bad),
        2667,
        `TEST_SOCKET_PORT=${JSON.stringify(bad)} falls back to the default rather than producing NaN or an out-of-range port`
      );
    }

    // Negative control: a valid value is still honoured, so the above cannot be
    // satisfied by a function that ignores its argument.
    assert.strictEqual(resolveTestPort('27667'), 27667, 'a valid port is still honoured');
    assert.strictEqual(resolveTestPort(undefined), 2667, 'an unset hatch uses the default');

    // End-to-end half: the injection string through real config resolution.
    const { sockets } = probe({ ...fullPollution(), TEST_SOCKET_PORT: '2667@evil.example.com' });

    assert.strictEqual(
      new URL(sockets.address as string).hostname,
      'localhost',
      'the resolved address hostname is localhost -- the hatch can change the port, never the host'
    );
    assert.strictEqual(sockets.port, 2667, 'the injection string resolved to the default port, not NaN');
    assert.notOk(
      JSON.stringify(sockets).includes('evil.example.com'),
      'no part of the injection string survives anywhere in the resolved config'
    );
  });
  // ---------------------------------------------------------------------
  // A14 -- the PUBLISHED documentation is held to the same read-list.
  //
  // package.json `files` is ["dist", "config", "LICENSE.md", "README.md"].
  // `docs/` is NOT in the tarball; README.md is. The PR that fixed this defect
  // argued that "a published table short by three is the same bug in
  // documentation form" -- and then fixed docs/configuration.md while the
  // actually-published README table stayed short by four (SOCKET_LOG and all
  // three reconnect variables). Fixing those rows by hand and moving on would
  // leave exactly the hand-maintained-copy problem A12 exists to end, so the
  // doc tables are enforced from the same parsed source instead.
  //
  // A consumer installing from npm and reading the bundled README is the only
  // audience for whom this list IS the interface: config/environment.js ships
  // unchanged and still reads all ten ambient variables.
  // ---------------------------------------------------------------------
  test('A14 README.md and docs/configuration.md document exactly the variables config/environment.js reads', function (assert) {
    const declared = declaredEnvVars();

    // Control: shared with A12 -- if the parse silently returned nothing, the
    // subset checks below would pass vacuously against any document at all.
    assert.ok(declared.length > 0, `the destructure yielded identifiers (got ${declared.length})`);

    for (const file of ['README.md', 'docs/configuration.md']) {
      const text = readFileSync(file, 'utf8');
      const missing = declared.filter(name => !text.includes(name));

      assert.deepEqual(missing, [], `${file} documents every variable config/environment.js reads`);
    }

    // README.md is the one that actually ships, so pin that fact rather than
    // trusting it: if `files` ever drops it, this guard is guarding nothing.
    const files = JSON.parse(readFileSync('package.json', 'utf8')).files as string[];

    assert.ok(files.includes('README.md'), 'README.md is in package.json `files`, so the table above is the PUBLISHED one');
    assert.notOk(files.includes('docs'), 'docs/ is NOT published -- consumer-facing config guidance has to live in README.md');
  });
  // ---------------------------------------------------------------------
  // A15 -- a credential that is not under a secret-shaped KEY.
  //
  // test/helpers/redact.ts matched on key names only, and `address` does not
  // match `/key|token|secret|password|credential/i`. A URL authority can carry
  // userinfo, so an ambient `SOCKET_ADDRESS=ws://svc:<secret>@127.0.0.1:2667`
  // is a credential in a field the helper ignored -- and its hostname is
  // loopback, so the boot guard permits the run. Measured on the previous head,
  // the secret reached stdout TWICE in one run: once from `safeAddress`, which
  // returned loopback addresses verbatim, and once from A0's `deepEqual` diff.
  //
  // In-process and pure, on the same terms as A9: `stripUserinfo`,
  // `redactSecrets` and `safeAddress` take their inputs as arguments and
  // resolve no config, so there is no boot for a subprocess to be needed for.
  // The resolution-path coverage of the same helper is A0/A1/A3.
  // ---------------------------------------------------------------------
  test('A15 [in-process] URL userinfo is stripped on every render path, whatever the key name', function (assert) {
    const SECRET = 'USERINFO-CANARY-4d7b2e9a1f6c3805';

    // Both branches of safeAddress. Loopback was the leaking one: the hostname
    // is 127.0.0.1, so the value was returned verbatim, credential and all.
    for (const address of [
      `ws://svc:${SECRET}@127.0.0.1:2667`,
      `ws://${SECRET}@localhost:2667`,
      `wss://svc:${SECRET}@internal.example.com:2666/path?q=1`,
    ]) {
      assert.notOk(safeAddress(address).includes(SECRET), `safeAddress withholds the userinfo credential in ${address.replace(SECRET, '<secret>')}`);
      assert.notOk(JSON.stringify(redactSecrets({ address }).value).includes(SECRET), 'redactSecrets strips it too, so the deepEqual diff cannot render it');
      assert.deepEqual(redactSecrets({ address }).redactedFields, ['address'], 'the hit is reported as a redacted field, which is what A0/A3 assert on');
    }

    // The host survives on the loopback branch -- withholding it would make the
    // log line useless for the case it exists to show.
    assert.strictEqual(safeAddress(`ws://svc:${SECRET}@127.0.0.1:2667`), 'ws://<redacted userinfo>@127.0.0.1:2667', 'the loopback host is still shown; only the userinfo goes');

    // No key to match on at all: an array element.
    const nested = redactSecrets({ addresses: [`ws://svc:${SECRET}@127.0.0.1:2667`] });
    assert.notOk(JSON.stringify(nested.value).includes(SECRET), 'an array element is covered, though it carries no key name');
    assert.deepEqual(nested.redactedFields, ['addresses[0]'], 'and the array element is reported by its dotted path');

    // NEGATIVE CONTROLS. Without these every assertion above is satisfied by a
    // helper that mangles or withholds every string it is handed -- which would
    // make A0/A1's deep-equals fail, or worse, pass vacuously.
    assert.strictEqual(safeAddress('ws://localhost:2667'), 'ws://localhost:2667', 'a clean loopback address is still returned byte-for-byte, with no normalising trailing slash');
    assert.strictEqual(stripUserinfo('ws://localhost:2667'), 'ws://localhost:2667', 'stripUserinfo is identity when there is no userinfo');
    assert.strictEqual(safeAddress('ws://evil.example.com:2666'), '<non-loopback address withheld>', 'a non-loopback address is still withheld whole');
    assert.deepEqual(redactSecrets(expectedConfig(2667)).redactedFields, [], 'the pinned config itself redacts to nothing, so a green A0/A3 still means something');
    assert.deepEqual(redactSecrets(expectedConfig(2667)).value, expectedConfig(2667), 'and passes through unchanged, so A1 is not comparing a mangled object');
  });
  // ---------------------------------------------------------------------
  // A16 -- the boot guard's SCOPE, executed rather than claimed.
  //
  // `assert-test-isolation.ts` used to say it caught "a direct `qunit`
  // invocation". It does not: it runs from `test/setup.ts`, and that invocation
  // is by definition the case where that loader is absent. Measured on this
  // tree, the bypass leaked a cleartext credential to the ambient host and hung
  // until it was killed at 60s. `.claude/testing.md` documented the bypass
  // correctly the whole time, so the repo contradicted itself and the wrong
  // version was the one sitting next to the code.
  //
  // A corrected comment is still just a comment, so the scope claim is machine-
  // checked here in the two ways that can drift:
  //   1. the guard has exactly ONE caller, so "loader-scoped to test/setup.ts"
  //      stays true of the code rather than of the day it was written;
  //   2. an un-guarded bootstrap really does boot un-isolated -- spawned, not
  //      asserted from reading.
  //
  // If (2) ever goes red because the guard grew to cover more bootstraps, that
  // is a GOOD red: fix the comment, then this assertion.
  //
  // The child only prints resolved config; it opens no socket. Its ambient
  // address is an RFC 2606 `.invalid` sentinel, so nothing could be dialled
  // from it even by a regression.
  // ---------------------------------------------------------------------
  test('A16 the boot guard is loader-scoped, and an un-guarded bootstrap is proven un-guarded', function (assert) {
    // (1) Exactly one caller of the throwing form, found by scanning the
    // tracked source rather than restated -- the same idiom A12/A14 use for the
    // read-list. THIS FILE is excluded from the scan on purpose: its own source
    // contains the token being searched for, so including it would make the
    // scanner match itself and the result would say nothing about the guard.
    const SELF = 'test/unit/config-isolation-test.ts';
    const tracked = (spawnSync('git', ['ls-files', 'src', 'test'], { cwd: process.cwd(), encoding: 'utf8' }).stdout ?? '')
      .split('\n')
      .filter(file => file.endsWith('.ts') && file !== SELF);

    // Control: `git ls-files` returned a real file list, so the filter below is
    // not narrowing an empty set down to an empty set.
    assert.ok(tracked.length > 5, `the tracked .ts source was enumerated (got ${tracked.length} files)`);

    const callers = tracked.filter(file => /\bassertTestIsolation\s*\(/.test(readFileSync(file, 'utf8'))).sort();

    assert.deepEqual(
      callers,
      ['test/helpers/assert-test-isolation.ts', 'test/setup.ts'],
      'the guard is defined in its own file and invoked from test/setup.ts alone -- so it covers exactly the bootstraps that import test/setup.ts, and nothing more'
    );
    assert.ok(
      /--import \.\/test\/setup\.ts/.test(JSON.parse(readFileSync('package.json', 'utf8')).scripts.test),
      'the `test` script -- which is what CI runs -- goes through the guarded loader'
    );

    // (2) The limitation itself, executed: stonyx's own bootstrap, which is
    // what `npx stonyx test` uses and the loader chain a developer lands on the
    // moment plain `stonyx test` fails on .ts files.
    const SENTINEL = 'a16-unguarded-bootstrap-sentinel-auth-key';
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      SOCKET_ADDRESS: 'ws://a16-unguarded.invalid:9999',
      SOCKET_AUTH_KEY: SENTINEL,
    };

    // Deleting NODE_ENV is what makes the boot un-isolated: no override merged,
    // so the ambient values above are what resolves. Under `pnpm test` the
    // guard refuses this exact state (A10 measures it at ~160ms).
    delete env.NODE_ENV;

    const unguarded = spawnSync(
      process.execPath,
      ['--import', 'tsx/esm', '--import', './node_modules/stonyx/dist/cli/test-setup.js', 'test/helpers/print-resolved-config.ts'],
      { cwd: process.cwd(), env, encoding: 'utf8', timeout: 60000 }
    );

    const output = `${unguarded.stdout ?? ''}${unguarded.stderr ?? ''}`;

    assert.notOk(
      output.includes('[@stonyx/sockets test isolation] refusing to run'),
      'a bootstrap that does not import test/setup.ts does NOT run the guard -- this is the documented limitation, not a defect to be fixed here'
    );
    assert.ok(
      output.includes(MARKER),
      'and it boots all the way to a resolved config, so the limitation is real rather than incidentally masked by an unrelated crash'
    );
    assert.ok(
      output.includes('ws://a16-unguarded.invalid:9999'),
      'the config it resolved is the AMBIENT one -- this is what the un-guarded path costs, stated as a measurement'
    );

    // So on that path, redaction in print-resolved-config.ts is the ONLY thing
    // between an ambient credential and stdout. It holds.
    assert.notOk(output.includes(SENTINEL), 'the ambient auth key still does not reach stdout -- layer 2 is load-bearing precisely here, where layer 1 is absent');
  });
});
