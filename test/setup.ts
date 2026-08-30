// Custom test setup for stonyx-sockets.
//
// Works around a race in stonyx@0.2.3-beta.52's cli/test-setup.js:
// that setup calls `new Stonyx(config, cwd)` but does NOT await
// `Stonyx.ready`, so qunit proceeds to load test files before the
// async `Stonyx.start()` has flipped `Stonyx.initialized = true`.
// Integration tests that touch stonyx internals at module load
// then hit the "Stonyx has not been initialized yet" getter guard.
//
// This custom setup mirrors stonyx's but awaits `Stonyx.ready`
// before returning. It runs as a `--import` loader, so its
// top-level-await keeps qunit's test-file loading blocked until
// Stonyx is fully initialized.
//
// It is also where the #45 isolation invariant is ENFORCED rather than merely
// asserted. `assertTestIsolation` runs here, after config resolves and before
// qunit loads a single test file, because the two drift scenarios that reopen
// #45 both hang the suite before it ever reaches
// `test/unit/config-isolation-test.ts`. See test/helpers/assert-test-isolation.ts.
import { pathToFileURL } from 'url';
import { assertTestIsolation } from './helpers/assert-test-isolation.js';

const cwd = process.cwd();

const { default: Stonyx } = await import('stonyx');
const { default: config } = await import(pathToFileURL(`${cwd}/config/environment.js`).href);

new Stonyx(config, cwd);
await Stonyx.ready;

const { default: resolved } = await import('stonyx/config');

assertTestIsolation({
  sockets: (resolved as Record<string, unknown>).sockets,
  cwd,
  nodeEnv: process.env.NODE_ENV,
});
