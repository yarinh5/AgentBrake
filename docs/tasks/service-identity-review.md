# Managed identity backend review

Review status: complete for the assigned identity delta; changes requested for one confirmed correctness defect. No implementation files were edited. This is not a live product or PostgreSQL integration sign-off.

**Specification verdict: changes requested.** The requested routes, strict inputs, account projection, generated administrator bootstrap binding, durable key lockout, current-session revision checks, bounded asynchronous KDF, atomic token consumption, last-administrator invariant, and identity/audit transactions are present. However, the promised bootstrap-to-session flow fails when the existing session map is full (ID-1). Real PostgreSQL execution remains an explicit acceptance gap, not a demonstrated defect.

**Code-quality verdict: changes requested.** The identity service reuses the existing issuer and database transactions without adding unrelated infrastructure. Mutation authority is rechecked inside the identity transaction after asynchronous work, and account/credential projections are separate. One lifecycle mismatch between logical invalidation and the reused session capacity can lock out the installation. No other confirmed introduced security/correctness defects were found in this scope.

## Scope and evidence

Requirements: `service-identity-brief.md`. Implementation claims: `service-identity-report.md`. Reviewed all 1,090 lines of `service-identity-review.diff`, covering the 14 implementation/test files against snapshot `.agentbrake-local/service-base` (baseline fingerprint `a37811a74bc93ace334a58bb51577a195dd9985fcd16aca66b1e4d669d058bdd`). Also read the current affected source and relevant existing caller/transaction code. Parent-owned operational/product changes outside this identity delta were excluded.

| Area | Review coverage |
| --- | --- |
| `server/security/accounts.ts`, `accounts-state.ts`, `accounts-password.ts`, `operators.ts` | Reviewed bootstrap, login, profile, invitations, recovery/password changes, account mutation/revision checks, token consumption, KDF parameters/concurrency, projections and issuer lifecycle. |
| `server/app.ts`, identity change in `server/product.ts` | Reviewed actual HTTP registration, strict bodies, role and CSRF middleware, compatibility mode, error/audit handling, and gateway surface filtering. |
| `server/control-store.ts`, `server/store.ts`, `server/postgres-store.ts` | Reviewed narrow identity interface, SQLite BEGIN IMMEDIATE, PostgreSQL row locking, existing transaction helper and audit-chain append, and rollback paths. PostgreSQL behavior was inspected statically only. |
| `infra/local/control-db/002-accounts.sql`, `010-control-fixture.sh` | Reviewed owner-run idempotent identity creation/seeding, runtime SELECT/UPDATE grants, and fresh fixture application. Parent owns Compose mounting/existing-volume migration verification. |
| `tests/enforcement/accounts-fixture.ts`, `accounts.test.ts`, identity addition in `tests/stage2/postgres-control.test.ts` | Reviewed real-HTTP coverage, assertions, fault injection, restart and PG reopen/rollback design. Session-cap/invalidation interaction was not covered. |

No Docker, heavy suites, external services, real credentials/data/.env, Git, or subagents were used. The bounded probe used the existing fixture credentials, an in-memory SQLite store, and loopback HTTP only.

## Confirmed finding

### ID-1 — P2: invalidated sessions retain capacity and can lock out managed bootstrap

Locations: `server/security/operators.ts:78-82`, `server/security/accounts.ts:32`, `server/security/accounts.ts:84-88`; related invalidation paths at `accounts.ts:155`, `180`, `197`, and authenticated logout at `server/app.ts:196`.

Expected: successful bootstrap durably creates the administrator and returns its normal session; sessions invalidated by bootstrap or account revision changes must not indefinitely prevent valid new account sessions under the retained 256-session bound.

Actual: `LocalOperators.issue()` only removes expired sessions before counting the map. Managed bootstrap/revision checks reject old sessions without removing their entries. Bootstrap commits `initialized=true` and the administrator account, then tries to issue a session. With 256 unexpired legacy sessions it returns 429 after committing. Every legacy session is now rejected, including by the middleware protecting logout, and a correct account login also returns 429. The administrator has no usable session until a slot expires or the control process restarts. The prerequisite is 256 successful key logins before bootstrap; the public HTTP login flow allows those successful logins without adding to its failed-attempt counter. A configured lower-role key can also populate this shared map.

Cause: the new durable invalidation semantics were added outside the reused in-memory issuer, but its capacity accounting still treats invalidated entries as active sessions. This is distinct from ordinary refusal to exceed a cap: the entries preventing recovery can no longer authenticate or be logged out. Revision changes leave the same class of stale capacity behind. Invitation acceptance also commits account/token consumption before a potentially failing `issue()` call; that related post-commit failure should be considered when fixing this boundary.

Observed with a bounded actual-HTTP probe, exit 0:

```json
{"successfulLegacyLogins":256,"setupStatus":429,"setupError":"Session limit reached","initialized":true,"accountCount":1,"loginStatus":429,"loginError":"Session limit reached","oldLogoutStatus":401}
```

Smallest repair direction: reconcile the issuer's capacity with durable identity validity (remove bootstrap-invalidated key sessions and stale/disabled account sessions), and ensure the normal-session-producing mutations cannot consume their durable operation and then fail solely because issuance capacity was not secured. Keep the existing 256/8h cap and never restore authority to invalid sessions. In-memory cleanup must follow successful durable mutation, so an audit rollback cannot invalidate otherwise-valid sessions.

Acceptance checks, **not yet run against a repair**: fill the session limit through real HTTP, bootstrap and immediately authenticate the new administrator while all old keys/sessions remain denied; fill capacity then invalidate account sessions by revision/disable and verify valid sign-in can recover capacity; exercise invitation acceptance at full capacity and verify the chosen failure behavior does not silently consume the invitation while reporting failure. Retain existing audit-failure rollback assertions.

## Checks actually run and remaining limits

The reviewer ran one focused diagnostic from `F:/project love/AgentBrake`, using a PowerShell literal here-string piped to `node --import tsx --input-type=module`. It imported the existing `Store` and `accountApi` helper, made 256 key logins, then setup/account-login/old-session-logout requests, read only `initialized` and account count, and closed the server/store in `finally`. Reproduction body:

```js
import { Store } from './server/store.ts';
import { accountApi, key, password } from './tests/enforcement/accounts-fixture.ts';
const store = new Store(':memory:');
const api = await accountApi(store);
try {
  let old;
  for (let i = 0; i < 256; i++) {
    old = await api.request('/api/login', { key });
    if (old.status !== 200) throw Error('Unexpected login status at ' + i + ': ' + old.status);
  }
  const setup = await api.request('/api/setup', { key, name: 'Owner', email: 'owner@example.test', password });
  const login = await api.request('/api/login', { email: 'owner@example.test', password });
  const logout = await api.request('/api/logout', {}, old);
  console.log(JSON.stringify({successfulLegacyLogins:256,setupStatus:setup.status,setupError:setup.error,initialized:store.identityState().initialized,accountCount:store.identityState().accounts.length,loginStatus:login.status,loginError:login.error,oldLogoutStatus:logout.status}));
} finally { await api.close(); }
```

The implementation report supplies a final 13/13 focused native run and passing `npx tsc --noEmit`; these were not rerun by this reviewer. They do not cover ID-1. PostgreSQL tests, product startup/migration, UI and full release verification were not run here. No verified repair is claimed. Stop condition for this review is met: the assigned delta and contracts were inspected, the concrete candidate was reproduced, and the remaining acceptance gap is recorded for the parent.
