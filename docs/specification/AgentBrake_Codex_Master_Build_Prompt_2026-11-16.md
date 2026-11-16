# MASTER BUILD PROMPT — AgentBrake (Codex)

You are the Principal Security Architect, Staff Backend Engineer, MCP Protocol Engineer, AppSec Reviewer, QA Lead and Product Engineer responsible for building a **security product whose enforcement must be demonstrably real**.

## Source of truth

Read the attached `AgentBrake_Product_Security_PRD_2026-11-16.md` completely before planning or editing. Its decisions PD-01–PD-28, features FR-01–FR-09, threat model, tests T01–T30 and milestone gates are binding, unless a documented security reason demands changing them. Explicitly report any conflict or deviation in an ADR. The file is a proposed baseline, **not evidence that any functionality already exists**.

## Mission

Build the complete locally executable AgentBrake MVP, with a genuine MCP enforcement point that mediates authenticated agent tool calls to safe GitHub and PostgreSQL sandbox adapters. A blocked action must be proven **not to have reached upstream**; a permitted action must have an accurate trace. Human approvals must be bound to the exact action and usable once only. The policy engine must work outside the LLM and be fail-closed.

Do **not** build a cosmetic security dashboard or fake a successful security review. Product and security correctness take priority over polish.

## Fixed architectural decisions

- TypeScript/Node.js for the Gateway/PEP and control API.
- Official current MCP TypeScript SDK, interoperable with current spec `2026-07-28`; document and test any required support for `2025-11-25`. Do not accidentally rely on 2025-only session/handshake semantics. Follow the officially documented SDK API available in the environment; validate actual library/package versions before coding.
- Next.js + React for dashboard and admin flows, separate from the enforcement runtime.
- Open Policy Agent (OPA)/Rego PDP, with explicit tests and fail-closed behavior. Never expose an unauthenticated PDP control endpoint on a host-accessible port.
- Separate PostgreSQL control/audit DB and PostgreSQL target fixtures, isolated Docker network.
- GitHub App for eventual sandbox repo connection; start with reliable mocked adapter and a carefully scoped, explicitly configured test-repo connector. Do not use a broadly privileged PAT or real customer org repo.
- Typed tool adapters, strict argument schemas, authorization inputs based on **trusted** resource metadata. Do not invent a production-capable arbitrary SQL interpreter.
- Credentials broker controls scoped secrets. The agent must not hold the upstream credentials, and its isolated test process must not have a second network/CLI path to the protected target.
- Default DENY. Audit before dangerous execution; if audit for a mutation cannot be persisted, DENY. Unknown action, malformed payload, unavailable PDP, approval mismatch, revoked task, and expired grant => DENY.
- Approval identity/task/target/arguments/policy bound by canonicalized fingerprint, expiry and single-use token; recheck authorization on execution and address replay/race conditions.
- Preserve honest limitations: an MCP gateway does NOT automatically intercept Codex shell commands, direct API traffic, or pre-existing environment credentials. Demonstrate isolation using permissions and actual negative tests; don't claim a universal agent firewall.

## Explicit safety boundaries

1. **Do not connect to any production system** or deploy externally.
2. **Do not** read, delete, reset, migrate or modify existing application/customer databases. Only create isolated local fixture databases with known names.
3. **Do not** access a real GitHub organization or repository unless explicitly supplied as a disposable sandbox. If none is supplied, use mocks and create a configuration template.
4. **Do not** store secrets in git, test snapshots, browser state or logs.
5. **Do not** run destructive tests against host system paths or unrelated projects. Use disposable containers and volumes clearly labeled AgentBrake.
6. **Do not** change global Codex config or system-wide credentials automatically. Emit suggested MCP configuration and optional explicit local opt-in.
7. Do not weaken tests to make them pass. If a test fails, diagnose the product, fixture or environment and keep a transparent record.

## Required development stages — implement, verify, then proceed

### Stage 0 — Inventory and plan
- Inspect repo and runtime, identify what exists vs missing. Produce `docs/PLAN.md`, `docs/ADR/`, `docs/threat-model/THREAT_MODEL.md`, `docs/TEST_MATRIX.md` before implementation.
- Define exactly which MCP methods and protocol era the first iteration supports.
- Build a risk register. Identify all unknowns, fallback behaviors and agent escape routes.
- Avoid changing unrelated files.

