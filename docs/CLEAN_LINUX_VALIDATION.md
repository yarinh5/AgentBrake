# Clean Linux install and acceptance kit

## Final package continuation — 2026-11-17

Candidate `2d8df354e16dacbdda4802a04dd875d6166f053f63a5a3b897a2bf41d358032e` passed the scoped exact-package Ubuntu verification. Archive `agentbrake-0.3.0-rc.1-2d8df354e16d-d30b37d6.tar.gz`, SHA-256 `89d6f75d33a8809429606ae635a5d765c8f72d83f4fe5e62801beac5922ce6d4`, contains284 files and passed safe extraction, per-file hashes and source coverage. Native, isolation/208-task measurement, product, encrypted backup/restore service, HTTPS candidate, Enterprise and npm-invoked security checks passed with the source unchanged. Composite evidence: `evidence/clean-linux-final-package-acceptance.json`.

The new validation guest is `AgentBrake-Ubuntu24-CleanPackage2-20261117` (UUID `4755e0dc-fcde-4eee-b120-ab83fbdae13a`), separately imported from the verified Ubuntu24.04.5 OVA. Bootstrap verified88 public payloads and installed Node22.23.5, Docker29.1.3 and Compose2.40.3. It has1vCPU,8GiB RAM, a64GiB dynamic disk, operator UID/GID1100, no shared folders/clipboard/host keys. The first fresh guest suffered a storage/runtime interruption and is preserved; its initiating cause is unknown.

On source c043, exact package installation/native283pass/4skip and isolation passed. Cold image preparation took475.14s; the unchanged300s product build deadline had failed before prebuilding. After explicit image preparation, product127.93s, service backup/restore371.72s, HTTPS69.37s and Enterprise130.05s passed. Security download failed. These partial attempts remain FAIL reports, not final-package acceptance.

The dependency download failure was traced to an actual public-dependency proxy connection-cap drop at24 sockets, corroborated by a25-socket reproduction. Raising only this local preparation capacity to128 allowed25 sockets while the129th was denied. Protected APIs/private CONNECT remained denied, public npm succeeded, and the final guest downloaded the pinned scanner image without a capacity drop. Endpoint restrictions were not broadened. See `evidence/proxy-capacity-remediation.json` and preserved clean-package attempt directories.

The final package used a new empty application directory `/opt/agentbrake-final-2d8df354`. Public toolchain and content-addressed dependency/image caches from earlier attempts were reused; prior application files, data and credentials were not copied. The guest is not a pristine cold-cache test or independent physical/customer host. The GPU-backed Codex workflow was verified separately on Windows/Docker; this1vCPU guest does not qualify CPU-model performance. The existing Windows product installation remained on source `b9c07645e95d...`; a final read-only check confirmed the same nine image/volume bindings and HTTP200.

The first final Ubuntu security command failed after Semgrep completed with0 findings on123 files because the VM harness invoked `node scripts/verify-security.mjs` directly. That script intentionally requires `npm run verify:security` so the installed npm CLI path is explicit for SBOM and audit. The original FAIL report remains in `evidence/clean-linux-final-package-20261117/`. A continuation on the same preserved exact-package directory repeated the package/source/network checks and passed the corrected npm-invoked security gate in `evidence/clean-linux-final-security-resume2-20261117/`. Product source, archive, policy, timeouts and security assertions were unchanged.

## Historical development runs

Status2026-11-17: **development installation and scoped product checks executed; release/independent acceptance remains open**. Yarin explicitly approved the UNRELEASED855b2915022f source for synthetic development tests in `AgentBrake-Ubuntu24-Validation-20261117` (UUIDb51bc28b-62a5-4e29-be67-2c350ea4dda3). The source was installed, actual Linux defects were reproduced, and subsequent separately hashed repairs passed the nine scoped gates on2642bd135666: native270pass, isolation/PG, product, service, Enterprise, separate Enterprise restore, HTTPS candidate, security and image scan. Full Codex/release acceptance remains separate. See EXTERNAL_GATE_STATUS.md for the current revision, completed checks and failures. The immutable original review archive was not overwritten; an UNRELEASED build is not an eligible release.

