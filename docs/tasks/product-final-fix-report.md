# Final consolidated fix report

Date: 2026-11-16. Workspace: `F:/project love/AgentBrake`. Scope: the final-review findings CR-001 and CR-002 only, local synthetic fixtures. No subagents, dependency changes, UI changes, Git operations, deployment, external service access, or real environment/credential/data inspection.

## Status and stopping conditions

**Implementation and focused verification complete; final local acceptance remains pending the parent's scoped re-review and matching-source release run.** This report does not claim PostgreSQL runtime, persistent-product restart, complete release, independent clean-machine, or production acceptance.

Acceptance for this wave was: demonstrate the original environment-file read and missing authenticated attribution; make the smallest shared launcher/store/API repairs; verify the actual team API, cross-owner revocation, forged identity resistance, rejected-request state invariants, safe JSON/CSV export, and existing approval/race behavior; extend durable PostgreSQL and product-restart acceptance checks for the parent's final run. Those implemented checks are described below with their actual execution limits.

Baseline: `.agentbrake-local/final-fix-base`, 140 manifest files, source hash `ed21d6ae1f9043b4e2fb0575c2a75395d9d9aa10397e3c3813052c5aa77ba79b`. Final source at report creation: **144 files**, source hash **`f257840c3f5196b19cdbfdec33059789826b862a682026159a6e39a2cb22887f`**. The report is outside the source manifest. A read-only hash comparison against the preserved baseline found exactly the 17 source paths listed below.

## Causes and changes

### CR-001: Compose environment-file discovery

Demonstrated cause: the actual `composeProduct()` child inherited `COMPOSE_ENV_FILES`; default Compose dotenv discovery was also enabled. The separate Docker CLI configuration directory does not affect Compose's dotenv parser. The isolated verifier used the same inherited-child-environment pattern.

Added `scripts/compose-environment.mjs`, used at the actual child-process boundary by both `dockerProduct()` and the isolation verifier. It removes inherited environment-file/discovery overrides and unrelated Compose file/profile selectors, then sets `COMPOSE_DISABLE_ENV_FILE=true`. It compares selector names case-insensitively. The generated project name and explicit Compose file/project arguments remain in their existing callers. Intentional `RESULT_RETENTION_HOURS`, `LOG_MAX_SIZE`, and `LOG_MAX_FILES` shell inputs are preserved.

The Compose regression uses real `docker compose config --format json`, the local-engine argument on Windows, and project-local empty Docker configuration. It starts no containers. It proves:

- The actual product launcher ignores an inherited selector pointing to a newly created malformed synthetic env file, even with an inherited discovery-enable setting.
- A disposable directory's ordinary `.env` canary affects unprotected Compose configuration, establishing that the probe would detect discovery.
- The shared environment used by both launchers ignores that canary and retains the expected retention/log defaults.
- Malformed default `.env` content fails the unprotected control case and is ignored by the protected case.
- Explicit supported retention/log inputs still take effect.

Only test-created temporary directories/files are written and removed; their resolved cleanup parent/name are checked before recursive removal. No existing `.env` is inspected or overwritten. `scripts/test.mjs` and `scripts/verify-stage1.mjs` now collect `.test.mjs` as well as `.test.ts`, so the release native test gate includes the Compose regression. The parent explicitly extended ownership to those two collector changes.

### CR-002: authenticated human attribution

Demonstrated cause: access middleware already authenticated the operator, but the store mutation interface and callers omitted this trusted context. Store audit writes therefore could not distinguish the operator from the task owner.

Added a small optional `AuditContext` containing actor ID, tenant, and the existing server-generated request correlation ID. A shared projection serializes only those fields. The control API passes context derived from `res.locals.actor` and `res.locals.correlationId` for agent creation/pause/resume, grant issue/revoke, policy updates, and stop/resume. The simulation creation caller does the same. The parent extended ownership to the minimal equivalent projection for Demo Lab's backend creation caller in `server/control-experience.ts`.

Both stores append attribution inside each existing audit payload. Existing policy fields remain at their previous positions. PostgreSQL mutation/audit transactions and locking order remain intact. Direct internal calls without a context are explicitly labeled `{source:"internal"}`; creation with an existing trusted `ownerId` compatibility input records that owner/local tenant. No authenticated creation path relies on that fallback. Revocation uses the actual authenticated revoker, rather than the grant's `human_owner`.

Approval rejection already had an authenticated durable receipt, but its audit event omitted the identity. For consistency within the same family, `approval.blocked` now projects actor ID/tenant from that existing receipt within the existing atomic transition. No approval authorization, receipt generation, proof, or race behavior was changed.

The reusable actual-loopback team API fixture covers Alice (administrator), Bob (operator), and a viewer. It verifies all eight successful mutation events and their server-generated correlations, Bob revoking Alice's grant, rejected body actor fields, ignored forged actor/correlation headers, insufficient role/missing CSRF leaving settings/agents/success-mutation audit unchanged, zero target dispatches, and JSON/CSV preserving actor attribution while excluding known fixture operator keys, issued agent token, session tokens, and CSRF values. Existing approval tests retain their target-state and race assertions; the new rejection assertion verifies the reviewer identity and no target mutation.

## Durable acceptance additions awaiting parent execution

`tests/stage2/postgres-control.test.ts` now runs the same real two-operator API/export fixture on its disposable PostgreSQL store, closes it, reopens PostgreSQL, and verifies that the exact attributed events and grant owner/revocation state survive. Its existing audit-INSERT permission failure test now uses trusted context for stop/policy/agent/grant/create mutations, tests grant issue and revoke explicitly, and verifies unchanged agent contents, settings/revision, policy history, audit rows, and agent count after rollback. Existing reservation quota/taint/action rollback and approval/rejection race checks remain.

