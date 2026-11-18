# AgentBrake threat model — Stage 1

Current validation addendum (2026-11-17): the stage register below is historical. Current scope and explicit exclusions are in ENFORCEMENT_BOUNDARIES.md and KNOWN_LIMITATIONS.md. Team approvals and the opt-in GitHub App sandbox adapter now exist; the historical Sandbox REST trial28f3ddc1/source855b has scoped GH01–GH07 evidence, not live Codex/customer acceptance. No unrestricted host-agent enforcement or Enterprise certification has been added. The controlling commercial acceptance matrix is C01–C20 in ENTERPRISE_GAP_ANALYSIS.md.

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

## Historical Stage1 non-goals

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

## Opt-in Enterprise extension — 2026-11-17

This extension supersedes Stage1's SSO deferral, while retaining a dedicated installation per organization and the host/daemon/operator trust assumption. Scope and actual evidence are in ENTERPRISE_OPERATIONS.md, ENTERPRISE_GAP_ANALYSIS.md and enterprise-work/{identity,siem,container,restore-acceptance,REVIEW}.md. Agent review is not independent human sign-off. No native SAML, KMS, shared multi-tenancy or HA guarantee is added.

New boundaries: the browser redirects to the configured IdP; its callback crosses HTTPS ingress and the dashboard proxy into control. Only control holds the confidential client, provisioning and sink credentials. The fixed-route egress reaches configured token/JWKS/sink HTTPS endpoints. A dedicated provisioning client uses a separate SCIM bearer and never an agent token. The audit sink acknowledges a minimal projection of persisted source events; a durable cursor records accepted events. The agent has neither the new credential mounts nor access to control/enterprise networks. The separate publication bridge still contains only the credential-free fixed ingress because of the documented Docker29 host-port behavior.

| Threat / assumption | Control and observed local evidence | Residual boundary |
|---|---|---|
| Forged token, wrong issuer/audience, callback substitution/replay | Maintained pinned OIDC verifier, signed RS256 claims, PKCE/nonce/state, browser binding, one-use bounded pending state; synthetic signed IdP and real installed HTTPS flow | Customer metadata, client registration and actual provider interoperability require acceptance |
| Email auto-link or provisioning privilege escalation | Explicit immutable issuer/subject binding and configured group-role mapping; no automatic account/admin creation at login; revision checks across in-flight exchange | Compromised IdP can impersonate its provisioned subjects; compromised SCIM credential can act within configured provisioning authority |
| Local password/recovery bypass or stale MFA | SSO disables ordinary local authority flows; signed configured assurance at login and before control mutations; explicit audited emergency account only; full HTTP stale-mutation regression | Assurance values depend on actual IdP policy; physical MFA and emergency-account custody are not established by strings; reads keep bounded session lifetime |
| Offboarding fails at an HTTP boundary | Actual TLS/Next/proxy/control SCIM path accepts bounded bearer and bodyless DELETE; session and pending authentication revisions invalidated | Customer SCIM client subset acceptance remains required; already authorized/in-flight effects are not rolled back |
| Agent obtains new secrets or bypasses egress | Control-only mounts, exact destination/method routes, no redirects, bounded bodies; installed direct-IP probes, absent secret paths and Gateway404 checks | Host/daemon compromise and unrestricted host agents remain outside the boundary; no universal SSRF/kernel-escape claim |
| Lost/duplicated/reordered audit delivery or credential leakage | Stable installation/sequence IDs, chain anchor checks, exact full-batch ACK, durable single-writer cursor, bounded response/timeouts and retries; real local sink/crash/restart tests; raw payloads excluded | At-least-once duplicates require sink deduplication; sink persistence, immutable retention and on-call routing are not locally established |
| Restore silently disables SSO | Authenticated Enterprise/identity requirement markers; restored services stay stopped until explicit reprovisioning; regression and actual PostgreSQL backup/stopped-restore evidence | Trusted host can alter code/files; resumed restored IdP/sink and independent off-host recovery still need acceptance |
| Backup/signature mistaken for organizational trust | Existing authenticated backup with explicit copy/readback and link/overwrite refusal; Ed25519 subject/version/source verification with independently supplied public key | File modes are not verified Windows ACLs; same-host copies are not off-host custody; a fixture signing key is not company identity or hosted provenance |

Availability remains single-instance. IdP/sink/network failure does not authorize a password fallback or advance an unacknowledged cursor. Crash-lock recovery, certificate/credential renewal and actual incident response are operator responsibilities requiring exercises. No external telemetry or vendor connection was enabled by the local verification work. Final-source release evidence and the separate Enterprise packet identify what was actually executed.
