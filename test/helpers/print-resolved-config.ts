// Subprocess probe for stonyx-sockets#45.
//
// Booted with the real `test/setup.ts` loader (`--import ./test/setup.ts`), so
// it resolves config through exactly the path `pnpm test` uses: Stonyx.start()
// reads `config/environment.js`, namespaces it under `sockets`, then merges
// `test/config/environment.ts` on top when NODE_ENV=test.
//
// Prints the fully resolved `config.sockets` on one line behind a marker so the
// caller can parse it out of surrounding framework/log noise.
//
// SECRETS ARE REDACTED UNCONDITIONALLY, NOT ONLY UNDER THE HARNESS.
// --------------------------------------------------------------------------
// `NODE_ENV=test` is not part of `PROBE_ARGS`; the harness sets it separately in
// the `spawnSync` env object. A developer who copies the invocation out of
// `config-isolation-test.ts` therefore runs it WITHOUT it, the test override is
// never merged, and this file used to print the real ambient `SOCKET_AUTH_KEY`
// to stdout -- in a public repo, in a paste-into-the-issue context. Redaction is
// applied on every run rather than gated on the environment, precisely because
// the dangerous run is the one where the environment is not what was expected.
//
// The probe is deliberately NOT refused outside test mode: "what does my
// ambient config actually resolve to" is the exact question someone reaches for
// this file to answer, and with redaction applied the answer discloses nothing.
// It prints a banner instead, so a hand-run cannot be mistaken for a pinned one.
import config from 'stonyx/config';
import { redactSecrets, safeAddress } from './redact.js';

const MARKER = '__RESOLVED_SOCKETS_CONFIG__';

const sockets = (config as Record<string, unknown>).sockets;
const { value, redactedFields } = redactSecrets(sockets);

if (process.env.NODE_ENV !== 'test') {
  console.error(
    '[@stonyx/sockets config probe] NODE_ENV is not "test", so test/config/environment.ts was NOT merged. ' +
    `This is the AMBIENT config, not the pinned test config (address: ${safeAddress((sockets as Record<string, unknown>)?.address)}). ` +
    'Re-run with NODE_ENV=test to see what the suite actually resolves.'
  );
}

// `redactedFields` travels with the payload so the caller can assert on the
// FACT that a secret-shaped field held a non-test value without ever seeing it.
console.log(MARKER + JSON.stringify({ sockets: value, redactedFields }));