`scripts/verify-product.mjs` now checks attributed creation and server correlation before the existing whole-installation restart, compares the stored audit export after restart, verifies CSV attribution/correlation, and has the actual operator revoke the administrator-owned task. It checks that revocation records the operator and policy/stop events record the administrator.

These PostgreSQL and full product-runtime additions were type/syntax checked, **not executed by this fix wave**. The parent owns their execution through the existing disposable release verifier. For direct isolation-verifier launcher evidence, the parent was advised to run the final release with `COMPOSE_ENV_FILES` selecting a newly generated malformed synthetic temporary file and `COMPOSE_DISABLE_ENV_FILE=false`, with cleanup of only that created canary afterward. This is an additional real-launch test and requires no real `.env` changes.

## Checks actually run

All commands ran from `F:/project love/AgentBrake`.

Fail-first evidence:

1. `node --import tsx --test tests/enforcement/control-audit.test.ts` — exit 1, **0 pass / 2 fail**. Actual successful API mutations had `details.actor === undefined`; direct internal calls also lacked the explicit internal attribution.
2. `node --test tests/enforcement/compose-environment.test.mjs` — exit 1, **0 pass / 1 fail** against the unchanged launcher. A rerun exposing the captured Docker stderr confirmed the precise cause: `failed to read .../selected.env: line 1: unterminated quoted value`. The path was a newly generated test directory. The first run had the same failure but displayed only the wrapper's generic Docker exit error; only the test failure display was refined before the rerun.
3. `node scripts/with-opa.mjs --import tsx --test --test-name-pattern='human rejection audit' tests/enforcement/team-approvals.test.ts` — exit 1, **0 pass / 1 fail**, missing reviewer actor in the real `approval.blocked` event.
4. `node scripts/with-opa.mjs --import tsx --test --test-name-pattern='Demo Lab' tests/enforcement/control-experience.test.ts` — exit 1, **0 pass / 1 fail**, trusted owner was already attributable via the compatibility fallback but server correlation was absent from the Demo Lab creation audit.

Passing focused checks:

1. Initial audit regression rerun — **2 pass / 0 fail / 0 skip**. Actual product Compose regression rerun — **1 pass / 0 fail / 0 skip**.
2. Expanded `node --test tests/enforcement/compose-environment.test.mjs` — **2 pass / 0 fail / 0 skip**, including the implicit discovery canary and malformed-default control case.
3. Intermediate control/approval suite across control-audit, team-approvals, control-experience, and approval-preview — **13 pass / 0 fail / 0 skip**.
4. Final, after all source edits and formatting:

   ```powershell
   node scripts/with-opa.mjs --import tsx --test --test-concurrency=1 tests/enforcement/control-audit.test.ts tests/enforcement/compose-environment.test.mjs tests/enforcement/team-approvals.test.ts tests/enforcement/control-experience.test.ts tests/enforcement/approval-preview.test.ts tests/enforcement/stage2-races.test.ts
   ```

   Exit 0, **17 pass / 0 fail / 0 skip**. Includes actual Compose parsing, authenticated team control/export, independent-review receipt/replay/race, rejected-review target state, Demo Lab attribution, target compare-and-set, policy-review race, and delayed rejection versus approval.
5. `node node_modules/typescript/bin/tsc --noEmit` — exit 0, including the new PostgreSQL API/reopen/rollback assertions. Run during implementation and again after the final source edits.
6. `node --check` individually for `scripts/compose-environment.mjs`, `scripts/product.mjs`, `scripts/verify-isolation.mjs`, `scripts/test.mjs`, `scripts/verify-stage1.mjs`, and `scripts/verify-product.mjs` — all exit 0 after final edits.
7. Existing project-cache Prettier **3.10.1** formatted all modified source files. The version was verified with the cached CLI's `--version`.
8. Read-only source-manifest generation and baseline content comparison — exit 0; final hash/count and exact changed list above. Existing frozen baseline and evidence were preserved.

Expected existing output messages during the focused tests were Node's experimental SQLite warning and the SDK's response-mode notification note; no test failures/skips were hidden. One initial read command guessed the singular `team-approval.test.ts` path and failed to find it; `rg --files tests` resolved the actual plural path before any relevant edit. This was a file-discovery miss, not a runtime failure or a failed fix attempt.

No PostgreSQL runtime suite, container lifecycle verifier, full release, browser/build/security suite, or external integration was run in this wave. The parent's final release is the required next gate; earlier baseline release success is not evidence for this changed source.

## Changed source paths

1. `scripts/compose-environment.mjs` (new)
2. `scripts/product.mjs`
3. `scripts/verify-isolation.mjs`
4. `scripts/test.mjs` (parent-approved collector extension)
5. `scripts/verify-stage1.mjs` (parent-approved collector extension)
6. `scripts/verify-product.mjs`
7. `server/control-store.ts`
8. `server/store.ts`
9. `server/postgres-store.ts`
10. `server/app.ts`
11. `server/control-experience.ts` (parent-approved backend caller extension)
12. `tests/enforcement/control-audit-fixture.ts` (new reusable API fixture)
13. `tests/enforcement/control-audit.test.ts` (new)
14. `tests/enforcement/compose-environment.test.mjs` (new)
15. `tests/enforcement/team-approvals.test.ts`
16. `tests/enforcement/control-experience.test.ts`
17. `tests/stage2/postgres-control.test.ts`

Remaining gaps: direct full isolation-verifier execution under the synthetic inherited selector, real PostgreSQL execution/reopen/rollback, and persistent-product restart assertions await the parent's release gate. No additional demonstrated source defect remains from this wave's focused checks. External-human security review, live GitHub, production, and independent clean-machine validation remain outside this local scope.
