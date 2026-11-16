# Managed identity backend handoff

Status: scoped backend implementation complete; focused native HTTP checks and TypeScript pass. Real PostgreSQL, product UI and full release verification remain parent-owned and were not run by this agent. This is not a claim of live/full product completion.

## Demonstrated gap and approach

Before implementation, real `createApp` requests to `/api/setup` returned 404; stores had no durable identity state, and the only interactive sessions came from configured keys. The initial account tests failed 4/4 for missing routes/state. Existing approvals/role/CSRF/session contracts were read before changes. The implementation layers managed accounts over the existing session issuer and performs identity mutation plus safe audit in the existing database transaction. No alternative speculative fixes or failed patch approaches occurred.

Acceptance: exact brief endpoints; generated local administrator key only for bootstrap and preservation of administrator ID; persistent managed lockout of every configured key/session after bootstrap; private salted asynchronous credentials; one-use expiring invitation/recovery tokens; fresh account revisions on every authenticated request; serialized last-administrator invariant; identity/audit rollback; existing team approvals and gateway separation unchanged.

## Implementation and contracts

- `createApp` adds optional `managedAccounts?: boolean` (default false for explicit existing compatibility fixtures/callers). Product **control** passes true; gateway rejects enabling it and its existing surface filter hides all account routes before handlers.
- `ControlStore` adds `identityState(): Awaitable<IdentityState>` and `changeIdentity<T>(change: IdentityChange<T>): Awaitable<T>`. The synchronous callback runs under SQLite BEGIN IMMEDIATE or PostgreSQL singleton-row FOR UPDATE, returns `{result,audit}`, and commits JSON state and existing audit-chain entry atomically. Password KDFs run before this transaction and authority/revision/token validity is rechecked inside it. Runtime performs no CREATE/ALTER for PostgreSQL.
- New state types: `Account`, `Invitation`, `IdentityState`, `IdentityChange<T>` in `server/security/accounts-state.ts`. Accounts have stable id, local tenant, normalized email, active flag, revision, salted password hash. State is bounded to 256 accounts, 100 pending invitations, one recovery per account (expired records pruned on issuance).
- `LocalOperators` adds `credential()` for key verification without a session and `issue()` for the shared 256-session/8h issuer. Exported `OperatorSession` adds optional authMode and revision. Existing key APIs still work in compatibility mode. Managed checks refresh the current actor from storage on every request and deny key sessions after durable initialization.
- Passwords use asynchronous built-in scrypt N=131072/r=8/p=1/maxmem=192MiB, random 16-byte salt, constant-time verification, and a process-wide maximum of two concurrent KDFs (extra work returns 429 without an unbounded password queue). Password length 15..128. Unknown account login performs the same KDF. All tokens are random 32 bytes; persistence contains only SHA-256 token hashes.
- Exact brief endpoints implemented: GET/POST `/api/setup`, dual strict `/api/login`, existing session/logout; POST `/api/invitations/accept`, POST `/api/password/reset`; GET/PATCH `/api/profile`, POST `/api/password/change`; GET `/api/team`, POST/DELETE invitations, PATCH member, POST member recovery. No workspaceName extension. Profile PATCH returns `{account: safeMember}`; member PATCH returns safe member directly. `expiresAt` is an epoch-millisecond number. Normal sessions include `authMode: 'key'|'account'`. No public signup/email service.
- Cookie remains HttpOnly, SameSite=Strict, Path=/api, 8h. Password change clears cookie. Managed unsafe authenticated requests always require CSRF. Strict input schemas reject authority/tenant injection. Audit identity details include only actorId/targetId/reason; no email/password/hash/token/session/CSRF.

## Migration and parent integration

`infra/local/control-db/002-accounts.sql` is idempotent and must execute as bootstrap owner. It creates/seeds singleton identity_state and grants runtime SELECT/UPDATE only. `010-control-fixture.sh` now executes it after 001. Parent confirmed both local/product Compose profiles mount it at `/opt/agentbrake-control/002-accounts.sql`, and product start applies it as owner to existing volumes before application startup. Do not enable managed product mode on an existing volume without this migration. No user .env, running product-local, real credentials/data, external services, Git or dependencies were used/changed.

## Actual verification

RED: `node scripts/with-opa.mjs --import tsx --test tests/enforcement/accounts.test.ts` failed 4/4 before implementation: missing `/api/setup` and `identityState`.

