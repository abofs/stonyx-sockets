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
// TWO LAYERS KEEP A CREDENTIAL OUT OF THIS OUTPUT, AND BOTH ARE LIVE.
// --------------------------------------------------------------------------
// `NODE_ENV=test` is not part of `PROBE_ARGS`; the harness sets it separately in
// the `spawnSync` env object. A developer who copies the invocation out of
// `config-isolation-test.ts` therefore runs it WITHOUT the override merged, and
// this file used to print the real ambient `SOCKET_AUTH_KEY` to stdout -- in a
// public repo, in a paste-into-the-issue context.
//
//   Layer 1: `test/setup.ts` now refuses to boot un-isolated at all, so that
//            hand-run is rejected before this file executes.
//   Layer 2: redaction here, which is what covers the case layer 1 cannot see:
//            an isolated boot (NODE_ENV=test, override present, address pinned
//            to loopback) whose `authKey` pin has been dropped. That is the
//            BLOCKER-2 mutation, and it reaches this printer.
//
// Redaction is therefore applied unconditionally rather than gated on the
// environment: the dangerous run is precisely the one where the environment is
// not what was expected.
import config from 'stonyx/config';
import { redactSecrets } from './redact.js';

const MARKER = '__RESOLVED_SOCKETS_CONFIG__';

const sockets = (config as Record<string, unknown>).sockets;
const { value, redactedFields } = redactSecrets(sockets);

// `redactedFields` travels with the payload so the caller can assert on the
// FACT that a secret-shaped field held a non-test value without ever seeing it.
console.log(MARKER + JSON.stringify({ sockets: value, redactedFields }));
