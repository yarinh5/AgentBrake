# Private deployment candidate operations

This is a single-organization **release candidate**, not an authorized production deployment. The existing `product-local` was explicitly upgraded to v0.3.0-rc.1/minimal-v1 with preserved data and remains a local fixture service. New candidate behavior is opt-in and must be verified with `npm run verify:release`, `npm run verify:images` and `npm run verify:production`. The last command returns exit 2 while required external gates are open.

## Prepare a separate installation

Use Node 22.13+, Docker/Compose, the supplied lockfiles and a dedicated Linux host for the external acceptance run. Keep the agent in the supplied internal network; a host agent with other credentials/network access is outside the enforcement boundary. No target database, OPA, control API or Gateway port is published.

```
node scripts/product.mjs init candidate 4334
node scripts/configure-candidate.mjs candidate /absolute/path/candidate-input.json
node scripts/product.mjs start candidate
node scripts/product.mjs doctor candidate
```

The configurator requires a fresh installation with no containers; it refuses `local`, existing candidate metadata and mismatched IDs. It copies only explicitly supplied files to that installation with restrictive file modes. On Windows, Unix modes do not replace NTFS ACLs; restrict the installation directory to its operator. It neither starts services nor sends a GitHub request. The subsequent `start` enables the configured connector. Do not run it with real credentials until the named sandbox is authorized.

Input schema (replace values; never paste keys/tokens into chat):

```json
{
  "https": {
    "origin": "https://agentbrake.example.org",
    "certificateFile": "/absolute/path/fullchain.pem",
    "privateKeyFile": "/absolute/path/tls-key.pem"
  },
  "githubApp": {
    "appId": 123,
    "installationId": 456,
    "repositoryId": 789,
    "ownerId": 12,
    "repository": "owner/disposable-agentbrake-sandbox",
    "defaultBranch": "main",
    "disposableRepository": "owner/disposable-agentbrake-sandbox",
    "privateKeyFile": "/absolute/path/app-key.pem"
  }
}
```

Either section may be omitted for a scoped local test. Production acceptance requires HTTPS. The example identifiers are placeholders, not existing access. Certificates must match the configured hostname, key and validity period. The local verifier generates a one-day self-signed certificate and trusts it only in its test client; this does not verify a public CA or your DNS.

## GitHub App setup and limits

Create a dedicated App installed on **only the named disposable repository**. Repository permissions: Contents read/write, Pull requests read/write, implicit Metadata read. No organization permissions, Issues, Actions, Workflows, Administration, Secrets, Deployments or webhook subscriptions. Do not give it branch-protection bypass. Supply App/installation/repository/owner numeric IDs and the private-key file path through a secure local file or secret manager.

Repository requirements: initialized `main`; protected default branch; no Actions workflows; no production data or secrets; no external webhooks/automation configured by the operator. The API verifies immutable repository and owner IDs, full name, default branch and current commit. Renames/transfers/protection changes fail closed. The App cannot prove the absence of external organization webhooks without additional administrative access; this remains an operator-reviewed sandbox prerequisite.

Supported: metadata, bounded branches, small regular text files, change preview, approved `agentbrake/*` branch creation and approved draft PR with up to five allowlisted files. No merge, force update, main write, delete, issue, secrets, workflows or arbitrary endpoint. Create the feature branch before requesting its PR. Select **GitHub App sandbox** when issuing its identity; default demo identities always use fixtures. The task grant can only narrow the configured scope.

Gateway has no general Internet network. Its HTTP transport reaches a private fixed GitHub egress service; that service permits only the configured API origin and route set and performs verified upstream TLS. The agent is not on that network. App key is mounted only into Gateway, not dashboard/control/agent/egress. Tokens are minted for the one repository and exact permissions, validated, cached only until shortly before expiry and never forwarded from agent input.

GitHub is not an atomic transaction across object creation, ref update and PR creation. A lost/failed response after dispatch is UNKNOWN even if a branch changed. Do not repeat with a new request ID. Inspect the repository's branch/commit and PR state using an independent operator, record the action ID, reconcile and issue a new reviewed task only after that investigation. Changes by another authorized GitHub actor after the check remain possible. Main is never updated by this adapter.