The guest is Ubuntu24.04.5/kernel6.8.0-147 on a64GiB disk, with a dedicated non-root operator UID/GID1100. Canonical's OVA signature and SHA256 were verified; offline bootstrap verified87 payload hashes and installed Node22.23.5/npm10.9.9, Docker29.1.3 and Compose2.40.3. Evidence: `evidence/clean-linux-preparation-96348245-841f-4c82-a3b2-c6af1657bda3/`, `evidence/clean-linux-bootstrap-20261117/`, and the guest preflight. The seed follows the [Canonical NoCloud contract](https://docs.cloud-init.io/en/24.2/reference/datasources/nocloud.html). No shared folders, clipboard, drag/drop, host credentials or GitHub private key were supplied.

Initial16GiB startup failed with Windows allocation error1455. Multi-CPU boots subsequently stalled during raid6 initialization; one-vCPU/8GiB runs are stable so far. The preserved logs do not prove a specific hypervisor root cause. A [similar VirtualBox issue](https://github.com/VirtualBox/virtualbox/issues/726) is corroborating context only. Host paging/Hyper-V settings remain unchanged. This is a separate guest on the same Windows computer, not an independent physical host or representative performance benchmark.

Dependencies were delivered through a guest firewall and loopback-only host proxy restricted to explicit public package/image domains. Actual guest and container tests denied direct host-canary, external direct-IP/DNS and protected API/private CONNECT paths, with positive public dependency controls. Evidence: `evidence/clean-linux-guard-20261117/` and `evidence/clean-linux-native-cdn-20261117/`. The public Docker CDN allowlist correction and failed first attempt are preserved. This is a scoped network boundary, not proof against host/daemon administrators. Public model weights and scanner database transfers have separate SHA256 records; neither preparation alone is a test pass.

Offline model-cache transport must preserve the runtime layout as well as the hash-verified blobs. The first curated transfer omitted `manifests-v2/ollama.com/library/qwen3/4b-instruct`, a relative alias to `../../../../blobs/sha256-0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`. The original host cache has that alias; the read-only guest runtime cannot migrate an incomplete cache. Exact blob checks alone did not detect this omission. Restore only the reviewed in-cache relative alias after checking the target digest, then verify the pinned runtime can list the model with its cache mounted read-only and network disabled. Do not grant the inference container write access as a workaround. Actual task acceptance remains separate; the negative/positive probe and rerun are recorded in EXTERNAL_GATE_STATUS.md.

Historical Windows audit274eac4d subsequently reported High GHSA-fc5q-39xc-vjpf for the byte-identical root dependency lock. The earlier Ubuntu zero-finding response is historical; the reason for the different advisory responses is not established. No published fix was available at the latest check, so that revision was blocked. The affected legacy build dependency chain was subsequently removed (ADR0007); current release evidence controls the present status.

For future release acceptance use a current-source `npm run package:release` archive, RELEASE.json and its SHA256 sidecar. Do not substitute historical release evidence or the UNRELEASED review package. This user's development-install approval is already granted for the named VM; it does not authorize external deployment, paid infrastructure or production data.

## Host and authorization

2026-11-17 update: Yarin authorized preparation of this process for a NEW isolated Ubuntu24.04 VM, with no paid cloud purchase. The VM above has been installed and used for development validation; exact-revision results are in EXTERNAL_GATE_STATUS.md. Release and independent acceptance remain separate. Use a distinct VM name/disk and its own guest Docker Engine; reusing Docker Desktop's engine from WSL does not prove a clean guest installation. Suggested test allocation remains8vCPU/16GiB/64GiB dynamically allocated disk (estimate, not a tested minimum). Use console installation with operator-chosen credentials; do not embed passwords, SSH agent, host-home mounts, production VPN routes, shared clipboard secrets or existing data. Record hypervisor, VM UUID, guest boot and OS identity. A VM on the same physical machine must be labeled as such; it is not an independent reviewer.

Obtain the Ubuntu24.04 image and SHA256SUMS/SHA256SUMS.gpg from the [official release directory](https://releases.ubuntu.com/24.04/), verify the signing-key fingerprint and checksum following [Canonical's verification procedure](https://ubuntu.com/tutorials/how-to-verify-ubuntu), and record the exact image name/digest instead of assuming the latest point release. For the completed VM, the official OVA signature and checksum evidence is linked above; these instructions also describe future independent provisioning. Stop if the version/signature does not match Ubuntu24.04. Create a clean post-install snapshot. Permit only public dependency preparation on the VM's designated network, with production/private LAN access excluded and no inbound forwarded ports. Before agent tests verify the supplied internal Docker networks and denied direct routes; freeze the VM network plan in the report. Use the VM console/private loopback UI, no external tunnel. Transfer only the credential-free source/evidence archives into a fresh guest directory, then run the commands below. Test restore into a second fresh installation and measure actual times. Do not pass this gate from Windows/Docker fixture reports.

Use an explicitly authorized disposable Linux x86_64 VM/machine with no customer data, production access or existing AgentBrake installation. Suggested evaluation budget: 8 CPU, 16 GiB RAM, 40 GiB free disk; these are provisioning estimates, not validated minimums. Full Codex inference additionally needs the separately documented model preparation. The default verification profile uses CPU-only32768 inference; an explicit gpu-8k profile is being verified separately on Windows/Docker after measured CPU timeout; check final-source release evidence before treating that workflow as verified. Fresh-VM performance and resource sufficiency are unverified. No cloud VM or paid runner is created by this kit.

Operator prerequisites: Node 22.13 or a separately verified compatible 22.x build, npm, Git, tar, OpenSSL, Docker Engine/Compose installed by the machine owner; private loopback access; administrative ability for browser OS dependencies if native UI tests are run. Membership in the Docker group is host-level authority and must never be granted to the agent. Ubuntu 24.04 x86_64 has been exercised in the separate development VM; independent customer-host acceptance remains open. Rootless Docker/other architectures are unverified.

Public package/image/OPA/scanner downloads are needed during preparation. Use no business credentials, do not forward SSH agent/cloud metadata credentials into containers, and keep runtime target networks internal. Review the archive checksum over a trusted second channel; a sidecar next to an archive alone does not authenticate its publisher. Signed release provenance is an Enterprise gap.

## Install (operator on authorized empty host)

Run product/verification commands as a dedicated non-root Linux operator with a non-system primary group (GID>=1000). The operator needs access to its guest Docker Engine; do not give an AI agent the Docker socket or this operator authority. The current Linux permission repair retains installation directories0700, gives the explicitly selected runtime group read access0640 only to mounted service files, and leaves operator-only files0600. Do not substitute chmod777 or root containers. The repair was first introduced under source1ebb20fdfb82 and subsequently exercised by full Linux product/service checks; see EXTERNAL_GATE_STATUS.md for exact completed revisions.

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
# Prepare public product images separately on slow/cold hosts (see below).
npm run verify:benchmark
npm run verify:product
npm run verify:service
npm run verify:candidate
npm run verify:security
```

The1vCPU guest exceeded the product command's300s deadline while building cold public images. Before product/service checks, prepare those images explicitly and retain the build log and duration. This only prepares images; it does not start a product or alter the300s acceptance deadline. Use a previously unused synthetic prerequisite name:

```sh
node --input-type=module <<'JS'
import { initializeProduct, prepareProduct, composeProduct } from './scripts/product.mjs';
const c = await initializeProduct('verify-image-prerequisites', 4338);
await prepareProduct(c);
for (const services of [['opa', 'control-db'], ['control-api', 'dashboard']]) {
  await composeProduct(c, ['--progress', 'plain', 'build', ...services],
    { capture: false, timeoutMs: 1200000 });
}
JS
```

The generated synthetic operator files stay local and must not enter evidence. Record dependency preparation separately from install/test duration; a cached build is not a cold-install speed claim.

Each command must exit 0 before the next. Preserve failures rather than editing reports. Native tests deliberately skip PostgreSQL-only cases; the isolation run must exercise them. The candidate verifier uses synthetic App keys and local TLS tests, not GitHub. Run the public Trivy DB preparation and npm run verify:images as documented in PRODUCTION_OPERATIONS.md; record actual image IDs, database freshness and every finding. npm run verify:production is expected to exit 2 until external gates are obtained, and must not be hidden as a passing production check.

verify:benchmark includes the existing isolation checks plus the 208-task synthetic parameter corpus. Preserve its separate usabilityTarget value even when measurement/engineering checks exit 0. It does not measure human approval time or representative customer completion.

This sequence validates the fixture service; actual Codex inference is a separate required release gate. Prepare the pinned public local model with `npm run setup:codex-local`, then the hash-verified bounded coding alias with `npm run setup:coding-profile`. The validated coding profile is `AGENTBRAKE_CODEX_PROFILE=gpu-8k npm run verify:release` on the recorded Windows/Docker GPU environment. This1vCPU Ubuntu guest does not qualify CPU-only model performance. Do not supply an external model API key or silently skip a failed model gate; record each environment separately. The full release now requires the useful coding-to-local-PR workflow as well as the earlier two-read client check.

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
