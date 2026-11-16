# Scoped production image review

Status: review and fix inspection complete; open findings: Critical 0, Important 0, Minor 0. The one original Important recovery regression is resolved in the inspected code and focused orchestration coverage. Actual Docker recovery and final exact-source release evidence remain separate pending acceptance checks.

## Scope and evidence

Read ADR 0006 and the production-plan ledger, then inspected the minimal runtime, PostgreSQL and OPA Dockerfiles, Compose/profile selection, image locks, dashboard stages, dependency classifications, candidate image recording, scan binding and their focused tests. Followed the new profile into the existing backup/restore caller contract. Unchanged App/HTTPS enforcement was not re-reviewed. No tests, builds, service operations or external requests were run; only this report was written.

The inspected `.agentbrake-local/production-images-minimal.log` records an intermediate scan with zero high/critical findings in Node runtime/dashboard, but 26 in PostgreSQL and 1 in OPA; its result remains BLOCKED_VULNERABILITIES. That does not establish the result of the subsequent derived PostgreSQL/OPA builds. Final candidate, policy/recovery and image acceptance were still pending.

## Findings

### Resolved Important — Every minimal-profile backup was rejected by restore

Locations: `scripts/product-maintenance.mjs:355` (unchanged comparison now incompatible with its caller), `scripts/product-maintenance.mjs:261` (backup image identity), `scripts/product.mjs:33` (derived PostgreSQL identity).

Cause and effect: new installations use `runtimeProfile: minimal-v1`, so `productConfig` sets POSTGRES_IMAGE to `agentbrake-postgres:18-<recipe-hash>`. `backupProduct` records that value in `postgresImage`. `restoreProduct` nevertheless compares it exclusively with the upstream digest in `infra/local/images.lock.json`. A valid new minimal-profile backup therefore always throws “Restore requires the exact PostgreSQL image recorded by backup,” even when its profile, base and recipe are unchanged. This is a deterministic broken recovery contract, not an inferred vulnerability or a claim that data was corrupted. The rejection occurs before destination creation, preserving the existing fail-closed behavior but preventing recovery.

Smallest systematic fix: resolve the expected PostgreSQL image from the authenticated backup's installation profile using the same profile/recipe calculation as installation loading. Preserve the upstream digest comparison for legacy manifests, reject unknown profiles, and retain refusal when a base/recipe identity differs. Do not remove the image-match guard or silently upgrade a restored installation.

Acceptance: focused checks establish matching minimal and legacy identities and rejection of changed recipes/unknown profiles before destination mutation; the existing disposable real backup/restore acceptance path succeeds under minimal-v1 and preserves suspended restored authority. The final evidence must refer to the fixed source revision.

Fix disposition: inspected the follow-up delta only. `scripts/product.mjs` now exports `productImages(runtimeProfile)`, and both installation loading and `restoreProduct` use that resolver. Restore reads the profile from the authenticated backup, resolves the corresponding image identity and checks it before Docker operations or destination creation. Legacy manifests retain the upstream digest; minimal-v1 uses the same base/recipe hash as startup; unknown profiles still fail closed. The installed manifest preserves its source profile through the existing restore copy. The change addresses the demonstrated cause without weakening the image-match guard.

Inspected `tests/enforcement/service-restore-orchestration.mjs` and its seven-scenario runner. The harness uses actual maintenance/configuration/backup-validation code and filesystem with simulated Docker. Its new minimal-success scenario checks restored image/profile preservation; mismatched-image and unknown-profile cases assert no destination and no Docker/Compose calls. Legacy success and recovery barriers remain covered. The implementer reports the two new behavior checks failed before the fix and all seven scenarios passed afterward; no tests were rerun by this reviewer. Code/targeted-coverage disposition: resolved. Full real Docker restore remains pending, so this does not certify recovered database data or final release acceptance.

## Other reviewed conclusions

- The reduced runtime removes development dependencies and package-manager binaries while preserving the pinned tsx loader and fixture Git dependency. The root lockfile classifies tsx/esbuild as production dependencies consistently. Dashboard dependencies remain in its builder, with standalone output copied into the final image.
- Existing manifests without runtimeProfile select the legacy Node/runtime/PostgreSQL/OPA inputs. New manifests explicitly select minimal-v1; unknown profiles are rejected. This selection does not itself restart or migrate product-local.
- The derived PostgreSQL image retains the pinned base and database binaries, removing only gosu. Compose explicitly uses postgres and drops capabilities, so the documented root identity-switching branch is not the normal execution path. The base digest plus Dockerfile contents determine the derived tag. The follow-up restore fix now consumes the same shared identity, as described above.
- The OPA builder pins its Go image digest, source archive checksum and x/net version, verifies module contents and runs the HTML dependency test. The final scratch stage contains the binary, CA roots and license, with uid 1000. This is a separately maintained dependency rebuild; build success and a clean scan cannot substitute for real policy, approval and failure-path verification on that binary.
- Candidate reports now record concrete image IDs and references. The scanner resolves a reference, requires its ID to equal the candidate's exercised role ID, and exports the immutable ID rather than rescanning the mutable tag. The focused test covers a changed runtime tag and missing role. This closes the previously possible mismatch between a rebuilt tag and the image actually exercised by the candidate. Scan reports retain the candidate source hash; the readiness evaluator requires a match to current source, so an older candidate is not promoted to current-source evidence.
- Base images and OPA source/dependency inputs are pinned. `apk add` still obtains Git/CA packages from Alpine repositories at build time; identical source is therefore not a promise of byte-identical rebuilds. The new image-ID binding appropriately means an actual rebuilt image needs fresh candidate evidence and scanning. No broader reproducible-build redesign is requested for this scoped remediation.
- The prior review's token-expiry finding is addressed in the added source tests: malformed/expired/near-expiry/overlong responses, safety-cutoff refresh and failed refresh without a repository request are now represented. The parent reported nine adapter tests passing; this review did not rerun them. This is coverage closure, not a runtime security fix claim.

## Declined to judge

- Final exact-source image acceptance: follow-up report `ad15f490-3022-4a6b-8277-3135c7c1a5c7/container-scan.json` was inspected and records PASS_IMAGE_SCAN, zero high/critical across all four images, one lower-severity finding each in runtime/dashboard, and zero findings in PostgreSQL/OPA. Its candidate source `a41e6df8534a88a0c953fbbe65eb7a094cbb2ae9f73868bec116db5aefdf741b` differs from its recorded current source `d61c0fa92732dd23b6bd3b1f273e5ba5f4fe554f39b13cecd966045a693399e9`; it is useful remediation evidence, not final-source acceptance.
- Actual backup/restore and full policy behavior of the final repaired minimal profile: required real Docker execution evidence remains pending. The simulated transport harness does not establish those integration facts.
- Independent clean-host installation, live GitHub, production deployment, operational ownership or external human security approval: outside this scoped local review and still subject to their separate gates.

Completion: requested read-only scoped review complete. No application changes or runtime fixes were made by this reviewer.
