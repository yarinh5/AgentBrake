# Independent clean Linux install and acceptance kit

Status: PREPARED, independent clean-host run NOT RUN. The deliverable is the current-source archive from npm run package:release, RELEASE.json (per-file SHA256 inventory) and its .sha256 sidecar. Package path/hash are recorded in docs/evidence/release-package.json. Historical archives must not be substituted for a changed source. Package excludes runtime data, secrets, node_modules, model weights and backups.

## Host and authorization

Use an explicitly authorized disposable Linux x86_64 VM/machine with no customer data, production access or existing AgentBrake installation. Suggested evaluation budget: 8 CPU, 16 GiB RAM, 40 GiB free disk; these are provisioning estimates, not validated minimums. Full Codex inference additionally needs the separately documented model preparation and tested GPU profile; a CPU-only path is unverified. No cloud VM or paid runner is created by this kit.

Operator prerequisites: Node 22.13 or a separately verified compatible 22.x build, npm, Git, tar, OpenSSL, Docker Engine/Compose installed by the machine owner; private loopback access; administrative ability for browser OS dependencies if native UI tests are run. Membership in the Docker group is host-level authority and must never be granted to the agent. Ubuntu 24.04 x86_64 is the intended first independent host, not already verified here. Rootless Docker/other architectures are unverified.

Public package/image/OPA/scanner downloads are needed during preparation. Use no business credentials, do not forward SSH agent/cloud metadata credentials into containers, and keep runtime target networks internal. Review the archive checksum over a trusted second channel; a sidecar next to an archive alone does not authenticate its publisher. Signed release provenance is an Enterprise gap.

## Install (operator on authorized empty host)

Use an empty dedicated extraction directory and the exact archive filename in release-package.json; inspect tar contents before extracting. Do not overwrite an existing installation. From the extracted package root:

```sh
# First, outside the empty extraction directory:
sha256sum -c /absolute/path/to/agentbrake-<exact-build>.tar.gz.sha256
# Run the checksum command from the archive's directory; then inspect/extract
# the trusted archive into the newly created empty directory.

# Inside the extracted package:
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix apps/dashboard
npm run setup:policy
node node_modules/@playwright/test/cli.js install --with-deps chromium
npm run verify:stage1
npm run verify:isolation
npm run verify:product
npm run verify:service
npm run verify:candidate
npm run verify:security
```

Each command must exit 0 before the next. Preserve failures rather than editing reports. Native tests deliberately skip PostgreSQL-only cases; the isolation run must exercise them. The candidate verifier uses synthetic App keys and local TLS tests, not GitHub. Run the public Trivy DB preparation and npm run verify:images as documented in PRODUCTION_OPERATIONS.md; record actual image IDs, database freshness and every finding. npm run verify:production is expected to exit 2 until external gates are obtained, and must not be hidden as a passing production check.

This sequence validates the CPU fixture service, not real Codex inference. For full release reissuance prepare the verified local model using scripts/setup-codex-local.mjs and docs/PLAN_MILESTONE_B.md, then run npm run verify:release. Do not supply an external model API key as a shortcut. Record the missing model/GPU test as NOT RUN on CPU-only hosts.

## Interactive fixture-only installation

After the disposable verifiers pass, create a uniquely named installation (example below assumes that name does not exist):

```sh
node scripts/product.mjs init cleanpilot 4334
node scripts/product.mjs start cleanpilot
node scripts/product.mjs doctor cleanpilot
node scripts/product.mjs credentials cleanpilot
```

Open http://127.0.0.1:4334 on that machine (an external tunnel is a separate authorized access decision). The last command prints a local operator-file path; retrieve only its administrator bootstrap key privately, enter it in setup and create the owner. Never put that file in evidence. Invite a distinct approver/operator, verify sign-in/out, bounded read, denied SQL and reviewed fixture write; use Demo Lab and Evidence to inspect actual outcomes. No GitHub configuration is needed. Do not configure real keys while doing the clean-host fixture test.

## Backup/restore and acceptance

Run `node scripts/product.mjs backup cleanpilot`. Store the returned encrypted archive and the installation's recovery-key separately under operator access control. Record archive checksum/bytes only. Restore to a NEW name and unused port with `node scripts/product.mjs restore cleanrestore /absolute/archive.abk /absolute/recovery-key 4335`. Follow SERVICE_OPERATIONS.md; never restore over an existing installation. Verify record/audit counts and target fixture state, old sessions invalid and grants revoked, health and new owner login. Measure downtime and restoration duration. No external App/TLS keys are included; do not silently reconnect a restored service.

Independent report must include operator identity/date, host OS/kernel/CPU/memory/Docker/Compose/Node versions, archive checksum, RELEASE source hash, command exits, new reports' hashes, isolation negative probes plus positive mediated control, UI errors, backup/restore checks, observed data preservation/revocation, measured setup/help time and all NOT RUN cases. Do not include env dumps, tokens or passwords. Host firewall/kernel and independent review acceptance are distinct from container tests.

Stop only the named evaluation installations with `node scripts/product.mjs stop cleanpilot` and `... stop cleanrestore` when finished. Stopping preserves volumes. Destructive disposal requires the operator's explicit named-installation confirmation; no Docker system prune or broad filesystem deletion. The supplied automated verifiers clean only their uniquely named resources and report cleanup failure.
