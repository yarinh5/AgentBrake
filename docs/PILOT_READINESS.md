# Pilot readiness and measurement contract

Status: LOCAL PREPARATION; external pilot NOT ACCEPTED. Read ENFORCEMENT_BOUNDARIES.md, ENTERPRISE_GAP_ANALYSIS.md and PRODUCTION_READINESS.md. No production systems or real customer data are permitted by this plan.

## Defined offer and admission

One private installation for one organization evaluating approval-bound developer-agent changes: fixed synthetic PostgreSQL read/update workflow and, only after explicit authorization, bounded feature-branch/draft-PR changes in one disposable GitHub repository. Existing task grants, policy, independent approval, network/credential isolation and correlated evidence are the value being evaluated.

Before an external connected pilot: named technical sponsor, operator and independent approver; exact host/repo/App authorization; same-source release and image evidence; clean Linux acceptance; independent human security review with no open critical/high finding on the supported path; agreed stop/escalation process and data retention. Live GitHub case matrix must pass before it is represented as verified. A fixture-only demonstration is not that pilot.

## Protected and excluded

Protected within the tested topology: supported typed tool calls made by the isolated agent, task scope/expiry/quota, policy failures, approval substitution/replay, and tested direct target routes. Target accounts retain least privilege. Blocked before dispatch means no operation execute call; preview/identity read requests can occur separately and are not mutations.

Excluded: host agents with direct credentials/network, malicious host/daemon/admin, arbitrary SQL, production data, merge/release/deploy/delete/force/workflows, cloud operations, universal DLP/prompt-injection protection, rollback of dispatched effects, multi-tenant SaaS and HA. GitHub partial failures require reconciliation. A withheld result does not mean its action was prevented. Security findings pause the evaluation rather than relax controls.

## Data collected and handling

Collect only synthetic task IDs, pseudonymous agent/actor IDs, tool/scope, policy/grant/approval fingerprints, timestamps, decision, executionOutcome, resultDisclosure, target-state hashes and approved minimal before/after fixture fields; measure timings and user-reported friction. App numeric IDs/repo names and account email identifiers are identifiable metadata; treat them as restricted, not anonymous.

Do not collect prompts, repository source/customer rows, credentials, cookies, private keys or raw API errors into the sales/support dataset. The operational store DOES retain action arguments, preview/review and audit records; redaction is heuristic, so use synthetic content and manually review exports. Results default to 24h retention; other operational records/replay markers persist. Define pilot duration, restricted access, encrypted backup location, export retention and deletion owner before start. Do not delete idempotency records during an active run. End-of-pilot removal of the dedicated installation/backup is a separate recorded operator action, not broad host cleanup. No telemetry is sent to a company service by this task.

## Measurement protocol

Freeze a labeled task corpus before running. Separate benign tasks, expected approvals, hostile/unsupported attempts and operational failures. Record the same tasks against the agreed baseline and AgentBrake, agent/model/version/seed where supported, host resources and source/image hashes. Use multiple sessions/users; report sample counts and confidence/coverage limits. Never relabel inconvenient blocked tasks after observing results.

| Metric | Definition / proposed target (not achieved claim) |
|---|---|
| False blocks | Benign eligible tasks incorrectly denied OR rendered unusable by output withholding / all benign eligible tasks. Target <2% on an agreed representative expanded corpus; operational failures and missing results separately reported, never silently excluded |
| Legitimate completion | Tasks reaching independently verified expected state / eligible tasks; compare with baseline, report approval overhead and failures |
| Unauthorized effects | Independent target mutations for forbidden tests; zero observed in defined cases required; one unexpected effect stops pilot |
| Audit coverage | Protected actions with matched identity/grant/policy/review when required/dispatch/outcome/disclosure and target reconciliation where possible / all protected actions. Target 100%; missing or UNKNOWN remain explicit |
| Setup | Stopwatch from documented prerequisites satisfied to first protected verified workflow; also record total time including prerequisites/help. Proposed <60min; original PRD's 15min external install remains a separate unproven ambition |
| Latency | p50/p95 policy-only, full call, approval wait and full task duration separately; no SLA inferred from local policy time |
| Approval usability | Count approvals per completed workflow, time to review, rejected/reworked actions and user explanation comprehension |
| Commercial value | Sponsor confirms recurring workflow, baseline security/manual effort, acceptable support burden and willingness to pay; quote/pilot price remains a hypothesis |

Baseline is 24/26 completed, 2/26 false blocks (~7.7%), 12 approvals from a small curated deterministic corpus; actual local Codex workflow is separate evidence. This is not a representative market or model reliability result. For an initial expanded evaluation, preselect at least 200 varied benign tasks plus a separately enumerated attack set; even zero observations in that sample do not establish universal protection or population error rate.

## Go / no-go and closeout

No-go: unapproved target effect; credential exposure; bypass of the declared boundary; missing critical evidence; unexplained UNKNOWN; open critical/high finding; sponsor requiring unsupported controls. Pause/revoke new work, preserve evidence and reconcile; do not auto-repeat uncertain writes.

Closeout report records actual denominator/numerator for every metric, run/source/package IDs, cases not run, operator/reviewer sign-off, incidents, support time, customer feedback and commercial next step. A paid contract, access approval or independent security sign-off cannot be generated by an automated test. No pilot/customer outreach has been performed.
