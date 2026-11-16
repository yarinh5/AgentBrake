# AgentBrake staged implementation plan

**Date:** 2026-11-16. **Scope of this delivery:** Stage 0 inventory + Stage 1 enforcement core and its tests. Later stages remain planned, not implicitly complete.

**Authority:** The user's explicit request authorizes local staged implementation and adopts `docs/specification/AgentBrake_Product_Security_PRD_2026-11-16.md` as product/security requirements and the Master Build Prompt as execution guidance. The pasted market research is context, not proof of product behavior or commercial traction. No external deployment, paid service, real repository/database access or material product change is authorized.

**Goal:** Extend the existing gateway so a real OPA decision, authenticated task context and strict protocol checks precede every supported upstream invocation; prove forbidden requests produce zero upstream calls.

**Architecture:** Retain the existing React UI, strict tool schemas, Gateway action lifecycle, SQLite test store, atomic execution claim and sandbox adapters. Add an authenticated OPA sidecar boundary and a current MCP HTTP transport. Existing HTTP and stdio callers use the same PEP; there must be no legacy authorization fallback. The control/audit PostgreSQL migration, independent target PostgreSQL and Next.js separation stay on the Stage 2/4 roadmap.

**Stack:** Node 22.13 local; TypeScript; SDK server/client 2.4.0; OPA 1.22.4 (checksum pinned); Rego v1; existing Express and React. Dependency lockfile remains authoritative.

## Inventory and demonstrated baseline

- No Git repository exists in this checkout. Build commit SHA is **unavailable**; evidence will record this honestly and use a SHA-256 source manifest, not invent a commit.
- Existing source: `server/{app,gateway,store,contracts,connectors,mcp}.ts`, React/Vite dashboard, local setup, 20 Node integration tests and two browser tests.
- `npm test` before changes: **20 PASS, 0 FAIL**, including actual stdio MCP client, approval races, expiry, configuration binding, secret rejection and audit-write failure.
- Runtime checked: Node v22.13.0, MCP server/client 2.4.0, Docker client 27.1.1, Compose 2.29.1. Docker daemon returns HTTP 500 in both desktop-linux and default contexts. No Docker reset, daemon restart, unrelated resource deletion or global config change is authorized by this finding.
- Existing `.env`, `data/` and user databases will not be read, migrated, reset or used by tests. New tests use disposable, named fixtures or memory.

## Gap map

| Area | Existing | Required next |
|---|---|---|
| Enforcement | deterministic local rules, strict schemas | OPA typed decisions and authenticated fail-closed PDP |
| Grants | permanent agent tools/resources | task identity, audience, expiry, revision, quota, revocation |
| MCP | stdio bridge, version not explicitly asserted | 2026-07-28 stateless HTTP + 2025-11-25 test matrix, metadata/header consistency |
| Evidence | local audit, state assertions | correlated decisions + upstream call counts + fixture hashes + reproducible proof pack |
| Integrations | SQLite sandbox; optional PAT/Postgres | real connectors disabled pending separate approval; GitHub App + separate Postgres fixtures in Stage 2 |
| Storage | single SQLite control/fixture store | separate PostgreSQL control/audit and target databases |
| UI | usable React/Vite | preserve; migrate to Next.js and split runtime in Stage 4 |
| Isolation | loopback binding; host agent can bypass | Docker network/credential negative tests; T20 presently NOT RUN |

## Global constraints

- Default DENY; errors, missing/expired context and unavailable/invalid PDP responses cannot dispatch.
- No client-supplied identity, tenant, tool metadata or target endpoint can confer authority.
- No unrestricted SQL. Existing schemas and guardrails remain additional restrictions, never substitutes for OPA.
- No writes to actual services. Stage 1 uses sandbox only; unsafe optional connectors become explicitly disabled.
- Preserve legacy tests and add observable boundary tests; a mock counter is only the upstream observer, not a policy mock.
- OPA management is not public: loopback/private transport, bearer identity, path/method allowlist. The evaluator credential cannot modify policies or read auth data.
- Raw secrets and arbitrary args are absent from evidence. Test tokens are ephemeral and never exported.
- Supported protocol methods: `tools/list`, `tools/call`, capability discovery / ping as required by SDK; legacy `initialize` / initialized notification only on explicitly supported 2025-11-25. No arbitrary RPC pass-through.

## Review focus

