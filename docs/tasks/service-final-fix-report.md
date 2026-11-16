# Consolidated final service repair — implementation handoff

2026-11-16. The FINAL-1 and FINAL-2 repairs are implemented. **Source is stable** at `d036bd48e5521a477fb407cf71a8692aee31b7275da0d170fa76e64ca2f66700` (172 source files; 180 files selected for packaging). This is a focused local repair result, not a final release, live integration or production-readiness claim.

## FINAL-1: interrupted restore fails closed

Cause: restore wrote a normal installation manifest before copying volumes, but authority suspension and audit validation occurred later in `recovery.ts`. A build/recovery failure removed `maintenance.lock` during cleanup without retaining an ordinary-start barrier. The normal start path then migrated and started the full application without requiring completed recovery.

Change: `restoreProduct` writes `recovery-incomplete.json` immediately after exclusively creating its destination directory, before copying configuration or creating/copying any volume. `startProduct` checks that marker before preparation, build, migration or application startup and rejects while it exists. Unexpected marker inspection errors also propagate rather than permitting start. Restore removes the marker only after the existing recovery command has succeeded; that command suspends authority, invalidates restored human tokens, revokes grants, blocks pending reviews and verifies the recovered audit chain before returning successfully. Failure cleanup never removes the marker. The destination and installation manifest remain available for diagnosis, and a second restore to that destination still fails its existing exclusive-directory guard. There is no bypass option or automatic partially applied recovery retry. SERVICE_OPERATIONS documents the marker separately from a stale maintenance lock.

Acceptance and evidence:

- Fail-first command: `node --test tests/enforcement/product-recovery.test.mjs tests/enforcement/source-package.test.mjs`. `.agentbrake-local/service-final-fix-red.log` records **4 failures / 1 pass** before implementation: ordinary start issued full application up after each of the two injected restore failures; success lacked a persistent barrier; inventory omitted the root build entry. The ordinary non-restore start control already passed.
- Final focused run of the same command: **5/5 passed**. Build failure is injected specifically at `build control-api`, after all three volume-copy operations and migration, before recovery; recovery failure is injected in the recovery command. In each case the maintenance lock is removed, the persistent marker remains, stop is requested, and subsequent ordinary start issues **zero Docker commands**, including no gateway/control/ingress startup. Retry cannot overwrite the retained destination. The successful path retains the marker through creation, copies and recovery, clears it before full startup, and ordinary non-restore startup still works.
- Scope: the tests evaluate the **actual unmodified maintenance source** using VM modules, real filesystem writes, real product configuration/preparation, real backup encryption/authentication/validation and real migration file reads. Only Docker transport is simulated for deterministic faults. The VM experimental warning is captured in the child process; it is not hidden by a production setting. These tests do **not** establish live PostgreSQL recovery semantics, data/audit preservation or old-authority denial. The real installed happy-path restore gate remains root-owned and required after this source revision.

## FINAL-2: source distribution builds after extraction

Cause: package-release selected source-manifest paths plus documentation, but sourceManifest omitted Vite's required root `index.html` and `public/` assets. Building in the original checkout did not detect missing package inputs.

Change: sourceManifest now hashes/includes the actual root entry and public tree. The existing package-file selection is shared without behavioral changes in `scripts/package-inventory.mjs`, so regression/staging checks consume the same selection as `package-release.mjs`. The release script's matching-source and lifecycle gates remain unchanged; selecting an inventory does not create a release or write PASS evidence.

Acceptance and evidence:

- The focused test checks real source hashes for `index.html` and `public/favicon.svg`, checks their presence in the actual package inventory and checks runtime/dependency path exclusions.
- `node tests/enforcement/service-package-build.mjs`: **PASS_FOCUSED_STAGED_EXTRACTION_BUILD**, exit 0. Selected all 180 package files, copied them to a fresh stage, created a real tar.gz, extracted into a fresh sibling tree and verified every selected file's SHA-256. Added separate same-machine root/dashboard `node_modules` junctions **after extraction**, ran the extracted tree's `npm run build` (`tsc --noEmit && vite build`) successfully, and checked built `dist/index.html` plus the exact favicon bytes. No dependency installation/update or network operation was performed. Source hash was checked unchanged after the build.
- Evidence: `.agentbrake-local/service-package-build-cHsgON/result.json`, `build.log`, `stage/SOURCE-STAGING.json` and `unverified-source-staging.tar.gz`. Staging archive SHA-256: `aa8b9845b90a637145b046e0edc741560fd0486fd94534918d25073af07983b9`.
- This archive explicitly says **UNVERIFIED_SOURCE_STAGING_ONLY**. Existing release evidence is copied unchanged and does not attest this candidate. No `RELEASE.json`, forged PASS release evidence, final release archive or release-package pointer was generated by this check. No runtime `.env`, keys/data, dependency tree or model cache is included. This is **same-machine dependency reuse**, not independent clean-machine validation.

## Changed files

- `scripts/product-maintenance.mjs`
- `scripts/source-manifest.mjs`
- `scripts/package-release.mjs`
- `scripts/package-inventory.mjs` (new)
- `tests/enforcement/product-recovery.test.mjs` (new)
- `tests/enforcement/service-restore-orchestration.mjs` (new)
- `tests/enforcement/source-package.test.mjs` (new)
- `tests/enforcement/service-package-build.mjs` (new)
- `docs/SERVICE_OPERATIONS.md`
- `docs/tasks/service-final-fix-report.md` (this report)

Root's real integration helpers, existing product-local data and all other work are untouched. No agents, workspace Git operations/delivery, external targets, dependency changes or live Docker operations were used by this worker. The native test suite exercises its existing disposable synthetic Git fixtures.

## Remaining gates and stopping condition

The two focused acceptance conditions above are met. One focused rereview, the final matching-source full release (including the real successful restore/data/audit/old-authority acceptance), gated final package/extraction check and preserved installation upgrade remain with root. Full real installed interrupted-restore fault injection was not performed here; deterministic simulated Docker transport is the failure-stage evidence. Independent clean-machine validation, external human security signoff and live GitHub integration remain open as previously documented. No further source changes are planned.

Additional verification already started before root requested no further broad runs: `npm test` completed with **exit 0; 145 passed / 0 failed / 4 skipped of 149 Node tests**. The four skips explicitly require the dedicated PostgreSQL target runner (`POSTGRES_TARGET_TEST=1`), which was not enabled here. Log: `.agentbrake-local/service-final-fix-npm-test.log`. This invokes the native/OPA test runner, not full-stage/release verification; it does not supersede root's isolated PostgreSQL or complete release gates.
