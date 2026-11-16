# Managed identity backend — fix round 1 re-review

**ID-1: ADDRESSED. Specification verdict: PASS for this repair. Code-quality verdict: PASS for this repair.** No new confirmed correctness/security defect was found in the scoped delta. This clears the prior session-cap finding; it does not claim live PostgreSQL or full product acceptance.

Scope: read the appended fix-round-1 handoff in `service-identity-report.md` and all 334 lines of `service-identity-fix1.diff`, covering only `server/security/accounts.ts`, `server/security/operators.ts`, and `tests/enforcement/accounts.test.ts` against `.agentbrake-local/service-identity-fix1-base`. Reviewed ID-1 and introduced breakage only. No source edits, broader audit, Docker, heavy test reruns, external services, real credentials/data/.env, Git, or subagents.

## Cause and repair assessment

The original cause was the mismatch between durable invalidation and the issuer's capacity accounting, plus fallible session issuance after bootstrap/invitation state had committed.

The repair addresses both parts:

- `operators.ts:88-112` reserves capacity and generates session secrets before durable work. Ordinary issuance counts outstanding reservations. Issuing the reserved session performs no second capacity check or randomness operation. The synchronous reservation/issue sections cannot interleave within the Node process.
- `accounts.ts:96-108` and `153-168` reserve before setup/invitation KDF and mutation, release reservations in `finally`, and issue only after the identity/audit transaction returns successfully. At full valid account capacity, invitation acceptance fails before consuming the token or creating the account.
- Bootstrap's replacement reservation excludes key sessions from its future capacity calculation but retains them until the successful commit is followed by issuance. Therefore an audit rollback does not invalidate working legacy sessions; successful bootstrap removes them and returns its promised account session.
- `accounts.ts:182`, `210`, and `228` prune older account revisions after successful member/password/reset commits. Failed transactions never reach those cleanup calls. The projection returned by member PATCH remains the safe member object, without exposing the newly internal revision result.
- Authentication and sign-in reconcile stale sessions against durable state. The predicates preserve a newer session when an older database snapshot lacks its account or contains an earlier revision, avoiding erroneous deletion during asynchronous reads. They do not authorize those preserved sessions: the existing active/revision check still decides authentication.

The existing 256-session cap, eight-hour expiration, transaction authority checks, token replay protection, and production scrypt settings remain intact. No store/API/SQL repair was introduced.

## Evidence and checks

Reviewer reran the original failure family through the actual HTTP helper and in-memory SQLite store, using unchanged fixture credentials. Command: a PowerShell literal here-string piped to `node --import tsx --input-type=module`, from `F:/project love/AgentBrake`. The probe imported `Store` and `accountApi`, asserted 256 successful legacy HTTP logins, performed administrator setup, then asserted setup-session access and a fresh account login both succeed while the old session and old key are denied. It closed the API/store in `finally`. Exit 0, about 2.3 seconds:

```json
{"successfulLegacyLogins":256,"setupStatus":200,"sessionStatus":200,"loginStatus":200,"oldSessionStatus":401,"oldKeyStatus":401,"initialized":true,"accountCount":1}
```

The repair handoff reports two actual-HTTP capacity tests RED before repair, then GREEN, followed by the final combined native run **15/15** and passing `npx tsc --noEmit`. Those full commands were not rerun by this reviewer. Their test bodies were inspected: they cover saturated bootstrap audit rollback and retry; enforcement of the cap for active sessions; invitation state preservation at capacity; revision invalidation reclaiming slots; and subsequent successful acceptance of the same invitation. The original report contains the exact commands and durations.

Remaining limits are unchanged: real PostgreSQL execution, product startup/migration, UI workflows, and full release verification are parent-owned and not established by this re-review. The bounded probe and source review establish that ID-1 is addressed; no further identity repair is requested from this review.
