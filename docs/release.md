# Release Process

This package follows the Stonyx shared release pipeline managed by
[stonyx-workflows](https://github.com/abofs/stonyx-workflows). The sections below separate what is
directly verifiable from this repo's own files from what lives in that separate, out-of-scope repo.

**npm package:** `@stonyx/sockets`

## Verified from this repo

### 1. CI gate (`.github/workflows/ci.yml`)

- Runs on `pull_request` targeting `dev`, `main`, or `fix/**`.
- Delegates entirely to the reusable workflow `abofs/stonyx-workflows/.github/workflows/ci.yml@main`
  (no local steps defined in this repo) — identical structure to stonyx-discord's `ci.yml`.
- `permissions: contents: read`; concurrency is grouped per ref with `cancel-in-progress: true`.

### 2. Pre-publish safety net (`package.json`)

- `"prepublishOnly": "npm test"` — note this differs from stonyx-discord's `"npm run build && npm test"`:
  here the build step is folded into `test` itself (`"test": "pnpm build && pnpm build:test && ..."`),
  so `prepublishOnly` still runs a full `tsc` build of both `src/` and `test/` before publishing; it is
  not skipping the build, just not naming it separately.
- Verified directly by reading `package.json` and by reproducing locally: `pnpm test` (86/86 passing,
  see [index.md](./index.md#build-run-test)).
- `publishConfig` additionally sets `"provenance": true`, which is not present in stonyx-discord's
  `package.json`. This requests npm provenance attestation at publish time; verifying it actually
  produces a signed attestation would require inspecting an actual publish run/npm registry entry,
  which is out of scope here (infrastructure/credentials).

### 3. Publish workflow (`.github/workflows/publish.yml`)

- Byte-for-byte the same trigger/job structure as stonyx-discord's `publish.yml`: triggers on
  `repository_dispatch` (type `cascade-publish`), `workflow_dispatch` (required `version-type`
  choice of `patch`/`minor`/`major`, optional `custom-version`), `pull_request`
  (`opened`/`synchronize`/`reopened` against `dev`/`main`), and `push` to `dev`/`main`.
- `permissions: contents: write, id-token: write, pull-requests: write`.
- Two jobs, both delegated to reusable workflows with `secrets: inherit`:
  1. `publish` → `abofs/stonyx-workflows/.github/workflows/npm-publish.yml@main`, given
     `version-type` and `custom-version` as inputs.
  2. `cascade` (`needs: publish`) → `abofs/stonyx-workflows/.github/workflows/cascade.yml@main`,
     given `publish`'s declared outputs `package-name` and `published-version`.
- Concurrency group is `cascade-update` for `repository_dispatch` runs, otherwise `publish-<ref>`, with
  `cancel-in-progress: false`.

### 4. Security audit (`.github/workflows/security-audit.yml`)

- Runs on a daily cron (`0 8 * * *`) and on manual `workflow_dispatch`.
- Delegates to `abofs/stonyx-workflows/.github/workflows/security-audit.yml@main`.
- `permissions: contents: read`.

## Not verifiable from this repo (flagged, not guessed)

The actual implementation of versioning, npm authentication/publishing (including how the
`id-token: write` permission is used for the `provenance: true` publish), and cascading dependent-package
releases lives in the separate `abofs/stonyx-workflows` repository referenced by the reusable workflows
above. That repo is out of scope for this onboarding pass (a different repository, and release
infrastructure is explicitly off-limits), so it was not fetched or read. Concretely unverified here:

- What `npm-publish.yml` actually does step-by-step (semver mapping from `version-type`/`custom-version`,
  npm auth mechanism, whether/how provenance attestation or a `CHANGELOG`/git tag is produced).
- What `cascade.yml` does with `package-name`/`published-version` — presumably it fires a
  `cascade-publish` `repository_dispatch` at dependent packages (this repo's own `publish.yml` listens
  for exactly that event type), but that mechanism is defined in `stonyx-workflows`, not here.
- What the `security-audit.yml` reusable workflow actually audits and what it does on failure.
- Any branch protection rules that make the CI gate mandatory before merge, and any required secrets —
  both are infrastructure/administration and out of scope for this doc.

## Source of truth for the shared pipeline

See [stonyx-workflows/docs/release.md](https://github.com/abofs/stonyx-workflows/blob/main/docs/release.md)
for the full release process, versioning scheme, and cascade publishing details that this repo's
workflows delegate to.
