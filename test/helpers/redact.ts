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
//
// THE ONE VALUE-SHAPE RULE, AND WHY IT IS THE ONLY ONE
// --------------------------------------------------------------------------
// Key-name matching misses a credential that is not under a matching key name,
// and the resolved socket config has exactly one field that can carry one:
// `address`. A URL authority may hold userinfo, so an ambient
// `SOCKET_ADDRESS=ws://svc:<secret>@127.0.0.1:2667` is a credential under the
// key `address`, which the pattern above does not match. That was measured: the
// secret reached stdout twice, once through `safeAddress` (which returned a
// loopback address verbatim) and once through A0's `deepEqual` diff.
//
// So `stripUserinfo` below is a VALUE-shape rule, applied to every string
// whatever its key, and it is deliberately the only one. A general
// "looks-secret-shaped" heuristic would miss a short key and would make A1/A3
// vacuous the moment it fired on the pinned test literal; userinfo is
// structural rather than heuristic -- the `@` in an authority means exactly one
// thing -- so it can be recognised without guessing.
//
// WHAT THIS HELPER STILL DOES NOT REDACT
// --------------------------------------------------------------------------
// State the boundary rather than let a reader infer a guarantee that is not
// here:
//   * A non-string value under a matching key. `{ authKeys: ['a', 'b'] }`
//     recurses into the array and returns the items verbatim, because an array
//     element carries no key to test. Only the userinfo rule reaches them.
//   * A secret under a key outside `SECRET_KEY_PATTERN`. Note that `authData`
//     does NOT match it, and it is a free-form object in the resolved config.
//     A12 closes the drift half of that -- a new environment read must be
//     declared -- but nothing closes the rendering half.
// Adding a config key that can hold a credential means extending this helper in
// the same change.

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

/** What the userinfo component of a URL renders as once stripped. */
export const REDACTED_USERINFO = '<redacted userinfo>';

/**
 * Replace the userinfo component of a URL-shaped string, leaving every other
 * character of the original untouched. Returns the input unchanged when there
 * is no userinfo to strip, so callers can use identity to detect a hit.
 *
 * The authority is sliced out of the ORIGINAL string rather than rebuilt from
 * `URL` components, because `new URL('ws://localhost:2667').href` normalises to
 * `ws://localhost:2667/`. A helper that silently added a trailing slash would
 * change what A0/A1 deep-equal against and turn a rendering fix into a test
 * failure with an unrelated-looking diff.
 */
export function stripUserinfo(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return value;
  }

  if (!url.username && !url.password) return value;

  const schemeEnd = value.indexOf('://');

  // Parsed as a URL but is not `scheme://authority` -- nothing safe to slice.
  if (schemeEnd === -1) return REDACTED;

  const authorityStart = schemeEnd + 3;
  const delimiter = /[/?#]/.exec(value.slice(authorityStart));
  const authorityEnd = delimiter ? authorityStart + delimiter.index : value.length;
  const authority = value.slice(authorityStart, authorityEnd);
  const at = authority.lastIndexOf('@');

  // `username`/`password` were non-empty, so the authority has an `@`. If it
  // somehow does not, withhold the whole value rather than return it verbatim.
  if (at === -1) return REDACTED;

  return (
    value.slice(0, authorityStart) +
    REDACTED_USERINFO +
    authority.slice(at) +
    value.slice(authorityEnd)
  );
}

export interface RedactionResult<T> {
  /** A deep copy with every non-test secret-shaped string replaced. */
  value: T;
  /** Dotted paths of the fields that were replaced, in encounter order. */
  redactedFields: string[];
}

function walk(input: unknown, path: string, redactedFields: string[]): unknown {
  // The value-shape rule, applied whatever the key -- including to array
  // elements, which have no key to match on at all.
  if (typeof input === 'string') {
    const stripped = stripUserinfo(input);

    if (stripped !== input) redactedFields.push(path);

    return stripped;
  }

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
 * Render a socket address for logging. A loopback address is printed with its
 * userinfo stripped, because the host is the expected value and seeing it is
 * the point while the userinfo is a credential. Anything else is withheld
 * whole: an off-machine address is by definition not something this suite
 * chose, and naming the internal host is the smaller half of the same
 * disclosure.
 *
 * Userinfo is stripped on BOTH branches. An earlier version named the userinfo
 * hazard in this comment and then handled it only on the non-loopback branch,
 * so `ws://svc:<secret>@127.0.0.1:2667` -- which the boot guard permits, its
 * hostname being loopback -- printed the credential verbatim.
 */
export function safeAddress(address: unknown): string {
  if (typeof address !== 'string') return '<non-string address withheld>';

  let hostname: string;

  try {
    hostname = new URL(address).hostname;
  } catch {
    return '<unparseable address withheld>';
  }

  return LOOPBACK_HOSTS.has(hostname) ? stripUserinfo(address) : '<non-loopback address withheld>';
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
