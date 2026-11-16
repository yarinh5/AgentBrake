# Production candidate implementation plan

> For agentic workers: use superpowers:executing-plans. Execute inline; one fresh review at the end. Preserve the installed local service.

**Goal:** close locally testable gaps for a private, single-organization deployment, and identify the exact external acceptance gates.

**Architecture:** retain the separate Gateway, OPA, control API, dashboard and databases. Add an opt-in GitHub App sandbox adapter and a fixed-destination HTTPS entrypoint. Default installation remains isolated fixtures; external authority is never inferred from agent input.

**Tech stack:** existing TypeScript/Node, Next, OPA, PostgreSQL and Docker. No paid dependencies or hosted runtime.

**Spec:** specification/AgentBrake_Product_Security_PRD_2026-11-16.md, specification/AgentBrake_Codex_Master_Build_Prompt_2026-11-16.md, ADR/0005-production-candidate.md.

## Global constraints

- No real repository/database access or deployment until a named disposable target and authorization are supplied. No secrets in chat, logs or artifacts.
- Preserve product-local and its data; verify new behavior in disposable test environments.
- Denied actions have zero adapter dispatch; mutation uncertainty remains UNKNOWN, never automatically retried.
- External review, real integration and independent clean-machine installation cannot be replaced by simulated tests.
- Existing checkout has no Git history: use source hashes and the preserved v0.2 source archive; do not initialize/overwrite Git or delete the evidence ledger.

## Review focus

- A transferred/renamed repository must not inherit previously approved authority.
- Installation-token over-scope, expiry and redirected responses fail closed without leaking credentials.
- API multi-step failures may leave partial Git objects/branches; never report zero effect or retry silently.
- Public-origin configuration cannot be bypassed with Host/Origin/forwarded headers or insecure cookies.
- Local success and documentation must not falsely satisfy an external production acceptance gate.

## Task 1: GitHub App adapter and enforced caller path

Files: server/adapters/github-app.ts, github-app-client.ts; server/connectors.ts, contracts.ts, gateway.ts; tests/production/github-app.test.ts, github-gateway.test.ts.

Interfaces: GitHubAppConfig pins app/installation/repository/owner IDs, repository name, default branch and private key. GitHubAppAdapter.preview/execute consume existing ExecutionAction and return bounded ActionPreview/results. HTTP origin is fixed https://api.github.com; an injected transport is only a constructor dependency for local contract tests.

- [x] Write failing tests for signed JWT/scoped mint, identity mismatch, redirects/oversize/errors, safe reads, exact changes, protected-main refusal, stale preview, and partial mutation failure.
- [x] Implement a typed adapter, bounded API client and scoped token broker. No PAT, arbitrary endpoint/SQL, issue permissions, force, deletion, merge, release or workflow edits.
- [x] Wire only explicitly configured non-fixture GitHub identities through existing policy/approval/audit/reservation. Keep all demo/fixture calls local. Test deny=zero network, pending=zero mutation, approval once, stale target=zero mutation, timeout=UNKNOWN/no replay.
- [x] Run focused tests and TypeScript build, record actual results. Real API behavior remains NOT RUN until sandbox supplied.

## Task 2: HTTPS entrypoint and trusted browser origin

Files: infra/product/https-ingress.mjs, infra/product/https.compose.yaml; apps/dashboard/lib/control-proxy.ts; server/app.ts, product.ts; tests/production/https.test.mjs and proxy tests; docs/PRODUCTION_OPERATIONS.md.

Interfaces: explicit AGENTBRAKE_PUBLIC_ORIGIN pins HTTPS browser origin; control API continues private HTTP, session cookies gain Secure. Ingress reads mounted certificate/key, forwards only to fixed dashboard, and rejects incorrect authority. Public deployment is opt-in and requires an externally validated certificate.

- [x] Write failing tests for wrong Host/Origin/forwarded headers, Secure login/setup/logout cookies, actual TLS forwarding and no plaintext listener.
- [x] Implement pinned-origin mode without weakening default loopback restrictions or routing admin requests to Gateway.
- [x] Verify local TLS and regression tests; document certificate rotation, firewall/agent isolation, bootstrap, backup and rollback. Do not mutate product-local.

## Task 3: Release/readiness gates and handoff

