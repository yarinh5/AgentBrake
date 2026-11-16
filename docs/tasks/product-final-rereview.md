# Final consolidated fix — scoped re-review

Date: 2026-11-16. Scope: CR-001 and CR-002 from `docs/tasks/product-final-review.md`, and defects introduced by their consolidated fix only. Read the original review, `product-final-fix-brief.md`, `product-final-fix-report.md`, and the complete 17-path delta in `product-final-fix.diff` against the preserved frozen baseline. No broadened audit, source edits, subagents, Docker commands, test reruns, external services or existing environment/auth/data reads.

**Scoped specification verdict: PASS. Scoped code-quality verdict: PASS. CR-001: ADDRESSED. CR-002: ADDRESSED. No new Critical, Important or Minor finding in this delta.**

The source remedies and focused acceptance tests address the original demonstrated causes. The remaining real PostgreSQL/restart/release checks are execution gates owned by the parent; they are not assumed to have passed. This report closes the source-review findings, not those runtime or external gates.

Reviewed source: `f257840c3f5196b19cdbfdec33059789826b862a682026159a6e39a2cb22887f`, 144 manifest files. A read-only regeneration during this re-review matched `docs/tasks/product-final-fixed-source-manifest.json`. The historical report remains unchanged so its initial findings and evidence are preserved.

## CR-001 — ADDRESSED

`scripts/compose-environment.mjs:3` removes inherited `COMPOSE_ENV_FILES` and `COMPOSE_DISABLE_ENV_FILE`, as well as unrelated file/profile selectors, using case-insensitive key comparisons. It explicitly sets `COMPOSE_DISABLE_ENV_FILE=true`. It preserves the generated installation environment and intentionally supported retention/log values.

The important placement is the actual child-process boundary: `scripts/product.mjs:164` sanitizes `config.env` immediately before spawning Docker, and `scripts/verify-isolation.mjs:65` applies the same function when spawning verifier commands. Both original launch paths are therefore covered; callers cannot accidentally retain an inherited selector by constructing their environment earlier. Explicit project/Compose-file arguments are retained. The small shared helper is justified by the demonstrated duplicate launch path.

The new Compose regression exercises real `docker compose config`, not just the helper's object shape. It tests the actual product launcher with an inherited selector pointing at a newly generated malformed file, verifies default values, and verifies intentional retention/log overrides. A separate disposable project demonstrates that the ordinary default `.env` canary is actually read without protection, then verifies the protected environment ignores it. Its malformed-default control case makes unintended reads observable. Cleanup is limited to a checked task-created temporary directory. The tests start no containers and do not inspect a real environment file.

The native collectors now include `.test.mjs`, making these regressions part of the release gate. The implementation report records the original malformed-file failure before the fix and the final successful Compose checks. The parent's full release under an inherited malformed synthetic selector will additionally verify the complete isolation-launch path; that run was still pending at this review.

## CR-002 — ADDRESSED

`server/app.ts:172` constructs audit context exclusively from the authenticated `res.locals.actor` and server-generated correlation ID. The create/pause/resume/grant/revoke/policy/stop callers pass it explicitly (`server/app.ts:271`, `287`, `344`, `356`, `362`, `369`), and the simulation and Demo Lab creation paths also pass the trusted context. No request body or arbitrary identity header is used as an actor source.

`server/control-store.ts:10` projects only actor ID, tenant and optional correlation. It does not serialize the session, operator key, cookie, CSRF value or the rest of an approval receipt. Internal calls without context are labeled internal; authenticated creation paths do not depend on the compatibility owner fallback. The actual revoker is consequently distinct from the grant owner when one operator revokes another human's task.

The PostgreSQL implementation appends this context within the existing state-change/audit transactions (`server/postgres-store.ts:160`, `179`, `285`, `334`). Existing row-lock order, rollback and reservation behavior remain intact; the change does not introduce a second best-effort audit outside the transaction. The SQLite compatibility implementation uses the same projection. Existing policy detail fields retain their positions, preserving their consumers. `approval.blocked` now projects actor identity from its already trusted durable approval receipt inside the existing atomic transition; approval proof and authorization behavior are unchanged.

The new real-loopback team API fixture derives expectations from Alice's and Bob's authenticated actions, including Bob revoking Alice's grant. It checks all eight successful control events, exact response-correlated IDs, forbidden role/missing-CSRF/forged-body state invariants, ignored forged actor/correlation headers, zero target dispatches, and JSON/CSV attribution with known credential/session/CSRF exclusion. The rejection regression checks the real reviewer and unchanged target. These tests directly cover the original evidence gap rather than merely asserting that new parameters exist.

Durable checks are appropriately added to the existing isolated PostgreSQL suite: the same API/export fixture, store close/reopen with exact audit event equality and owner/revocation checks, and audit-INSERT failure across the affected mutation family with settings/history/agent/audit equality after rollback. The product verifier adds attributed creation/correlation before whole-installation restart, identical exported audit afterward, CSV preservation, and actual operator revocation of the administrator-owned task. Those checks remain awaiting actual parent execution; this static review does not convert them into passes.

## Verification, remaining gates and completion

The fix report records fail-first regressions and a final focused run of **17 passed, 0 failed, 0 skipped**, plus TypeScript and relevant JavaScript syntax checks. Those are implementer-reported execution results. This re-review inspected their assertions and source changes but did not rerun them, as instructed.

The only executable check performed here was the read-only manifest command from `F:\project love\AgentBrake`:

```text
node --input-type=module -e "import {sourceManifest} from './scripts/source-manifest.mjs'; const m=await sourceManifest(); console.log(JSON.stringify({sourceHash:m.sourceHash,files:m.files.length}));"
```

Exit 0; hash `f257840c3f5196b19cdbfdec33059789826b862a682026159a6e39a2cb22887f`, 144 files. Bounded source/diff reads and line-location searches also completed; no product files were changed.

No remaining demonstrated source concern requires another fix wave in this scope. The parent must still obtain matching-source release success, including the new real PostgreSQL rollback/reopen, persistent product restart/export/cross-owner checks and actual isolation launcher under the synthetic selector. The prior frozen-baseline release is not evidence for this changed source. External human security sign-off and independent clean-machine validation remain open as before.

Completion: the one scoped re-review is complete; both original findings are addressed. Proceed with the already-running release gate rather than expanding the audit or repeating successful focused checks without new evidence.
