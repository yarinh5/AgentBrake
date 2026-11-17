# Enterprise gap analysis

2026-11-17. Product scope: private, single-organization candidate. Status labels describe implementation, not contractual readiness. Evidence entrypoints are SECURITY_EVIDENCE.md and exact-source reports. Owner roles below are required responsibilities, not assigned employees. No SOC 2, ISO, regulatory or SLA claim.

| Requirement | Existing / status | Missing acceptance evidence / owner |
|---|---|---|
| SSO OIDC/SAML | NOT IMPLEMENTED; password accounts only | Customer IdP, audience/issuer/redirect binding, deprovision/revoke/error tests, break-glass design; Identity engineering + customer IT |
| MFA | NOT IMPLEMENTED | MFA policy, phishing-resistant option, recovery and session elevation tests; Identity/AppSec |
| SCIM | NOT IMPLEMENTED; manual invitation/disable | Provision/group mapping, idempotency, offboarding and revoked-session tests; Identity/customer IT |
| Organization/team isolation | PARTIAL: one local tenant, roles, per-agent scope; no hosted multi-tenancy | Separate installation/credentials/network per pilot; cross-install/tenant abuse tests before shared hosting; Platform/AppSec |
| SIEM | PARTIAL: bounded JSON/CSV audit export and local telemetry | Delivery/auth/queue/backpressure/duplicates/schema contract, redaction, retention, operator alert tests; Security operations |
| Keys/secrets | PARTIAL: per-service files, scoped agent credentials, GitHub App broker, secure-cookie option | Managed secret store/KMS policy, rotation/recovery drill, Windows ACL/operator access and off-host recovery; Platform/security owner |
| Backups | LOCAL VERIFIED on prior release: bounded encrypted cold backup | Off-host destination, schedule, capacity growth, retention, recovery-key custody and alert test on candidate; Operations |
| Restore/DR | LOCAL VERIFIED on prior release: restore revokes authority, preserves data | Independent Linux restore, measured RPO/RTO, key re-provision and incident drill. No HA/PITR; Operations |
| Monitoring | PARTIAL: health/doctor, bounded logs, local telemetry | Availability/disk/backup/certificate/UNKNOWN alerts, on-call routing and response measurement; Operations |
| Incident response | DOCUMENTED manual pause/revoke/investigate | Named owner/contact, exercise, evidence custody, communication and key revocation drill; Security lead |
| Private deployment | PARTIAL: Compose, separate networks, loopback TLS candidate | Clean-host installation, customer private route, DNS/certificate/firewall and actual hardening validation; Platform/customer IT |
| Availability/capacity | LIMITED: one Gateway, fixed volume/export bounds | Load/capacity profile, restoration downtime, agreed service window; no replicas/automatic failover SLA; Platform |
| Supply chain / updates | PARTIAL: lockfiles, source hashes, SAST/SBOM/advisory checks, pinned image scan; CI prepared | Hosted run + enforced branch rules, release signing/provenance, dependency patch ownership, host/build/helper scans; Release/AppSec |
| Audit integrity | PARTIAL: local hash chain, correlated decisions/approval/outcome | Independent target reconciliation, external append-only sink/anchor if required; no resistance to trusted host admin rewriting; AppSec |
| Privacy/retention | PARTIAL: result retention and redacted exports | Audit/review/arguments persist; documented data map, deletion/retention agreement and reviewed support bundle process; Product/privacy owner |
| Compliance / procurement | NOT ATTESTED | Independent security review, control operation records, legal/privacy/support terms, buyer questionnaire; Founder + external reviewers |

## Sequencing decisions

First pilot: one separate installation, synthetic data, two managed human roles, local targets or explicitly approved disposable GitHub, no production. Unmet SSO/MFA/SIEM requirements must be disclosed and accepted for that restricted evaluation, or the pilot does not start. Do not describe a VPN as a substitute implementation of product MFA.

Before expanding privileges or customer data: close independent review, clean-host/live sandbox/operating gates; resolve critical/high findings. Prioritize SSO/MFA, key custody and SIEM only against actual customer acceptance requirements. SCIM, HA and shared multi-tenancy need separate design and threat-model changes; they are not part of this validation task.

Commercial prerequisites: named buyer/problem, agreed protected workflow, success measurement, support window and escalation, licensing/name/contract review and willingness-to-pay evidence. No interviews, customers or paid pilots are claimed here.