Files: scripts/verify-production.mjs; tests/production/readiness.test.mjs; docs/PRODUCTION_READINESS.md, docs/PRODUCTION_OPERATIONS.md, KNOWN_LIMITATIONS.md, TEST_MATRIX.md; evidence/production-candidate/*.

- [x] Add a fail-closed readiness report distinguishing local verified checks from required live integration, independent installation, OS-image scan, external reviewer and operational owner evidence.
- [x] Run the affected real paths and full local release suite against the final revision; preserve source hash, commands, failures and limitations.
- [x] Obtain a fresh code review and address demonstrated critical/important findings with regression tests.
- [x] Document exact GitHub App, sandbox repository, hosting/DNS/TLS, clean-host, reviewer and operational approvals needed. Production remains blocked until those gates actually pass.

## Execution ledger

- Baseline: v0.2 source d036bd48e5521a477fb407cf71a8692aee31b7275da0d170fa76e64ca2f66700; installed product-local preserved.
- Ruling: user authorized routine implementation decisions and continuation; no extra plan approval. Deployment and spending still need a named destination and budget. Risk: unsuitable hosting choice is deferred until infrastructure is known.
- Ruling: use a single-organization self-hosted candidate; no speculative billing/SSO/Kubernetes/multi-tenant rewrite. Risk: this is not a hosted multi-tenant SaaS offering.
- Pre-flight: Task 1 extends connector dispatch, Task 2 extends transport only; Task 3 consumes both test results. Existing approval, tenant and database contracts remain authoritative.
- Task 1 local contract path: 12 focused adapter/Gateway tests passed, including real OPA, pending/consume-once, target identity changes and partial UNKNOWN replay. Expiry coverage was subsequently added (9 adapter cases pass); no live GitHub access obtained.
- Task 2 actual install: run 17105b4e passed TLS/bootstrap/browser/direct-egress isolation. Run 6e26fc2c additionally passed the real browser App identity/grant flow on minimal Node images. These are intermediate source hashes; final exact-source gate remains required.
- Failed candidate attempt 066621b7: verifier omitted the Compose agent profile; corrected the verifier. Attempt a27d6846: HTTPS dashboard health failed because its Host was not the pinned origin. A network-isolated characterization proved pinned Node fetch replaces supplied Host; Node HTTP preserved it. Fixed only the HTTPS healthcheck; next actual install passed.
- Ruling: scan 5cb5e4e7 found runtime164, dashboard49, PostgreSQL26 and OPA1 high/critical package findings. Existing npm advisory scans did not cover those image contents. Add a bounded remediation task: separate pinned Alpine product Node image, omit unused development/package-manager tooling, remove unused root-only PostgreSQL gosu, rebuild unchanged OPA1.22.4 source with fixed x/net0.62.0/Go1.27.4. Existing installations retain their legacy profile; new installations use minimal-v1. Risk: maintained rebuild/profile compatibility, addressed by full installation/restore/policy tests and image scan; no blanket CVE suppression.
- Review of a1cab272: agent reviewer found0Critical/0Important and1Minor expiry/cache coverage gap. Added explicit malformed/expired/near-expiry/overlong/cache-refresh/failed-refresh tests; all pass against existing behavior. This closes coverage only, not a claimed runtime bug fix. Reviewer deferred actual external environments/sign-offs and final scan disposition to their required evidence gates.
- Hardened scan ad15f490 passed the high/critical gate: runtime/dashboard each had one Medium CVE-2026-4738; PostgreSQL/OPA had zero findings. The official Alpine3.24 package index offers fixed zlib1.4-r0; both new Alpine Node runtime stages now explicitly install it. This is a measured package correction, not an ignored finding. It changed source after native run792071e0 began, so that intermediate run cannot close the final exact-source gate.
- Scoped image review found an Important restore regression: backup recorded the derived PostgreSQL identity while restore compared only the legacy base digest. Shared profile resolution now drives both installation and authenticated restore preflight. Real maintenance orchestration tests first failed for minimal restore and unknown-profile preflight; all7 pass after the fix, including legacy restore and changed-image refusal before destination/Docker work. Reviewer reread the delta and reports0openCritical/Important/Minor. Real Docker recovery remains part of the final full gate.
- FINAL LOCAL CANDIDATE: full release exit0 at2026-11-16T19:52:23.732Z, source993f7cbf1a3a56dcb421f88368efa67dbbcf37809d0d45b9cdf54e0ab80287c7/203files. Native86b5c520:171pass/4PG-only skips/0fail,12Rego,17browser,10proof; isolation532d21d4:22PG/16Git/14workflow plus actual local Codex and26-task benchmark24complete/2falseblocks/12approvals/0operationalfailures. Productb4906a2a:8cases; servicec0810502:7cases including actual minimal-profile backup/restore; candidateec851b7a:7cases including12Rego on rebuilt OPA/TLS/browser/direct-egress denial. All owned project cleanup reports zero containers/networks/volumes.
- Final security9ed97394:8Semgrep rules/103files/0findings/parser errors, npm0root/0dashboard, SBOM263/61components. Offline image scand1fd1b91:all four actual candidate service-image IDs report0findings, including the zlib correction; source hashes match. Scan excludes host/build/one-shot-helper scope as documented. Production readiness correctly returns BLOCKED/Node exit2:3local gatesPASS,5external gatesNOT_OBTAINED. No unresolved Critical/Important agent-review findings; independent human review is still required.
- Completion boundary: all three local implementation-plan tasks are complete and verified. Actual GitHub integration, independent clean-host install, external human sign-off and deployment/operating acceptance require the named access in PRODUCTION_READINESS.md. Product-local remains healthy v0.2.0 and was not rebuilt; no external deployment, real target credentials or paid inference used. Source packaging/extraction is recorded separately by release-package.json and candidate-package-validation.json; do not infer installed upgrade or external readiness from an archive.


