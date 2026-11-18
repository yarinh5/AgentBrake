# Company master plan: security and commercial validation

> **For agentic workers:** Use superpowers:executing-plans inline. User delegated routine decisions; no repeated design-approval loop. One scoped fresh review at the end.

**Goal:** Turn the supplied company strategy into a traceable gated program and working, honest pilot/Build-vs-Buy measurement tooling; advance permitted security validation without inventing customer or external acceptance.

**Architecture:** Reuse existing Gateway, OPA, task grants, approval/evidence, Enterprise identity, isolation and release gates. Add an offline operator tool with strict bounded JSON, frozen task labels, explicit missing/unknown data, paired baselines and cost assumptions. No agent permissions or installed service changes. This delivery prepares and tests measurement; it cannot manufacture interviews, payment, human review or full release acceptance.

**Tech Stack:** Existing Node22 ESM, Zod, node:test; no new dependency or external service.

**Spec:** docs/specification/COMPANY_MASTER_PLAN_2026-11-17.md (unaltered user attachment).

## Global constraints

- Local synthetic data; no Production/customer data, payment, external deployment or outreach. Existing product-local preserved.
- Prior explicit named GitHub App/write approval remains required. Exact sandbox proposal already prepared; asynchronous approval question sent; no connection until affirmative answer.
- No Git repository/init/commit. Source manifests identify revisions. Existing failed Codex CPU20minute attempt remains FAIL; no further speculative prompt/catalog/timeout tuning.
- Separate private installation per organization; do not implement every long-term integration before the document's demand/validation gates.
- Approval/effect/disclosure stay distinct; UNKNOWN is not success or proven prevention. No decrease of existing secret policy to manufacture <2%.
- Primary vendor/standards research establishes documented capabilities, not comparative security superiority or commercial outcome.

## Review focus

- Missing/duplicate/unknown task IDs or relabelled corpus must not improve completion or false-block metrics.
- Withheld output after execution is a usability failure, never proof that execution was prevented.
- Failed baselines, UNKNOWN target state and absent evidence must remain visible and cannot produce a met acceptance target.
- Reported observations are operator inputs, not independently authenticated target proof; synthetic sample cannot become field validation or SLA.
- Invalid numeric/currency/time fields, huge inputs and overwrite attempts fail; cost estimates are assumptions, not price promises or measured savings.

## Tasks

### 1. Traceability and primary-source checks

- [x] Read attachment, existing gap/evidence, pilot/GitHub/Linux runbooks and measurement code.
- [x] Preserve exact attachment. Verify current implemented capabilities rather than its stale status labels.
- [ ] Add docs/COMPANY_EXECUTION_PLAN.md mapping all14 sections, gates0–5, owners, evidence, acceptance and dependencies.
- [ ] Add docs/commercial/MARKET_VALIDATION.md: primary-source comparison,20-interview protocol,3-pilot proposal, Build-vs-Buy measurement, pricing hypotheses, no sent outreach or invented customer commitments.
- [ ] Verify clean-VM prerequisites read-only; report unavailable hypervisor rather than Docker as clean-host proof.

### 2. Frozen pilot measurement and cost model

Files: scripts/pilot-measurement.mjs, tests/enforcement/pilot-measurement.test.mjs, docs/commercial/MEASUREMENT.md, docs/pilot-sandbox/measurement-plan.json and synthetic-observations.json.

Interfaces: freezePlan(input, now) returns schema1/frozenAt/plan/planHash; evaluatePilot(frozen, observations) returns reported metrics with no admission authority; compareCosts(input) returns explicit firstYear/annual totals and differences. CLI `freeze input.json output.json`, `evaluate frozen.json observations.json output.json`, `cost input.json output.json`; exclusive writes; bounded regular-file reads. Evaluate returns exit2 for incomplete/unmet metrics, not a silent success; calculation output is never a commercial/security sign-off.

- [ ] RED: tamper, duplicates/foreign tasks, missing observations, failed baselines, withheld result, UNKNOWN/unexpected target, exactly2%, sample<200, synthetic-only claims, numeric/currency bounds, cost arithmetic, filesystem CLI/no-overwrite.
- [ ] Implement strict schemas, SHA256 canonical plan binding and metrics derived from frozen labels. Denominators include all planned benign tasks; separately report paired-baseline availability and operational/missing counts. Percentiles exclude missing timings and explicitly report counts. Receipt presence is reported only, not verified validity.
- [ ] Use existing benchmark semantics where applicable; do not rewrite historical208-task results. Document sample independence limits.
- [ ] GREEN focused tests; run actual CLI on frozen synthetic sample, preserve hashes/output/expectednonzero and no-overwrite proof.

### 3. Verify, review and record remaining gates

- [ ] Run native test/policy/type/build/UI gate and actual security scanner on final changed source. No unrelated rerun of failed CPU model without new evidence.
- [ ] Fresh scoped review of measurement integrity, authority claims, privacy and permissions. Resolve demonstrated findings with focused regressions.
- [ ] Final record includes source hash, exact tests/CLI outcomes, scope and stale full-release status. Update readiness docs with actual current work; do not overwrite historical successful release as current.
- [ ] If named live GitHub approval arrives, inspect actual permissions/automation/key registration and fail closed on mismatch; user approval does not waive prerequisites or enable Production.

## Execution ledger

- Ruling: The supplied strategy explicitly defers broad cloud/Kubernetes/HA integration to demand gates; implement its sequence, not an unbounded feature bundle. Twenty interviews/three real pilots/payment require real participants and separately authorized communications.
- Baseline source01e881; local-release still stale/failed. Existing implementation/action-output distinction and Enterprise controls are retained.
- No qemu-system-x86_64, VBoxManage, Get-VM or virsh command found in current shell. This is prerequisite discovery, not a complete hypervisor inventory or VM execution.
