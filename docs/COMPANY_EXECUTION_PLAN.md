# Company execution and acceptance register

Updated 2026-11-17. Source: [unaltered founder strategy](specification/COMPANY_MASTER_PLAN_2026-11-17.md). Its long-term outcomes are objectives, not existing capabilities or permission to contact customers, spend money or deploy externally. The strategy explicitly sequences GitHub/PostgreSQL before CI/CD and broader cloud integrations after demand. This register supplements, rather than replaces, [Enterprise gaps](ENTERPRISE_GAP_ANALYSIS.md), [production readiness](PRODUCTION_READINESS.md) and [security evidence](SECURITY_EVIDENCE.md).

## All fourteen strategy sections

| Section | Deliverable / current evidence | Owner and next acceptance |
|---|---|---|
| 1. Opportunity | [Primary-source comparison](commercial/MARKET_VALIDATION.md); no unique-security claim | Founder: validate differentiated value in interviews and matched trials |
| 2. Ten reasons to buy | Interview scorecard plus executable cost model; no measured customer savings | Founder + customer: independent security review, bounded execution, installation time, agent compatibility, privilege scope, update work, evidence, reliability/support, alternative comparison and total cost must each have customer evidence |
| 3. Technical core | Existing Gateway, OPA, grants, approvals, replay controls, typed GitHub/Postgres adapters; Docker-specific boundary | Engineering: current-revision release suite, real sandbox and independent review. Vault, general sequence policy, cross-agent control, host enforcement, GitLab/Bitbucket/cloud/IaC/Kubernetes remain future scope |
| 4. Verified Action Control | Existing intent/grant/preview/decision/dispatch/disclosure records. Receipt is not an independent observation | Engineering + independent reviewer: reconcile GitHub commit/tree/PR and database state; preserve UNKNOWN on missing/ambiguous observation; never infer rollback from output withholding |
| 5. Security | Existing threat model, adversarial isolation/replay/secret tests and scanner gates | Independent AppSec reviewer: scoped critical/high findings resolved and verified. OWASP/NIST references are frameworks, not certification or exhaustive coverage |
| 6. Enterprise | OIDC/SCIM/MFA/SIEM and restore implementation has local synthetic integration evidence; separate private installation per organization | Engineering + customer IAM/SOC + Yarin: real IdP/SIEM, off-host recovery, operational drills. Native SAML, managed KMS, HA and shared multi-tenancy not delivered |
| 7. Defensibility | Existing adversarial corpus, source-bound reports and review kit | Founder: assign independent research owner, maintain regression provenance and responsible disclosure. No cross-customer telemetry without explicit consent; no claim of a staffed research lab |
| 8. Build vs buy | [Measurement contract](commercial/MEASUREMENT.md), frozen-plan CLI, cost calculator | Customer + founder: representative paired trials. Existing 208 synthetic observations:16 false blocks (7.6923%); target <2% NOT MET. Repeating templates is not independent sampling |
| 9. Revenue | Draft packaging and metric definitions in market-validation kit | Founder: first executed paid agreement and actual revenue record. No actual ARR/ACV/CAC/NRR or billion-dollar forecast is manufactured |
| 10. Distribution | Developer/private-install documentation exists; draft adoption/expansion/sales sequence | Founder: real trial adoption, consented references, partner contracts and renewal evidence before scaling. No public launch, license change or outreach performed |
| 11. Team | Yarin founder and temporary operations owner; automation assists engineering | Founder: appoint independent AppSec reviewer, legal adviser, then solutions/customer success as demand proves need. Appointment alone is not operational competence evidence |
| 12. Gates | Explicit dependency table below | Gate owners sign actual evidence; a generated document cannot approve its own gate |
| 13. Immediate work | Existing outcome fix retained; measurement tooling added; sandbox permission mismatch detected before token mint; clean image verified | Engineering: resolve live prerequisites, complete fresh-host/real-agent validation; no feature expansion to conceal failed acceptance |
| 14. Long-term value | Testable proposition: complete a defined development change with less integration/operations work and better evidence | Founder + customers: repeated comparative value and retention. Security superiority and scale remain hypotheses |

## Progress gates

| Gate | State | Exit evidence |
|---|---|---|
| 0. Local MVP | Historical scoped passes; installed service preserved | Existing reports identify tested revisions. New source does not inherit a release pass |
| 1. Security validation | OPEN | Current-revision release gates including actual Codex workflow; bounded live GitHub with target reconciliation; clean Ubuntu install/restore; independent human review with no open critical/high findings in pilot scope |
| 2. Market validation | OPEN; preparation can run alongside gate1 | 20 completed interviews,3 controlled pilots, first paid customer, positive measured value and intent to continue. Pilot execution waits for gate1 and written scope |
| 3. Commercial v1 | OPEN | Repeatable private installs, real operations/support response, accepted contracts, multiple paying renewals and measured service costs |
| 4. Enterprise platform | OPEN | Customer IAM/SIEM procurement tests, justified HA/scale controls, customer security acceptance and first Enterprise agreements |
| 5. Global scale | OPEN | Repeatable sales, retention, sustainable unit economics, staffed support/research and partner distribution |

No gate is closed by mock customers, assumed security-review approval, synthetic ROI, a container substituted for a fresh host, or a model run that only completes its first read.

## Binding decisions and limits

- Keep deterministic enforcement; model output cannot expand authority. Fail closed remains mandatory. A timeout after dispatch remains uncertain until reconciliation; it does not authorize an automatic duplicate write.
- Initial commercial boundary is isolated agents, a named synthetic GitHub repository and typed database operations. Free host agents with independent credentials/network are outside demonstrated protection.
- Private per-customer deployment first. No shared-tenant claim, universal endpoint DLP claim or 99.9% contractual SLA from a short load test.
- Scope, source, model, topology and task labels are frozen before trials; operational failure/missing evidence remains visible. Do not suppress placeholder-secret false blocks or relabel tasks to reach a target.
- Broad integrations wait for the strategy's demand gates. This postponement risks slower broad-market adoption; building them before demand would conflict with the supplied sequence.
- GitHub bounded trial was explicitly approved on2026-11-17. GET/app authenticated successfully, but extra repository_custom_properties:write stopped preflight. Chrome identity confirmation completed; automation could read but could not click/capture the permission page. Yarin deferred the manual reduction until later. No repository write or installation token from this preflight. See latest-github-live-preflight.json; recheck after correction without repeating approval.
- Ubuntu image preparation passed in evidence/clean-linux-preparation-96348245-841f-4c82-a3b2-c6af1657bda3. Signature/checksum preparation is not a VM install pass.

## Operating cadence and evidence ownership

Yarin owns gate decisions and customer/operations records. Engineering records immutable run IDs, source manifests, test counts and failure causes; external reviewer owns their signed assessment. Weekly review: open findings, failed gates, protocol/dependency changes and incident readiness. Monthly: consented interview/pilot evidence and measured service costs. These are proposed working practices; no reminders or external communications have been scheduled.

Research-case template: ID; threat/boundary; attacker capability; expected pre-dispatch decision; target baseline; actual dispatch/effect/disclosure; independent observation and timestamp; replay/race outcome; source/model/tool versions; minimal synthetic reproduction; owner/severity/fix; regression run; disclosure approval. Do not copy customer prompts, source or secrets into a shared research corpus.
