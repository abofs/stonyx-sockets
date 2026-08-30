// Fail-closed boot guard for stonyx-sockets#45.
//
// WHY THIS EXISTS: THE DEEP-EQUAL GUARD FAILED OPEN.
// --------------------------------------------------------------------------
// A1 deep-equals the resolved config against a literal, which is the right
// assertion -- but it is a TEST, and tests only run if the suite reaches them.
// Measured on the previous head, in the two drift scenarios that matter, it
// never ran at all:
//
//   * `test/config/environment.ts` missing or renamed. stonyx swallows
//     `Config not found:` (abofs/stonyx#86), so a repo with no override is
//     indistinguishable from one with a complete override. The suite booted on
//     the ambient config, opened one connection to a decoy standing in for the
//     ambient host, sent a cleartext auth frame, and was killed at 120s having
//     never emitted a `# fail` line.
//   * Only the `address` pin removed: same shape, killed at 200s.
//
// In both cases the file-ordering of the `test/**/*-test.ts` glob puts
// `test/integration/` and `test/unit/client-test.ts` ahead of
// `config-isolation-test.ts`, so the suite hangs while connecting out and
// produces no verdict. In CI that reads as a job timeout -- "flaky infra" --
// rather than as a security regression. A guard that only runs after the damage
// is a guard in name only.
//
// So the invariant is enforced HERE, from `test/setup.ts`, before qunit loads a
// single test file. It is fail-closed: it throws. `pnpm test` already runs
// `tsc -p tsconfig.test.json` first, and `TestSocketsConfig` catches pin
// *removal* at build time (TS2741) -- that is a real mitigation and it stays,
// but it does not catch a missing override file, an unpinned eleventh read, or
// a direct `qunit` invocation. This does.
//
// SCOPE: this fixes THIS PACKAGE's exposure. The framework-level silent swallow
// is abofs/stonyx#86 and is not waited on.
import { existsSync } from 'fs';
import { join } from 'path';

/** The override stonyx merges under NODE_ENV=test. Mandatory for this package. */
export const TEST_CONFIG_RELATIVE_PATH = 'test/config/environment.ts';

/**
 * Hosts the suite is permitted to resolve to. Everything else is off this
 * machine by definition, and #45 is exactly the case of the suite dialling one.
 */
export const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export interface IsolationInput {
  /** The resolved `config.sockets`, or whatever stood in for it. */
  sockets: unknown;
  /** Repository root, used to locate the override file. */
  cwd: string;
  /** `process.env.NODE_ENV` at boot. */
  nodeEnv: string | undefined;
}

const PREFIX = '[@stonyx/sockets test isolation]';

/**
 * Pure form of the guard: returns a human-readable reason the boot is NOT
 * isolated, or `null` when it is. Pure so it can be exercised directly with
 * crafted inputs instead of only through a subprocess.
 *
 * Never interpolates a credential or a foreign host into its message -- the
 * message lands in CI logs of a public repo, which is the same hazard
 * `test/helpers/redact.ts` exists for.
 */
export function checkTestIsolation({ sockets, cwd, nodeEnv }: IsolationInput): string | null {
  const overridePath = join(cwd, TEST_CONFIG_RELATIVE_PATH);

  // Checked before NODE_ENV so the most specific root cause wins the message:
  // a missing override is silent at the framework layer, so it is the failure
  // mode a reader is least equipped to diagnose from a symptom.
  if (!existsSync(overridePath)) {
    return (
      `${TEST_CONFIG_RELATIVE_PATH} is missing. It is mandatory for this package: it pins every ` +
      `socket config value the suite uses. stonyx silently swallows "Config not found" ` +
      `(abofs/stonyx#86), so without this check the suite boots on the AMBIENT socket config and ` +
      `dials whatever SOCKET_ADDRESS names (#45).`
    );
  }

  if (nodeEnv !== 'test') {
    return (
      `NODE_ENV is not "test" (got ${nodeEnv === undefined ? 'undefined' : JSON.stringify(nodeEnv)}), ` +
      `so stonyx did not merge ${TEST_CONFIG_RELATIVE_PATH} and the socket config is AMBIENT. ` +
      `Run the suite via \`pnpm test\`, which sets it.`
    );
  }

  if (sockets === null || typeof sockets !== 'object') {
    return 'resolved config has no `sockets` namespace, so nothing was pinned.';
  }

  const { address } = sockets as Record<string, unknown>;

  if (typeof address !== 'string') {
    return 'resolved config.sockets.address is not a string, so the suite has no verifiable target.';
  }

  let hostname: string;

  try {
    hostname = new URL(address).hostname;
  } catch {
    return 'resolved config.sockets.address is not a parseable URL. Check TEST_SOCKET_PORT.';
  }

  if (!LOOPBACK_HOSTNAMES.has(hostname)) {
    // The host is deliberately not named: on a real developer machine it is the
    // internal address the pin exists to keep out of logs.
    return (
      'resolved config.sockets.address points at a NON-LOOPBACK host (withheld from this message). ' +
      `The suite may only talk to itself. Something un-pinned the address -- see ${TEST_CONFIG_RELATIVE_PATH} (#45).`
    );
  }

  return null;
}

/** Throwing form. Called from `test/setup.ts` before qunit loads any test file. */
export function assertTestIsolation(input: IsolationInput): void {
  const reason = checkTestIsolation(input);

  if (reason) throw new Error(`${PREFIX} refusing to run: ${reason}`);
}