1. Async PDP creates a new revoke/policy-change race: recheck local state after the await and before dispatch.
2. Async decisions create duplicate request races: serialize/reserve a request before side effects; at most one attempt.
3. Missing/oversized/malformed/wrong-revision PDP output must never become ALLOW.
4. Modern MCP headers must match body and protocol envelope; spoofed metadata cannot select a different policy.
5. An allow decision is not successful execution; audit failure, grant expiry, quota exhaustion and connector uncertainty remain distinct.

## Stage 1 tasks

### 1. OPA policy contract and protected runtime
Files: `server/policy/{contracts,opa-client}.ts`, `services/policy/*.rego`, `scripts/{install-opa,with-opa}.mjs`, tests under `tests/policy/`.
Interface: `PolicyEvaluator.evaluate(input: PolicyInput): Promise<PolicyDecision>` with ALLOW/DENY/REQUIRE_APPROVAL, reason_code, decision_id, policy_version, policy_hash.

- [x] Write failing Rego and boundary tests: allowed read; approval-required write; unknown/destructive operation; invalid/expired/revoked/cross-identity grant; rows outside budget.
- [x] Install pinned OPA locally with verified SHA-256; no global installation. Start an ephemeral authenticated loopback process for tests; persist only sanitized results.
- [x] Implement deterministic Rego and typed input/output. 250 ms decision timeout, bounded response, reject redirects and wrong policy revision; no fallback ALLOW.
- [x] Test unauthorized PDP read/write and authenticated management API denial.

### 2. Integrate the existing PEP
Files: existing gateway/store/contracts/app, `server/policy/*`, `tests/enforcement/*`.
Interface: existing `Gateway.submit` and `approve` stay callers' entry points. Add trusted task context and correlated policy evidence to stored action records.

- [x] Write negative tests with an independently counted upstream and before/after fixture snapshots.
- [x] Bind task/agent/tenant/environment/expiry/audience and bounded quota server-side. Grant lifetime is at most one hour in Stage 1. No silent grandfathering of old identities without grants.
- [x] Await OPA before any dispatch; recheck grant/revocation/policy after the await. Atomic execution claim and no automatic mutation retry remain.
- [x] Bind policy revision and exact task context to pending actions; changed revision requires new review.
- [x] Enforce 32 KiB payload, depth 12, max 8 concurrent calls, 120 calls per minute per identity; release reservations on all exits.
- [x] Run preserved integration tests against real OPA; verify zero direct integration calls without opt-in.

### 3. MCP protocol boundary
Files: `server/mcp-http.ts`, existing bridge/contracts, `tests/enforcement/mcp-protocol.test.ts`.

- [x] Fail-first tests: stateless 2026-07-28 tools/list and tools/call; explicit 2025-11-25 compatibility; unsupported version; missing/forged headers; unknown/schema-mismatched tools; spoofed tenant/agent; malformed/deep/large envelopes.
- [x] Use official SDK APIs from installed types/source; authenticate before discovery/invocation; do not pass incoming credentials to OPA/upstream.
- [x] Keep the stdio path and ensure it reaches the same PEP; include an executable synthetic client.

### 4. Evidence, regression and handoff
Files: `scripts/verify-stage1.mjs`, `docs/evidence/*`, `docs/{TEST_MATRIX,KNOWN_LIMITATIONS,OPERATIONS,DEPLOYMENT_MODES,SECURITY_EVIDENCE}.md`.

- [x] Emit run UUID, UTC time, source manifest/build identifier, environment hash, command, observed counts, state hashes and per-case status.
- [x] Run OPA tests, full Node suite, TypeScript/build and existing browser flows with disposable data. Capture failures and final outcomes separately.
- [ ] Validate Compose config; run isolation tests only if Docker becomes available without invasive host changes. Mark T20 NOT RUN otherwise; **do not pass Milestone A**.
- [x] Fresh-context code/security review under the executing-plans skill; resolve demonstrated important defects with reproducing tests.
- [x] Report Stage 0/1 scope, actual results, risks and next work; stop at the requested first implementation stage.

## Subsequent stages (not part of this delivery)

2. Separate control/target PostgreSQL, least privilege roles and migrations; trusted task CRUD and independent approver roles; GitHub mock feature-branch/PR flow; explicit GitHub App opt-in only.
3. Full approval nonce/identity/task/resource/revision lifecycle, immutable previews, evidence packets and retention/export.
4. Next.js UI migration preserving working components, separated dashboard/control/PEP processes, full Compose install and setup.
5. T01–T30 adversarial/isolation/workflow benchmarks and independent external review. Codex client setup emitted, never written globally.

