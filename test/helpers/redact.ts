// Secret redaction for stonyx-sockets#45.
//
// ONE ROOT CAUSE, ONE HELPER.
// --------------------------------------------------------------------------
// Two paths in the #45 guards render the resolved socket config, and both of
// them can run against the AMBIENT environment rather than the pinned test
// config:
//
//   1. `test/helpers/print-resolved-config.ts` prints it to stdout. A developer
//      copying `PROBE_ARGS` out of `config-isolation-test.ts` does not copy
//      `NODE_ENV=test` with it -- that is set separately in the `spawnSync` env
//      object -- so the probe run by hand resolves the ambient config and
//      printed the real 64-character `SOCKET_AUTH_KEY` verbatim.
//   2. A0's `assert.deepEqual` runs in-process against the ambient environment,
//      and QUnit renders the whole `actual` object on failure, so a dropped pin
//      wrote the same credential into the TAP stream -- i.e. into the CI job
//      log of a PUBLIC repository.
//
// Those are the same defect: an object that may hold an ambient secret is
// rendered without redaction. It is fixed once, here, and both call sites use
// it. A guard whose red state discloses the secret it exists to protect is
// worse than no guard.
//
// WHY REDACTION IS VALUE-AWARE RATHER THAN BLANKET
// --------------------------------------------------------------------------
// Blanket-redacting `authKey` would make the guards vacuous: A1 deep-equals the
// resolved object against a literal, and A3 scans it for surviving ambient
// sentinels. If every `authKey` rendered as `<redacted>`, an ambient key
// leaking into it would compare equal to a pinned one leaking into it, and the
// assertions could no longer fail. So the pinned test literal passes through
// verbatim (it is a published constant, not a secret) and anything else is
// replaced. The distinction is itself the signal: `redactedFields` is non-empty
// exactly when a secret-shaped field held something other than the test value,
// which is the condition A0/A3 assert against.

/** Field names whose values are treated as credentials. */
export const SECRET_KEY_PATTERN = /key|token|secret|password|credential/i;

/**
 * The single secret-shaped value that may be rendered verbatim: the literal
 * `test/config/environment.ts` pins. It is in the repo, in the docs and in the
 * published README, so it discloses nothing.
 */
export const TEST_AUTH_KEY = 'TEST_AUTH_KEY';

/** What a redacted value renders as. Deliberately not the empty string. */
export const REDACTED = '<redacted non-test secret>';

export interface RedactionResult<T> {
  /** A deep copy with every non-test secret-shaped string replaced. */
  value: T;
  /** Dotted paths of the fields that were replaced, in encounter order. */
  redactedFields: string[];
}

function walk(input: unknown, path: string, redactedFields: string[]): unknown {
  if (Array.isArray(input)) {
    return input.map((item, i) => walk(item, `${path}[${i}]`, redactedFields));
  }

  if (input === null || typeof input !== 'object') return input;

  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    const isSecretShaped = SECRET_KEY_PATTERN.test(key);

    if (isSecretShaped && typeof value === 'string' && value !== '' && value !== TEST_AUTH_KEY) {
      redactedFields.push(childPath);
      out[key] = REDACTED;
      continue;
    }

    out[key] = walk(value, childPath, redactedFields);
  }

  return out;
}

/**
 * Deep-copy `input`, replacing the value of every secret-shaped field that does
 * not hold the sanctioned test literal.
 */
export function redactSecrets<T>(input: T): RedactionResult<T> {
  const redactedFields: string[] = [];
  const value = walk(input, '', redactedFields) as T;

  return { value, redactedFields };
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Render a socket address for logging. A loopback address is printed as-is
 * because it is the expected value and seeing it is the point. Anything else is
 * withheld: an off-machine address is by definition not something this suite
 * chose, may carry credentials in its userinfo component, and naming the
 * internal host is the smaller half of the same disclosure.
 */
export function safeAddress(address: unknown): string {
  if (typeof address !== 'string') return '<non-string address withheld>';

  let hostname: string;

  try {
    hostname = new URL(address).hostname;
  } catch {
    return '<unparseable address withheld>';
  }

  return LOOPBACK_HOSTS.has(hostname) ? address : '<non-loopback address withheld>';
}

/**
 * Render captured wire frames for a failure message.
 *
 * The frames a decoy records are auth frames -- `{"request":"auth","data":
 * {"authKey":"..."}}` -- so an assertion that prints them raw is BLOCKER-2 in a
 * second location: on a real regression the credential in that frame is the
 * developer's ambient `SOCKET_AUTH_KEY`. Today the guards displace it with a
 * sentinel in the child env, but that is a property of the test's env setup
 * rather than of the rendering, and it is not something a future edit will keep
 * in mind. Redacting here makes it a property of the rendering.
 */
export function redactFrames(frames: readonly string[]): string[] {
  return frames.map(frame => {
    try {
      return JSON.stringify(redactSecrets(JSON.parse(frame)).value);
    } catch {
      // Not JSON -- an encrypted or binary frame. Its length is the only thing
      // safe to report, and it is the only thing an assertion needs.
      return `<unparseable ${frame.length}-byte frame>`;
    }
  });
}
