# Private local service v0.2 — final whole-change review

2026-11-16. **Verdict: changes required. Two Important findings; no confirmed Critical or Minor findings.** This is the single consolidated broad review of the 45-file service delta from the verified a37811a7 snapshot to `fa431798f8129e0c76b3cb4c4510c720234fdb244a24af7947f899fcef9e14e3`. The current 165-file source manifest was independently recomputed and exactly matches the frozen manifest. No source edits, services, Git operations, external targets or additional agents were used. Only this report is written.

## Important findings

### FINAL-1 / P1 — Ordinary start can serve an incompletely recovered backup

Locations: `scripts/product-maintenance.mjs:406`, `:439`, `:441`, `:473`, `:486`; the missing startup guard is at `scripts/product-maintenance.mjs:188`, and maintenance cleanup is at `:75`.

Restore writes a normal usable installation manifest before copying volumes. After all three copies, migration and the control-image build still occur before `recovery.ts` pauses the control switch, revokes grants and invalidates outstanding human tokens. A normal failure at that build stops containers but retains the destination, and `withMaintenance` removes the lock. A subsequent documented `product.mjs start NAME` goes directly through migration and full application startup: it neither checks a durable incomplete-restore marker nor requires recovery completion. Thus a transient build failure followed by ordinary start can expose the restored active agents/grants, pending approvals and invitation/recovery tokens from the backup. This violates the explicit restore-before-traffic authority-suspension contract; it is not a malicious host administrator bypass.

Focused diagnostic: evaluated the **unchanged actual maintenance module** with Node VM modules and in-memory filesystem/Docker adapters, injecting one `build control-api` failure after three successful volume restores. The restore rejected and requested stop; its maintenance lock was removed; `recovery.ts` was never invoked. Calling the exported ordinary `startProduct(config, {build:false})` then successfully issued `--profile agent up -d --wait --wait-timeout 180`. Exit 0. Observed result:

```json
{"copiedVolumes":3,"restoreRejected":true,"maintenanceLockRemoved":true,"recoveryRan":false,"ordinaryStartIssuedFullApplicationUp":true}
```

This proves the orchestration gap with simulated IO; it is not a claimed live Docker exploit or a replacement for a real failure drill.

Required acceptance: persist an incomplete-recovery barrier before destination data can exist, and make ordinary startup fail closed while that barrier remains. Clear it only after successful recovery and audit validation. Preserve the stopped destination for diagnosis without permitting ordinary start to bypass suspension. Exercise a failure after copied volumes and before recovery, and a failure during recovery, followed by ordinary start; neither may start gateway/control/ingress with incomplete recovery. Successful fresh restore must still preserve target/audit state and deny old authority. A deliberate host-owner recovery procedure can remain separate; no broad lifecycle redesign is requested.

### FINAL-2 / P2 — Source package omits the build entry point

Location: `scripts/package-release.mjs:27-37`; contributing file selection is `scripts/source-manifest.mjs:30-45`.

The new packager takes the source-manifest paths plus eight documentation/evidence files. The manifest does not include root `index.html` or root `public/` assets, and the additions do not supply them. The package retains `npm run build` (`tsc --noEmit && vite build`), its default Vite config, compatibility UI sources and the release verifier. `scripts/verify-stage1.mjs:96-99` explicitly invokes the default Vite build, whose entry is root `index.html`. Therefore an extracted source package cannot run its own documented build/release gate; it also loses the referenced favicon. A successful build in the original checkout does not establish a usable source distribution.

Focused diagnostic: checked the frozen 165-file manifest and the complete package file-list construction; `index.html` is absent. Inspected the existing root entry, default Vite configuration, package command and release-verifier caller contract. No package was generated or full build rerun by this review. The Docker Next dashboard build does not use this file, so this finding specifically concerns the promised source distribution and bundled verification/compatibility paths, not an assertion that the Next installation cannot start.

Required acceptance: include required root build inputs/assets in the verified source/package inventory. Validate the actual packaged tree in a fresh local extraction, with dependencies supplied separately as documented, by running its build and checking its manifest includes the entry/assets. Keep runtime credentials/data/model caches excluded. Independent clean-machine validation remains an external gate; a same-machine fresh extraction is sufficient for this focused packaging regression.

## Reviewed contracts and evidence

Read `SERVICE_DESIGN.md`, `PLAN_SERVICE_OPERATION.md`, `SERVICE_OPERATIONS.md`, the binding PRD boundaries relevant to local execution/PD-05/PD-20, the whole supplied delta and relevant current callers. Review covered account/session issuance and invalidation, SQLite/PostgreSQL identity/audit transactions and last-admin serialization; UI/proxy methods, CSRF/origin handling and one-use links; migration startup, cold backup/encryption/archive bounds, collision ownership, recovery and diagnostics; package selection and release/source consistency; and new HTTP, browser, PostgreSQL and operations tests.

The identity report/rereview establishes the prior session-cap repair: reserve before committing setup/acceptance, prune only committed invalidation, preserve old sessions on rollback, and reclaim invalid revisions. The UI report/rereview establishes meaningful-value draft synchronization and real polling regression coverage. The operations report/rereview establishes shared encoded-size bounds and pre-initializer foreign-volume guards. The current source also removes the unsupported `create --no-deps` option after the recorded actual Docker failure. Those original findings are not reopened.

Evidence distinguished from this review's own checks:

- Prior reported identity verification: 15 focused HTTP/security tests and TypeScript pass; the plan records a real isolated PostgreSQL run with 22/22 tests and no skips, including account workflow/persistence and audit rollback.
- Prior reported UI repair verification: 7/7 managed browser workflows, production dashboard build and TypeScript pass, including the actual ten-second poll regression and rollback behavior.
- Operations rereviewer independently recorded 4/4 archive/encryption tests; real collision evidence covers all three foreign exact-name volumes without metadata/content damage. Those suites were inspected, not repeated here.
- During this review, `.agentbrake-local/service-managed-fixed.log` reached `PASS_LOCAL_SERVICE` for `c81e529a-bddc-43a8-86b1-1cf28359ec90`, including full restore, target/audit preservation and suspended authority on the successful path. This does not cover FINAL-1's failure-then-start path.
- At the latest read, `.agentbrake-local/service-release.log` had passed Rego, node tests, TypeScript, root build and dashboard build; the complete matching-source release had **not yet been observed complete**. Root owns its final result and cleanup/evidence verification. No full-release success is claimed here.
- Reviewer-executed checks were the narrow VM failure-path diagnostic, package inventory check and source-manifest equality check described above. No broad suites were repeated.

No additional confirmed security/correctness regression was identified in managed identity transaction handling, the constrained proxy, the reviewed UI flows, backup encryption/path validation or migration checksum enforcement. This statement is bounded by inspection and the listed evidence, not a guarantee of absence of defects.

## Scope left outside this verdict

Public hosting, real GitHub/production database targets, verified email/SMTP, billing, multi-tenancy, online/HA backup, PostgreSQL major-version upgrades and broad host/Docker-admin threat resistance are excluded by the approved local private installation design and user constraints. They are not deferred repairs for demonstrated defects in this change. The documented loss-of-all-administrators procedure remains a separately reviewed host-owner recovery operation; no hidden application bypass is expected.

External human security signoff, independent clean-machine validation and live GitHub integration remain explicit unfulfilled gates. Source packaging and existing-product upgrade acceptance remain root-owned delivery work; this review does not infer completion from a passing disposable happy path. Existing product-local data was not touched.

Completion: broad review complete; request one consolidated repair wave for FINAL-1 and FINAL-2, followed by focused rereview and the matching-source release/package evidence required by the plan.