## HTTPS and network deployment

The Compose override replaces the existing ingress with TLS, keeps **127.0.0.1 only** publication and pins one Host/Origin. It does not open an Internet-facing socket. Provide an explicitly authorized private VPN/tunnel or host proxy as the external entry route; firewall it to the organization. Preserve TLS and exact Host, and do not expose the Docker daemon. Do not add the agent to a public/host network. No enterprise SSO/MFA, horizontal Gateway replicas or HA claim is included.

TLS private key is mounted only into ingress; account cookies are Secure, HttpOnly and SameSite=Strict. Dashboard continues to call only the private control API and never forwards agent bearer credentials. Host/Origin are checked explicitly; client-supplied forwarding headers cannot select authority or destination. For certificate rotation, pause new work, stop the candidate, validate a matching replacement certificate/key, replace only its two TLS files and restart. Re-run doctor and an authenticated browser smoke. Never disable TLS verification to resolve a production certificate error.

## Recovery and operating bounds

Use the verified cold encrypted backup/restore procedure in SERVICE_OPERATIONS.md. **Candidate TLS/App configuration and external keys are intentionally not inside the local data backup.** A restored installation starts with fixtures, paused agents/revoked grants and invalidated sessions. Re-provision TLS and a newly reviewed App configuration only after recovery verification; preserve external key recovery separately in the organization's secret manager. Before the candidate configurator, remove only the restored installation's containers/networks using its Compose configuration with `down --remove-orphans` (never `--volumes`); stopped containers alone do not meet the configurator's guard. Preserve all restored volumes and installation files, then configure, restart and issue new grants.

Backups remain bounded to a 64 MiB encrypted package, 256 MiB decoded/10,000 entries per volume; this is a real capacity limit, not a production-scale backup guarantee. Terminal result retention is bounded but the audit/replay history persists. An operating owner must monitor database/disk growth, backup success, certificate expiry, UNKNOWN actions and doctor health. Select backup frequency, retention, RPO/RTO and off-host storage before deployment; no SLA or automatic off-site backup is claimed. Do not run destructive reset in an active installation.

Incident order: pause/revoke in control; preserve audit/evidence and UNKNOWN outcomes; revoke the GitHub App installation/key if compromise is suspected; stop the isolated agent; rotate affected keys; investigate before resuming. Secret rotation changes connector binding and invalidates pending approval context. Already dispatched effects are not rolled back. Do not log credentials or raw API errors.

## Verification

`verify:release` covers native/OPA/browser, isolated PostgreSQL/Git/Codex, service backup/restore, the actual HTTPS candidate and SAST/SBOM/npm scans. `verify:images` exports built images and scans offline with pinned Trivy and a separately downloaded public vulnerability database; reports all severities and fails the high/critical gate without blanket suppression. No Docker socket is mounted into the scanner.

Prepare the public scanner database before an image scan. On the authorized Linux acceptance host, from the package root:

```sh
mkdir -p .agentbrake-local/trivy-cache .agentbrake-local/docker-public
docker --config .agentbrake-local/docker-public run --rm \
  --mount "type=bind,src=$PWD/.agentbrake-local/trivy-cache,dst=/cache" \
  aquasec/trivy@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb \
  image --cache-dir /cache --download-db-only
npm run verify:images
npm run verify:production
```

The database download uses public network access and sends no source or image. The following scan itself runs with network disabled. Reports older than a source change do not count; the vulnerability database must be less than48hours old. The scan records the four long-running application image families (runtime, dashboard, PostgreSQL, OPA), not the host OS, Docker daemon, build stages or one-shot base-image volume helpers. Those belong to the independent host/review acceptance scope; do not interpret zero findings in the four images as a universal vulnerability-free claim.

Read `PRODUCTION_READINESS.md` for access requests and external acceptance. Current-source reports are under `docs/evidence`; historical reports remain evidence only for their own source hash. Do not promote an older pass to a changed build.