### Stage 1 — Enforcement core
- MCP Gateway intercepts supported `tools/list` / `tools/call`; strict schemas; default deny; correlation IDs.
- OPA policy engine with typed input and deterministic `ALLOW`, `DENY`, `REQUIRE_APPROVAL` contract.
- Synthetic agent client + fake upstream adapter counting calls.
- Prove that expired/invalid/unknown requests and unavailable PDP never reach upstream. Show negative tests.

### Stage 2 — Controlled integrations
- PostgreSQL fixture adapter with read-only credentials, allowlisted templates and server-side safety constraints.
- GitHub mock and safe feature branch / PR workflow; optional sandbox GitHub App only with explicit user-configured app and selected repo.
- Task grants, policy versions, environment boundaries and short-lived credentials.
- Document precisely which resources and actions are protected vs unobserved.

### Stage 3 — Approvals and evidence
- Human approval page with exact action preview; action hashing, TTL, binding and atomic consume-once; prevent action-swap and race/replay.
- Event model, audit trails, redaction, evidence packets, status `UNKNOWN` for indeterminate effect.
- Stop/revoke semantics for new actions with documented in-flight limitations.

### Stage 4 — Dashboard and installability
- Next.js production-quality UI for Connections, Tasks, Activity, Approvals, Policies, Evidence and Demo Lab.
- Docker Compose deployment with clean, reproducible local startup, migration and fixture setup.
- Clear README with commands/config, tests, demo, threat boundaries, known limits.

### Stage 5 — Adversarial and integration tests
- Execute mapped T01–T30 acceptance cases from the specification. Use controlled prompt-injection fixtures, not real attack traffic.
- Verify target-side state unchanged after deny; verify direct bypass cannot access target from **isolated agent fixture**.
- Test exact approval mutation, replay, timeouts, concurrency, policy update mid-approval and misconfigured credentials.
- Benchmark legitimate task completion and false blocks; report sample sizes, not merely percentages.

## Evidence required for EVERY milestone

Report:
- Implemented files and architecture map.
- Tests executed with exact commands, run IDs, build commit hash, pass/fail, trace IDs and sanitized observed output.
- The test matrix showing PASS / FAIL / NOT RUN (never conflate the three).
- Credential and network boundary verification.
- Security issues, bypasses and limits, with severity and explicit disposition.
- The next highest-risk assumption, backed by a reproducible local test.

Never say “secure”, “production-ready”, “all passed”, “no vulnerabilities”, or “unbypassable” without bounded, verifiable evidence. A simulated demo cannot be presented as proof of production prevention.

## Product constraints

- The differentiator is **task-bound control over agent-driven developer changes** plus actionable evidence. A generic authorization proxy alone is insufficient as the final product.
- No paid billing, enterprise SSO, broad AI risk scoring, generalized shell scanning, production deployments or new integrations until the core security milestones pass.
- Prefer shipping a small, secure, demonstrated path end-to-end rather than a large unsupported surface.
- Product UI should clearly label “Demo / Isolated Environment” and state observed protection boundaries.
- Keep all policy and tool decisions explainable and reviewable by security practitioners.

## Deliverables

1. Executable source + lockfile + environment sample + migrations + isolated fixtures.
2. Clear local launch command and MCP client integration instructions.
3. Functional demo with safe read, blocked destructive DB request, approval-bound GitHub PR proposal.
4. Unit, integration, adversarial and protocol-compatibility tests, with reproducible commands.
5. Full Product-to-Test traceability, threat model, known limitations, evidence/operations docs.
6. Final summary: WHAT ACTUALLY WORKS / WHAT IS SIMULATED / WHAT IS UNSUPPORTED / WHAT FAILED / WHAT NEEDS INDEPENDENT REVIEW.

Begin with the repository inventory and concrete staged implementation, not open-ended questions. When required credentials or a sandbox GitHub App are absent, build the isolated local path fully and leave the real connector disabled with documented setup, rather than asking for production credentials.
