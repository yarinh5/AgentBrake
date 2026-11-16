# Production acceptance and required access

Status: **not production accepted**. Follow PLAN_PRODUCTION.md and the exact-source reports; no customer or external-review evidence has been fabricated.

Local candidate0.3.0-rc.1 passed the full release gate and four-service-image scan on source993f7cbf1a3a56dcb421f88368efa67dbbcf37809d0d45b9cdf54e0ab80287c7. The machine-readable evidence/production-readiness.json correctly remains BLOCKED with three local gates PASS and five external gates NOT_OBTAINED. Product-local was subsequently upgraded to v0.3.0-rc.1/minimal-v1 with preserved data; this candidate has not been deployed externally.

| Gate | Locally prepared | External input needed |
|---|---|---|
| GitHub integration | Opt-in App broker, typed adapter, immutable IDs, review binding, partial-outcome handling, fixed egress and offline contract tests | Named empty disposable owner/repository; permission to read it and create feature branches/draft PRs; dedicated App installed only there; App/installation/repository/owner IDs; secure private-key file path |
| Private deployment | Separate HTTPS ingress, pinned browser origin, Secure cookies, least-privilege Compose, local install/health/browser/isolation tests | Dedicated Linux host or cloud account/region, host SSH access via configured key (not chat), exact domain and DNS administrator, certificate issuance method, private VPN/tunnel/proxy route, explicit deployment approval and spending ceiling |
| Clean host | Packaged source/lockfiles and reproducible commands, local Docker isolation | A separate clean Linux machine/VM with no existing business data; permission to install Docker/build dependencies and run disposable fixtures/restore there; this host can be the staging host |
| Security review | Threat model, policy/approval/network tests, source-hashed evidence, SAST/SBOM and image scanning | Named independent human AppSec reviewer, permission to share a credential-free source/evidence package, review date and budget if paid; critical/high findings resolved and written sign-off |
| Operational acceptance | Account roles/revocation, encrypted cold backup/restore, diagnostics, incident runbook | Named incident/patch operator, off-host encrypted backup destination, retention and recovery objectives, secret manager/key recovery owner, certificate renewal owner; validate actual restore and alert handling |
| PostgreSQL scope | Real isolated PostgreSQL with fixed read templates and one reviewed fixture update | Existing customer/production databases remain unsupported and untouched. To validate an organizational target, provide a separate synthetic staging DB and its schema/approved read contract; grant only the tested least-privilege role, TLS CA and secure connection-file path. No superuser/owner/service-role access is requested |
| Commercial release | Honest product scope, evidence and limitations | Actual design partners/pilots, legal/privacy/terms/name review and support commitments. These are business sign-offs, not automated software tests |

No secrets should be pasted into the conversation. Use an existing configured connector for non-secret metadata and an operator-controlled local file/secret manager for private material. The connected GitHub user is not a substitute for an AgentBrake App installation; its connector authorization must never be reused as an upstream credential.

The first external run is staging only: verify App permission scope and IDs, perform a permitted read, demonstrate an out-of-grant denial with no target change, approve a bounded feature change exactly once, test stale/replay behavior, verify target state independently, and test agent direct-access rejection. Use synthetic content. No production writes, workflow execution, merge/release or privileged SQL tests.

`npm run verify:production` reports open gates and exits 2. Local passing tests and agent code review cannot satisfy human review, live GitHub, clean-host or deployment authorization. A source change makes prior local/image reports stale. Until external evidence is obtained and reviewed there is no deployment-ready claim.

Additional operating limits: one tenant/Gateway, no HA/SSO/MFA/billing, small text-only Git changes, fixed fixture DB contract, finite cold-backup size, external keys re-provisioned after restore, no WORM audit sink or broad DLP. Do not market this candidate as an unrestricted hosted SaaS or protection for every host-agent action.