Final GREEN: `node scripts/with-opa.mjs --import tsx --test tests/enforcement/accounts.test.ts tests/enforcement/team-approvals.test.ts tests/enforcement/control-audit.test.ts tests/enforcement/gateway-bridge.test.ts` passed **13/13** against final code. Coverage includes bootstrap wrong/reviewer key, repeat and spoof inputs; invitation signup/replay/revocation/expiry; viewer/operator admin denials and CSRF; last-admin concurrent changes; disable/demotion immediate session denial; wrong-current-password unchanged state; password change invalidates two sessions; recovery replay/expiry and session invalidation; SQLite reopen key lockout/login; setup and profile audit-write failure rollback; safe team/profile/audit export and persisted state do not contain test passwords/keys/raw tokens; salted production KDF parameters, concurrency rejection and timer execution before KDF completion. Existing team approval/audit/gateway tests pass.

Final `npx tsc --noEmit` passed.

Added real PostgreSQL main-suite subtest in `tests/stage2/postgres-control.test.ts`: same complete actual-HTTP workflow using `accounts-fixture.ts`, close/reopen persistence and key lockout/account login, then revoke audit INSERT, call actual profile PATCH, assert 503 and identical identity/audit state, restore grant and verify chain. **Not run here**; parent runs the isolated Docker fixture/full release. Its identity workflow requires the normal fresh disposable stage2 volume.

## Scoped source list

- server/security/accounts-state.ts (new)
- server/security/accounts-password.ts (new)
- server/security/accounts.ts (new)
- server/security/operators.ts
- server/app.ts
- server/product.ts
- server/control-store.ts
- server/store.ts
- server/postgres-store.ts
- infra/local/control-db/002-accounts.sql (new)
- infra/local/control-db/010-control-fixture.sh
- tests/enforcement/accounts-fixture.ts (new reusable actual-HTTP test helper)
- tests/enforcement/accounts.test.ts (new)
- tests/stage2/postgres-control.test.ts (bounded managed-account subtest)
- docs/tasks/service-identity-report.md (this report)

Remaining integration gaps: real PostgreSQL execution, product startup/migration verification, UI workflows and full release checks are pending parent verification. Recovery restored processes naturally lose the in-memory session map; account state/revisions remain durable. No known backend API deviation from the brief.

## Task 1 fix round 1 — ID-1 session capacity

Reviewer finding accepted and reproduced: all 256 successful legacy sessions remained in the issuer map after managed bootstrap made them unusable. Setup/invitation acceptance committed identity state before the fallible capacity check, so an HTTP 429 could describe a durably completed operation without returning its promised session.

Scoped repair (operators.ts, accounts.ts, accounts.test.ts only): the shared issuer now reserves capacity and pre-generates session/CSRF secrets before setup or invitation KDF/transaction work. A reservation counts against concurrent normal issuance and is released on every error path. After a successful identity/audit commit it becomes the promised session without a new capacity or randomness operation. Bootstrap may reserve against capacity that its own successful commit will reclaim from key sessions; those key sessions are retained on rollback. The 256 active-session limit and 8h expiration remain. Managed account role/disable/password/reset commits remove older issuer revisions only after durable success. Authentication/sign-in also reconcile sessions proven invalid by current durable state, including changes from another app instance; older read snapshots do not discard a newer legitimate session revision. No API/store/SQL changes and production KDF parameters/concurrency are unchanged.

New actual-HTTP regressions fill 256 sessions using real login requests (production account scrypt, two in flight maximum): (1) a saturated-key bootstrap audit failure preserves uninitialized state/audit and working old sessions; the successful retry returns an immediately usable managed administrator and all old keys/sessions remain denied; (2) 256 valid active account sessions still enforce 429 for extra login/signup, failed signup preserves account state and invitation, and a committed member revision invalidates all old sessions and permits fresh sign-in plus use of the original invitation.

RED command: `node scripts/with-opa.mjs --import tsx --test --test-name-pattern='session capacity' tests/enforcement/accounts.test.ts` failed **2/2** before repair: setup returned 429 instead of 200; invitation acceptance returned 429 while consuming the invitation/creating an account. Duration 68.2s. This demonstrated the shared lifecycle/capacity cause; no unrelated redesign or repeated speculative fix approach was used.

Initial GREEN of the same command after repair passed **2/2**, duration 69.3s. The final combined regression run also includes the additional saturated-bootstrap audit rollback check. Final result recorded below when completed.

Final GREEN command: `node scripts/with-opa.mjs --import tsx --test tests/enforcement/accounts.test.ts tests/enforcement/team-approvals.test.ts tests/enforcement/control-audit.test.ts tests/enforcement/gateway-bridge.test.ts` passed **15/15** against the final revision, duration **84.8s**. The account suite is 8 tests, including both capacity regressions; the existing approval/control-audit/gateway checks pass. Final `npx tsc --noEmit` passed. Scoped round-1 completion: ID-1 repaired and observable acceptance checks met; separate review and parent-owned real PostgreSQL/product/full-release verification remain pending. No UI/scripts/Compose/live product/data changes in this repair.
