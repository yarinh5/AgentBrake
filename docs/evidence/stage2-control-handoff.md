# PostgreSQL control/audit store handoff

## Scope and observed cause

This work is restricted to the isolated local `agentbrake_control_fixture` database. No `.env`, existing data directory, external destination, Git operation, or Docker start was used by this implementation task.

The original SQLite execution path performed claim, grant consumption, taint, and `execution.started` audit as separate operations. That contract cannot prevent concurrent PostgreSQL workers from overspending a grant or preserve rollback if the pre-dispatch audit insert fails. The shared `ControlStore.reserve` contract moves that boundary into one database transaction. Gateway authorization remains in the caller's synchronous check, and no connector/upstream call occurs inside this backend.

## Implementation and integration contract

- `PostgresStore.open(url, { reconcile?: boolean })` implements `ControlStore`; all methods are asynchronous. Default `reconcile` is false. Only the exclusive startup owner should request `reconcile: true`; it marks queued/executing records unknown with audit events, retains quota already consumed, and never retries an upstream operation.
- Connections accept only PostgreSQL URLs for `localhost`, `127.0.0.1`, `[::1]`, or `control-db`, exact database `agentbrake_control_fixture`, and login `control_runtime`. URI query overrides and other identities/destinations are rejected. Startup rejects unsafe runtime privileges and an invalid audit chain before reconciliation.
- `reserve` locks settings, then the latest agent, then the persisted action. It requires expected pending/queued status and matching identity, runs the caller check against those rows, and atomically commits blocked state plus audit, or executing state plus one quota consumption, database-read taint, and audit. Action objects are changed only after commit succeeds.
- The persisted envelope is authoritative. A fresh caller `policyDecisionId` is carried through approval re-evaluation. The Gateway check owns expected envelope, grant, policy, expiry, destination, and authority comparisons.
- `changeAgent` patches the latest locked row. Same-grant changes retain the maximum consumed quota, so a stale revocation cannot restore consumed calls. An explicitly new grant ID uses the administrator-provided counter. All agent creation/patches and pause/policy changes include their audit event in the same transaction.
- Policy document and revision are read in one settings query and updated transactionally. PostgreSQL sequences may contain gaps after failed transactions; revisions need not be consecutive.
- A shared transaction advisory lock serializes every audit append. `TEXT` preserves the exact `JSON.stringify` bytes; the chain remains SHA-256 of previous hash plus serialized event, with `genesis` as its initial link. `(agent_id,request_id)` is unique.
- The runtime role has only required table rights: audit INSERT/SELECT and sequence USAGE, no audit UPDATE/DELETE/TRUNCATE, no database/schema CREATE or temporary objects, no ownership, superuser, role creation, database creation, replication, or BYPASSRLS. Bootstrap/migration runs separately as `control_owner`.

Bootstrap mounts: `010-control-fixture.sh` in the PostgreSQL init directory, `001-control.sql` at `/opt/agentbrake-control/001-control.sql`, and runtime password at `/run/secrets/control-password`. `POSTGRES_USER=control_owner`, `POSTGRES_DB=agentbrake_control_fixture`; the owner password must be a different secret. The dedicated test also needs that owner secret at `/run/secrets/control-owner-password` to inject database permission failures and audit tampering; the application must not receive it.

## Acceptance and checks actually run

Acceptance requires real local PostgreSQL evidence for two-store reservation races, last-call quota, taint/revoke/pause rechecks, replay uniqueness, failed-audit rollback, policy/revision pairing, denied runtime history mutations and DDL, concurrent hash chain integrity, persistence, explicit restart recovery, and tamper rejection before recovery.

- Passed: focused TypeScript compile of backend and dedicated test using `node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --esModuleInterop --target ES2022 --module NodeNext --moduleResolution NodeNext server/postgres-store.ts tests/stage2/postgres-control.test.ts`.
- Passed: direct backend calls rejected four prohibited URL configurations before connection (remote hostname, other database, owner login, and URI host override).
- Initial dedicated test failed because the PostgreSQL backend module did not exist, establishing the missing implementation. This was a module-load failure, not a demonstrated PostgreSQL concurrency failure.
- After implementation, a native dedicated invocation failed explicitly because `POSTGRES_CONTROL_TEST=1` was absent. This is intentional: the dedicated run cannot silently skip and cannot load fixture secrets or connect unless that flag is present.
- **Not yet run:** actual PostgreSQL integration cases. Docker orchestration belongs to the parent task and was not started here. Run inside the authorized fixture with both test secret mounts: `POSTGRES_CONTROL_TEST=1 node --import tsx --test tests/stage2/postgres-control.test.ts`.
- Full repository tests were not run during concurrent shared-file edits, per parent coordination. The native runner must explicitly exclude this dedicated PostgreSQL test.

## Status and limits

Implementation and focused compile complete; real PostgreSQL acceptance remains pending. This is local control-store work, not proof of live integrations or full product completion. Audit tampering by the separate bootstrap owner is detectable by the hash chain but the local chain is not an external tamper-proof anchor. Legacy full-record `saveAgent`/`saveAction` methods retain their compatibility contracts; control mutations should use atomic `changeAgent`, and dispatch must use `reserve`.
