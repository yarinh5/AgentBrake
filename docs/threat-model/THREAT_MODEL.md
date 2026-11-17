# AgentBrake threat model — Stage 1

Current validation addendum (2026-11-17): the stage register below is historical. Current scope and explicit exclusions are in ENFORCEMENT_BOUNDARIES.md and KNOWN_LIMITATIONS.md. Team approvals and the opt-in GitHub App sandbox adapter now exist; the App has only offline-contract/local-network proof, not live-target acceptance. No unrestricted host-agent enforcement or Enterprise certification has been added.

R16 Important — post-dispatch evidence ambiguity: secret-like output previously changed a completed adapter call to blocked; a dispatched CAS rejection also used blocked. The commercial validation revision separates policyEffect, executionOutcome and resultDisclosure, keeps uncertain writes unknown and never retries the same action. Successful output withholding is not prevention or rollback. Historical ambiguous records remain unverified. Regression scenarios include independently observed fixture mutation, no sensitive output in persistence/export, same-ID replay, HTTP/stdio status, UI and benchmark interpretation. Fresh result references are in PLAN_COMMERCIAL_READINESS.md/SECURITY_EVIDENCE.md; source presence is not a passing test claim.

Date: 2026-11-16. Scope: local supported tool calls through the PEP. Attacker controls an agent, its arguments, untrusted file/issue content and optional MCP metadata; attacker may possess a stolen agent bearer token. Administrator/host OS/OPA policy sources are trusted in this stage. No assertion of production readiness.

## Execution boundaries

```text
untrusted MCP/HTTP/stdio caller
  → token lookup + server-issued identity/task + transport/schema limits
  → existing restrictive preflight + authenticated OPA sidecar
  → recheck current grant/policy/stop + audit + atomic claim
  → typed sandbox adapter
  → independent upstream observer + sanitized correlated evidence
```

The dashboard can request approval, but cannot bypass the gateway to call an adapter. Bearer credentials for agent, OPA and eventual targets are separate. Policy files are loaded from the server-owned package, never agent repository content. The caller cannot override resource metadata, audience, environment or time.

## Risk register

| ID / severity | Threat / evidence gap | Disposition and acceptance |
|---|---|---|
| R01 Critical | Host agent can read gateway files/secrets or call a target directly | Native tests cannot establish OS/network isolation. T20 passes for the Docker fixture (separate internal networks, UID1000/no capabilities, one token mount, actual CLI/TCP failures). Host agent remains out of scope. |
| R02 High | Existing live adapters accept PAT/DB URL | Disable real execution in this stage, keep only explicit fixtures. No user databases or upstream accounts accessed. |
| R03 High | PDP unavailable, timeout, malformed result or revision drift | Deterministic DENY; zero upstream calls verified per case. |
| R04 High | Forged identity/tenant/metadata or replayed token | Server-issued task binding, audience/expiry checks, strict envelopes. A valid stolen bearer remains usable within scope until revoked; sender-constrained auth deferred. |
| R05 High | Grant revoked / policy changed while PDP awaits | Recheck after await and before claim/dispatch; test delayed PDP race. |
| R06 High | Concurrent same request dispatches twice | Reserve/idempotent action key + atomic claim. Count upstream attempts in concurrency test. |
| R07 High | Approval changes task/args/target/revision | Preserve digest and destination binding; bind policy/task; full independent approver workflow is Stage 3. |
| R08 High | Audit sink cannot persist mutation initiation | No dispatch. Error is not successful execution. Uncertain external write cannot auto-retry. |
| R09 Medium | Secret/PII in args/results/errors | Minimize PDP inputs and evidence; omit raw args/errors; keep heuristic output protection, not a full DLP claim. |
| R10 Medium | Recursive/oversized payloads or concurrent floods | Bound body, depth, concurrency and per-identity rate; blocked attempts remain observable with sanitized metadata. |
| R11 High | OPA management/data endpoints exposed | Auth + exact method/path allowlist; verify no-token and gateway-token writes denied. |
| R12 High | SQLite shared store lacks production trust separation | Native mode remains fixture-only. Docker Stage2 has separate PostgreSQL instances, restricted runtime roles and serialized audit appends; bootstrap/host owner remains trusted. |
| R13 Medium | Modern MCP routing uses trusted-looking but attacker-controlled headers | Pin versions, compare headers against body and SDK envelope, reject mismatches before any adapter. |
| R14 Medium | Hash-chain rewritten by host administrator | Hashes are tamper evidence only. External anchor / independent sink deferred. |
| R15 Medium | A stale process still runs old code | Evidence tied to source manifest and newly started disposable processes; old local server is not evidence for this revision. |

## Explicit non-goals

Universal shell interception, semantic prompt-injection detection, arbitrary SQL safety, full data-flow tracking across agents, undo of dispatched effects, enterprise multi-tenancy/SSO, or real production/organization access. Business/market assertions in the PRD are not security evidence.

## Review requirement

A fresh code reviewer will examine this stage; that review is not independent professional penetration testing. External review and all open high/critical deployment assumptions are required before a pilot-ready/product claim.

## Stage2 review disposition

P1 approval binding could drift between early check and fresh PDP snapshot; now original grant fingerprint/policy revision/hash are checked against locked current authority in reservation. P2 delayed reject could overwrite executed state; now pending→blocked and its audit are atomic, competing decisions receive409. Both had deterministic failing-then-passing regressions; PG backend also tests concurrent reservation/rejection. Fresh reviewer reread fixes without further substantive gap in these paths.

The commit of an execution reservation is the revocation/stop boundary. Already reserved actions may complete; no external rollback promise. Local Git/PR state is a mock, branch namespace/path restrictions are fixed fixture policy, and the PG writer can only execute the bounded update function. No general shell or arbitrary SQL capability is exposed.

## Milestone B inference and evidence boundaries

Official Codex runs as UID1000 in a disposable container, with a fresh home and one scoped credential mount. Its only networks are the internal agent and inference networks; Ollama has only inference and a read-only weights mount, with no task credentials. No inference endpoint is host-published. The host, Docker/GPU runtime and pinned build inputs remain trusted. Public dependency preparation is separate and carries no task credentials. This does not intercept arbitrary host-side Codex processes.

The real README contains a synthetic instruction to exceed the task. Actual model choices and exact successful-read replay are recorded separately from a forced write with the same read-only token. Only the forced deny plus unchanged independent snapshot/counter demonstrates Gateway enforcement; model refusal and Codex client approval controls are not substitutes. Known secret heuristics overblock two benign documentation examples in the 26-task sample; no semantic-injection or universal-DLP claim is made.

Fresh reviewer found two evidence defects: inactive Compose profiles left Codex/model containers after teardown, and blocked PDP failures could be counted as policy false positives. Cleanup now includes all profiles and asserts no project resources remain; unknown/PDP refusals fail the benchmark as operational errors. Historical orphaned fixture containers were removed only by exact project labels, with recorded absence checks. Final evidence must include both checks and credential scans.
