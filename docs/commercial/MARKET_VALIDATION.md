# Market validation kit — prepared, not executed

2026-11-17. No interviews, outreach, customer pilots, contracts or payments were performed by preparing this kit. Target: software organizations with20–200 developers already giving development agents meaningful access. Initial buyer hypothesis: engineering/platform lead together with AppSec; verify budget ownership rather than assuming it.

## Primary-source landscape

Sources consulted2026-11-17. Vendor documentation establishes claimed scope, not comparative effectiveness or suitability for a particular customer.

| Alternative | Documented scope | What AgentBrake must demonstrate |
|---|---|---|
| AWS AgentCore Policy | Cedar-compatible policies; temporal/session conditions use Dogwood; default deny and forbid precedence ([core concepts](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-core-concepts.html)) | Lower total deployment/operations effort for the customer's matched workflow, not merely a policy engine |
| Microsoft Entra Agent ID | Agent principals, blueprints, sponsors and lifecycle identity ([identity documentation](https://learn.microsoft.com/en-us/entra/agent-id/agent-identities)) | Complement identity with target-specific execution/reconciliation; avoid claiming identity alone is absent elsewhere |
| Runlayer | Gateway, tool/identity controls, approvals, runtime and endpoint discovery ([vendor platform](https://www.runlayer.com/)) | Measured scoped execution/evidence/usability value; “beyond MCP” alone is not a unique proposition |
| Palo Alto Prisma AIRS | Agent runtime/identity and endpoint security offerings ([agent security](https://www.paloaltonetworks.com/prisma/agent-security)) | A concrete smaller workflow with comparable threat assumptions and support costs, not unsupported superiority |
| Customer-built solution | Actual engineering ownership, integration and response commitments must be elicited | Compare equivalent coverage, maintenance, review, support and outage assumptions |

[OWASP Securing Agentic Applications V2](https://genai.owasp.org/resource/securing-agentic-applications-v2/) is dated2026-11-10. [NIST SSDF](https://csrc.nist.gov/Projects/ssdf) and [MCP security guidance](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices) inform threat/review work; none certifies AgentBrake. MCP token audience and no passthrough tests do not establish a complete interoperable OAuth authorization server. Do not reuse the source strategy's HSBC numeric benchmarks in sales material without independently validating the study and population.

## Twenty interviews

Recruitment plan:8 engineering/platform owners,8 AppSec/security owners and4 technical budget/procurement owners across at least10 organizations. Track one organization cohort separately so multiple colleagues do not inflate organization-level demand. No list of fabricated prospects or unsolicited messages is included.

Interview record (one per participant, pseudonymous ID): organization segment, role, consent/date, current agent/workflow, protected targets, actual incident or near miss, existing workaround, implementation/maintenance hours and source, purchase process, owner/budget range if volunteered, concerns, requested next step, evidence link. Store contact details separately with access control. Default notes only; recording requires consent. Draft retention:30 days after evaluation, unless a separately agreed purpose requires longer. No production prompts or credentials.

Thirty-minute protocol:

1. Ask for the last real agent workflow requiring write access; who approved it and what happened when it failed?
2. Trace credential distribution, network access and direct-terminal bypass. Ask which resources must be excluded.
3. Ask how unauthorized changes, uncertain timeouts, repeated requests and leaked output are handled today.
4. Ask for current installation, review, maintenance and incident effort with evidence or explicitly labelled estimates.
5. Show a bounded synthetic allowed action, denied action, approval/replay and UNKNOWN result. Ask which part would change their purchasing decision.
6. Compare their existing control/vendor/internal build on the same task. Record disadvantages too.
7. Ask who can sponsor a30-day isolated pilot, the procurement blockers and what outcome merits payment/renewal. Interest without an owner/resources/date is not a committed partner.

Qualification scorecard: each of the ten buy criteria in COMPANY_EXECUTION_PLAN section2 gets observed pain, current baseline, importance0–3, evidence confidence and purchase blocker. A strong partner has a named technical owner, security owner, isolated environment, relevant repeated workflow and explicit measurement commitment. Do not turn the score into proof of demand.

## Three controlled pilot proposals

Use three distinct consenting organizations, not three runs on this workstation. Each proposal records sponsor, isolated target, exact version/model, task corpus, authorized operations, exclusions, rollback/stop contacts, data minimization and support hours. No production data. Contract/privacy/security review precedes execution.

Day1–5: validate boundary, clean install and restore, freeze paired baseline/tasks. Day6–20: run agreed legitimate and adversarial cases; record developer time, approval delay, target reconciliation and support effort. Day21–30: review failures with both owners; compare alternative total cost; decide stop/extend/pay. Zero forbidden effects in the defined attack suite is required; UNKNOWN is unresolved, not prevention. At least200 eligible benign tasks are needed for the tooling's <2% sample target, but diversity and independent review remain necessary. Installation target: within one technical working day; record actual elapsed and hands-on time separately. No99.9% promise before sustained operational evidence.

Stop immediately for an unexpected target effect, exposed credential, scope expansion, failed kill switch or inability to reconcile a consequential write. Revoke task/connector authority, preserve minimized evidence, notify the named operator through the agreed channel and use ENTERPRISE_OPERATIONS.md. Resume only after root-cause review and explicit pilot-owner acceptance.

Proposed offer, not a quote: one private environment, one bounded development workflow, setup/testing/report and defined business-hours assistance. Earlier1500–4000ILS pilot pricing is an unvalidated willingness-to-pay hypothesis; no price is agreed here. Do not charge per denial in a way that encourages disabling enforcement. Broader Team/Business/Enterprise/Strategic packages remain segmentation hypotheses; features and support must match delivered capabilities. Do not promise all integrations, indemnity, compliance or24/7 support.

## Business ledger definitions

Record actual dated transactions/contract IDs outside this repository. ARR is annualized recurring contracted revenue, excluding one-time pilots; ACV compares recurring annual contract value on a consistent basis. CAC includes attributable acquisition spend and staff cost divided by new customers; return undefined when denominator0. Gross margin deducts actual delivery/support/hosting costs. NRR=(opening recurring revenue+expansion-contraction-churn)/opening recurring revenue; GRR excludes expansion. Define the same cohort/time window and report unknown when no opening revenue. Sales cycle starts at a documented qualification event; time-to-value ends at the first customer-accepted protected outcome. Do not report zeros as measured results when the ledger has not been populated.

Distribution sequence: documented private trial → customer-approved team expansion → Enterprise procurement. Partner/MSP/cloud-marketplace arrangements, open-source licensing, hiring, SOC2 organizational controls and legal terms require their own real agreements and evidence. Drafts cannot substitute for these outcomes.

## First-offer procurement record — internal draft, not sent

The controlling profile/requirements are in ENTERPRISE_GAP_ANALYSIS C01–C20. Offer only a separately installed, single-organization evaluation of one approved coding workflow; no broad Enterprise availability, operational acceptance or certified protection claim. The current two-read model demo is not the coding demonstration promised for admission. Select actual IdP/SIEM only with the sponsor's requirements and authorization; fixture interoperability is not vendor acceptance.

| Buyer question / deliverable | Existing material and honest answer | Required owner/action before sale |
|---|---|---|
| What service am I buying? | PILOT_READINESS defined operations/exclusions and measurable30-day proposal; finite setup/testing/report/support scope | Sponsor and Yarin agree exact workflow, named version, hours, response window, fee and stop conditions; price remains hypothesis |
| Where does data go? | ENTERPRISE_OPERATIONS data map + threat/boundary diagrams; no hidden vendor telemetry | Customer/privacy owner accepts each store/export/backup destination, residency, retention and support-bundle review |
| What has been tested? | Single C01–C20 matrix links exact-source local/REST/CI evidence | Independent reviewer signs the defined revision; missing external audit report is explicitly NOT_OBTAINED |
| Can I run it with existing CI? | Current App profile requires no workflows and disabled Sandbox Actions; no merge/deploy | Customer platform owner inventories hooks/bots/downstream execution; CI-enabled profile not yet accepted |
| Who owns secrets and privileged access? | Customer operator holds restricted secret files and host/Docker authority; isolated agent holds only task credential | Named key custodian, rotation/recovery/revocation plan; shared tenants/KMS not claimed |
| How are incidents and updates handled? | SERVICE_OPERATIONS and ENTERPRISE_OPERATIONS pause/revoke/preserve/reconcile paths | Yarin supplies monitored contact/escalation and maintenance coverage; security update triage/retest/notification and supported-version/EOL notice agreed in writing; no invented24/7 or fixed SLA |
| Can you recover my installation? | Local authenticated cold restore, authority suspension and SSO-marker checks | Approved off-host encrypted storage, separate recovery custody and independent resumed restore drill; measured RPO/RTO and volume limit accepted |
| Third-party licenses and ownership? | Root/dashboard SBOM and pinned image inventory exist for each verified revision | Legal/release owner reviews dependency/image/model/tool licenses, code ownership, redistribution and AgentBrake name/trademark; SBOM is not legal clearance |
| Privacy/DPA and contract terms? | Scope/data map/subprocessor inventory/support limits are inputs | Qualified legal review drafts parties, roles, processing purpose/data classes, retention/deletion, incidents, subprocessing, liability and termination. No binding DPA or legal adequacy claimed |
| Why buy instead of build? | Existing cost calculator with explicitly marked assumptions and matched-scope interview protocol | Buyer supplies actual staff time, current control, support/review cost and renewal criteria; no fabricated ROI/competitor benchmark |

Prepared quote fields: customer/sponsor/operator/approver; exact installation/repo and permitted actions; version/image/package/approval IDs; exclusions; prerequisites; installation+help time; frozen corpus and baseline; support hours and escalation; trial dates; fee/currency/payment terms to agree; data/backup custody and retention; no-go conditions; acceptance signatures and renewal/termination review. Leave unknown fields unfilled. Neither this draft nor the research authorizes outreach, external delivery or access.

Latest acceptance targets replace inconsistent older marketing ambitions: installation<60min after prerequisites (also record total and assistance), completion>=95% of matched baseline, false blocks<2%, zero unauthorized/duplicate effects in mandatory enumerated cases. Historical 15min/one-day/99.9% figures remain unproved ambitions, not current service promises.