## Stage completion conditions

Stage 0: inventory + plan + ADR + threat model + all T01–T30 tracked.
Stage 1 code acceptance: real OPA and MCP positive read succeeds once; all tested deny/pending/error cases have zero upstream calls; invalid grants/PDP failure fail closed; preserved behavior regresses neither approvals nor UI. Milestone A additionally requires Docker credential/egress isolation (T20), which cannot be inferred from native tests.

## Execution ledger

- Stage 0 baseline: 20/20 Node tests PASS. Source inspection and both requirement documents read fully.
- Ruling: no Git commits can be cited because the folder is not a repository; use source manifest and retain evidence. No Git initialization or fabricated SHA.
- Ruling: proceed with authenticated native OPA verification while Docker returns 500. This changes the test harness, not the target architecture; isolation remains unverified.
- Ruling: keep the existing single PEP, SQLite fixtures and Vite UI for Stage 1; migrate PostgreSQL/Next.js in planned stages instead of rebuilding working components now. Cost: this stage does not satisfy separated deployment/storage architecture.
- Ruling: real connectors are disabled now. Replace the old live-DB rebind test with sandbox HMAC-key rotation and add an upfront live-target denial test. Cost: live connector/rebind behavior remains unverified; no production access used to preserve an obsolete test assumption.
- OPA policy: deny-only stub 2 failures → 12/12 Rego PASS. Compilation recursion from a broad data reference fixed using a narrow metadata lookup.
- PEP: 4 new boundary tests first failed against legacy behavior, then passed with mandatory OPA and trusted grants. Baseline 20 tests preserved except the explicitly updated binding contract above.
- Async race: simultaneous distinct reads exposed taint in the authority fingerprint; corrected separation of authority and egress taint, reproducer RED→GREEN.
- HTTP MCP: 11 transport acceptance tests failed before implementation → all passed with explicit era checks and official SDK. Node adapter package version is independently 2.1.2; attempted matching 2.4.0 was unavailable (ETARGET), registry/types verified before installing.
- Scoped preliminary proof run `abc8b4be-4cbd-4402-aaf8-d4556dd38455`: 62/62 Node, 12/12 Rego, 2/2 browser, TypeScript/build and 10 counted proof scenarios PASS; Docker daemon preflight FAIL/500, T20 NOT RUN. Later source changes require a final run.
- Local built launcher smoke: UI/login/simulation200, 3 allowed/4 blocked/2 pending, audit valid, both connectors sandbox. Recorded in `evidence/launcher-smoke.json`; own test runtime stopped after checking.
- Docker Compose configuration/startup and isolation are deferred with T20, not marked checked. No incomplete Compose file is presented as a runnable deployment. Native harness is the only exercised mode.
- Final review: three Important findings reproduced with four failing tests; one Minor observability gap. Exact findings and RED/GREEN logs in `docs/evidence/final-review/`.
- Final: fixed cached-result policy bypass — REST and MCP status regression RED→GREEN; execution-quota recovery still passes.
- Final: fixed approval TTL crossing during the asynchronous PDP wait — real OPA delayed-response regression RED→GREEN, zero calls and unchanged row.
- Final: fixed credential-shaped tool identifier leakage in REST storage/export and MCP errors — two tests RED→GREEN; only trusted labels reach durable records.
- Final: minor (deferred): early REST schema/rate/size rejection lacks a bounded generic audit event; authorization remains blocked. T26 stays PARTIAL.
- Finishing procedure: no Git repository/branch exists, so there is no merge/PR menu or worktree cleanup to perform. Preserve source, plan, logs and source manifest in the user workspace.

- Final aggregate run `aaaebc16-8777-4a47-9605-99a9c5a8f83d`: **67/67 Node, 12/12 Rego, 2/2 browser, TypeScript, Vite build and 10/10 upstream proof scenarios PASS**. Docker preflight FAIL/500; T20 NOT RUN; Milestone A INCOMPLETE. All 45 manifest files rehashed after the run with zero changes.
- Final completion: Stage 0 complete; Stage 1 local enforcement/code acceptance complete with one documented deferred Minor. Container deployment/isolation acceptance remains open. No external deployment, paid service or real target access occurred.
