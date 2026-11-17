# GitHub App sandbox acceptance runbook

Status: PREPARED; live execution NOT AUTHORIZED / NOT RUN. This document is not permission to connect. Existing offline contracts are tests/production/github-app.test.ts, github-gateway.test.ts, github-control.test.ts and github-egress.test.mjs.

## Admission gate (human operator records each item)

1. Explicit approval names the disposable owner/repository, allowed reads, creation of agentbrake/* feature branches and draft PRs, run window and cleanup owner. No production, merge, release, deletion or paid infrastructure.
2. Fresh synthetic repository: protected main, initial README.md and src/example.ts, no Actions/workflows, secrets, deployment automation or external webhooks. Operator checks organization automation separately. No real source/customer data. Record immutable owner/repository IDs and baseline main SHA.
3. Dedicated App installed only on this repo: Contents RW, Pull requests RW, Metadata read; no bypass, org, Actions, Workflows, Administration, Issues or Secrets rights. Record App/installation IDs and evidence of installation permissions. Private RSA key goes in an operator-controlled file, never chat/artifacts/agent env.
4. A separately authorized host/private access route and named reviewer/operator exist. Freeze source hash, package checksum, app IDs, exact topology, test plan and maintenance window. Require local release/image checks plus independent security review before any customer-connected pilot.
5. Configure a new installation with scripts/configure-candidate.mjs as in PRODUCTION_OPERATIONS.md. Configuration alone makes no API request; starting a configured service enables live access and MUST wait for explicit authorization. Do not reuse product-local.

## Execution matrix after authorization only

Use managed operator and separate approver accounts. Issue a GitHub App sandbox identity scoped to this repository and only the tools needed, short expiry and bounded call quota. Record actionId/requestId/correlationId, grant, policy hash, review fingerprint, approver and GitHub request IDs where available. Capture target observations with an independently authenticated human reviewer; never give that credential to the agent.

| ID | Action / input | Required evidence and expected result |
|---|---|---|
| GH01 | github_list_repo; github_read_file README.md | Correct immutable IDs; permitted read; content hash matches independent GitHub read; main unchanged |
| GH02 | Same read for a repo outside grant; unknown delete/force/main/workflow tools/paths | Pre-dispatch denial; no adapter mutation; before/after refs/tree/PR count unchanged. Target snapshot alone is not proof of zero calls; correlate Gateway instrumentation |
| GH03 | github_create_branch {repo,baseSha,branch:agentbrake/<unique-run>} | Pending; no new ref before approval; display exact preview; distinct reviewer approves once; new ref equals baseSha and main unchanged |
| GH04 | github_open_pull_request on that branch, baseSha, title and one allowlisted synthetic file change | Pending with exact diff; reject once and verify unchanged; new request then independent approval creates one draft PR, expected blob/tree/commit and one bounded feature update; main unchanged |
| GH05 | Replay exact requestId/arguments, repeat approval; reuse same requestId with changed arguments | Same action/outcome, no new commits/PR/ref change; duplicate approval or argument swap rejected. A replay lookup is not a new execution |
| GH06 | Pending change then revoke grant or change policy; separate case changes reviewed branch state | No unapproved mutation; stale review rejected. Distinguish refusal before dispatch from adapter not-applied response |
| GH07 | Direct API/TCP from isolated agent; inspect env/mounts/network | Agent has no App key/installation token; fixed egress/protected endpoints inaccessible by direct IP as well as DNS; Gateway route remains functional |
| GH08 | Controlled loss of mutation response | Prefer existing local transport fault test. Live fault injection is a separate explicit approval, not required to interrupt a real service. If encountered: UNKNOWN, same-ID replay no mutation; independent reconcile refs/PRs before further work |

For GH04 record expected path set and SHA256 of synthetic file content, exact base/head commits and PR number/state/draft flag. Compare independent before/after Git tree and refs; list unexpected changes, not just the expected file. An API 2xx or adapter-reported status alone is not target verification. For denial, assert no new ref, blob/tree change reachable from refs, or PR. Orphan Git objects from an interrupted multi-step write may exist; report partial/uncertain state honestly.

## Stop, evidence and exit

Stop on unexpected permissions/IDs, target change, unapproved effect, leaked credential, broken isolation, missing audit, unexpected automation or unexplained UNKNOWN. Pause/revoke new grants, preserve sanitized evidence, investigate; no automatic retry with a new ID. Disabling the App/key does not undo dispatched changes.

Acceptance record: run ID, UTC times, operator/reviewer, exact source/package/image IDs, sandbox authorization reference, cases GH01–08 with PASS/FAIL/NOT RUN, action references, independent snapshots/hashes, failures, open risks, cleanup and signatures. GH08 local-only is explicitly labeled. Never record private keys, installation tokens, cookies or real content. Human review must confirm no open critical/high finding on the admitted path.

At end stop the candidate and revoke task credentials. The repository owner separately approves any branch/PR deletion or removal of the disposable repo/App. Do not silently broaden App privileges to make a test pass. No live sign-off is created by this runbook.
