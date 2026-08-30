// Subprocess probe for stonyx-sockets#45.
//
// Booted with the real `test/setup.ts` loader (`--import ./test/setup.ts`), so
// it resolves config through exactly the path `pnpm test` uses: Stonyx.start()
// reads `config/environment.js`, namespaces it under `sockets`, then merges
// `test/config/environment.ts` on top when NODE_ENV=test.
//
// Prints the fully resolved `config.sockets` on one line behind a marker so the
// caller can parse it out of surrounding framework/log noise.
import config from 'stonyx/config';

const MARKER = '__RESOLVED_SOCKETS_CONFIG__';

console.log(MARKER + JSON.stringify((config as Record<string, unknown>).sockets));
