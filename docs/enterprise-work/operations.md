# Enterprise operations and release attestation — scoped implementation

2026-11-17. Status: **local operations/signing implementation and focused tests complete; parent integration and final-source broad verification pending**. This is not off-host recovery, hosted provenance, on-call response or clean-host acceptance.

## Cause, constraints and acceptance

The demonstrated gap was absent destination-custody checks, fresh multi-signal monitoring and signed release metadata. Existing `backup-format.mjs` already supplies bounded AES-256-GCM encrypted backups; `product-maintenance.mjs` supplies full backup inspection and restore. Those existing lifecycle paths remain unchanged. The new code reuses the encryption envelope and separates successful encrypted-copy custody from full restore acceptance.

Scope was limited to the two new scripts, their two focused tests and this report. No installed service, real backup, recovery key, cloud destination, key store, external endpoint, Git state or dependency was changed. All test files are created under unique workspace `.agentbrake-local/enterprise-*` directories and removed after the test. Tests use synthetic keys. No secrets are written to this report or to attestations.

Acceptance conditions established before implementation: copy authenticated encrypted bytes to an explicit existing destination without overwrites; reject links, corrupted input and wrong keys; independently read back and authenticate the destination and checksum; preview retention without removal; distinguish availability, disk, certificate and authenticated backup age with UNKNOWN evidence; return actionable CLI status; sign and verify archive digest/source/version using operator-provided Ed25519 trust, rejecting tampering and untrusted rotation. Stop after focused evidence and report, leaving parent-owned integration to the parent.

## Operations API and CLI

`node scripts/enterprise-operations.mjs <copy|verify|retention|health|templates> <config.json>`

Configuration is one JSON object with the selected function's arguments. Successful actions print JSON. Failures print a generic sanitized diagnostic and exit 1. Health prints its report and exits 0 only for overall OK; CRITICAL, WARNING and UNKNOWN exit 2. No action automatically installs or enables anything.

| Export/action | Required input | Optional input and behavior |
| --- | --- | --- |
| `copyEncryptedBackup` / `copy` | `sourceFile`, `keyFile`, `destinationDirectory` | Destination must already exist. Basename is preserved and must end `.abk`. Returns destination file, SHA-256, bytes, backup ID/creation time, `verified`, `verifiedAt`. |
| `verifyEncryptedBackup` / `verify` | `file`, `keyFile`, `expectedSha256` | Expected digest is mandatory; compares bytes then authenticates the existing envelope. |
| `previewRetention` / `retention` | `directory` | `keep=7` (minimum 1), `maxEntries=1000` (1–10,000). Scans direct children only, bounds all entries, returns retained entries and deletion candidates; never deletes. |
| `collectHealth` / `health` | None; absent signals become UNKNOWN | `healthUrl`, `diskPath`, `certificateFile`, `backupFile`, `keyFile`; thresholds below. |
| `systemdTemplates` / `templates` | `nodePath`, `workspacePath`, `configFile`, `user` | `intervalMinutes=15` (1–1440). Returns service/timer text and `installed:false`; Linux absolute paths use a strict safe character subset; root user and directive/specifier injection rejected. |

The signing module also uses exported `checkedPath`, `readSafeFile` and `writeExclusiveFile`. These reject symlinks/junctions in every path component, reject nonregular/hardlinked/oversized files, bound reads and detect size/mtime changes during reads. Exclusive writes use mode 0600, `O_EXCL`, `O_NOFOLLOW` where available, and flush data before closing. Group/other-writable destination parents are refused on POSIX. Existing output files are never modified. Failed post-write verification leaves the unverified artifact for explicit diagnosis and causes failure; subsequent copies still refuse collision.

The destination itself is the operator's explicit authorization boundary; the tool creates no parent directory or mount and connects to no storage service. Real off-host use requires an already mounted destination named by the operator. Parent directories must remain controlled by that operator: portable Node APIs do not provide a race-free `openat` directory capability against concurrent privileged rename/reparse attacks. Windows mode bits are not Windows ACL enforcement; administrators must provision private ACLs. Those OS and mount conditions were not independently accepted here.

Retention order uses filesystem modification time, with deterministic filename tie breaking. It is a bounded human-review preview, not proof of backup completeness or retention-policy compliance. No retention execution command exists.

### Fresh health evidence

Every invocation performs fresh checks and emits a fresh `checkedAt`; it accepts no cached status report. `checks` contains `availability`, `disk`, `certificate`, and `backup`, each with `status`. Overall precedence is CRITICAL, UNKNOWN, WARNING, OK. Consumers can count UNKNOWN values from the four checks. A fresh report timestamp does not imply fresh backup content: backup age comes from authenticated metadata.

- Availability requires exact HTTP 200, rejects redirects and has a bounded deadline (`timeoutMs=5000`, range 1–60,000). HTTPS uses Node/system trust. HTTP is refused unless `allowLoopbackHttp:true` with an explicit loopback hostname for fixtures. No URL, response payload or credential is included in the report.
- Disk uses current filesystem available blocks, not total free blocks reserved from the service user. `minFreeBytes` defaults to 1 GiB. Measurement failure is UNKNOWN.
- Certificate parses the explicitly supplied PEM with `X509Certificate`; expired or not-yet-valid is CRITICAL, remaining lifetime at most `certificateWarningDays=30` is WARNING. Missing/invalid certificate evidence is UNKNOWN. This validates that file's validity period, not identity/chain/rotation of the remotely deployed certificate. Availability separately validates its HTTPS connection.
- Backup decrypts/authenticates the selected `.abk` with the selected recovery key and evaluates its authenticated creation time against `maxBackupAgeMs=86400000`. Future timestamps, excess age and failed authentication/read are CRITICAL; missing configured backup/key is UNKNOWN. Metadata custody validation checks envelope/package type/schema/ID/date. Full configuration/snapshot validation and recovery remain the existing `inspectBackup`/`restoreProduct` contract.
- Thresholds must be finite and nonnegative within documented bounds. Errors are sanitized and do not include decrypted configuration or raw transport errors.

The generated `agentbrake-health.service` and `.timer` schedule only the health command. Their exit code and JSON can be consumed by an operator's existing supervisor/on-call routing. No notifier, on-call integration, automatic backup scheduler or cold-backup downtime window is activated by these tools. Templates were generated and injection-tested on Windows; systemd parsing/installation and timer firing require Linux acceptance. No automatic cold-backup job is fabricated because it stops installation writers and requires a separately approved maintenance schedule.

## Release signing API and CLI

`node scripts/enterprise-signing.mjs <sign|verify> <config.json>`

- `signArchive({archiveFile, privateKeyFile, version, sourceHash, attestationFile})`: reads a supplied PEM Ed25519 private key; computes archive basename/bytes/SHA-256; signs a canonical version-1 payload with source hash, version, fixed algorithm/type and SHA-256 public-key fingerprint. Writes a detached JSON attestation exclusively with mode 0600. Output includes the public fingerprint, artifact metadata and attestation path, never a key or key-file path. Archive size is bounded at 512 MiB.
- `verifyArchive({archiveFile, publicKeyFile, attestationFile, expectedVersion, expectedSourceHash})`: requires independent expected source/version and an explicit trusted public key. Enforces exact payload shape, supported algorithm, matching key fingerprint, signature and all subject bytes/digest/name and release claims. Success returns `verified:true` and public release metadata; invalid input, trust or integrity throws. CLI exits 1 with a generic diagnostic on failure.

The attestation contains no embedded public/private key. Its key fingerprint does not confer trust: the operator distributes/pins the public key independently. Rotation means signing a new attestation with the new private key and explicitly replacing the verifier's trusted public key. An old attestation fails under the new key. No trust-on-first-use, downloaded keys or implicit trust fallback exists.

The signature covers explicit release claims, not a reproduction of the build. Signing does not unpack the archive or recompute the repository source manifest. Parent integration must provide the already verified package manifest/version/sourceHash; verifier expectations must arrive through an independently trusted release channel. Reusing claims read from the same untrusted attestation would remove that independent comparison. Existing packaging is responsible for its secret-exclusion inventory; signing itself does not inspect archive members for secrets. No real release key, hardware signing service, timestamp authority, transparency log or hosted CI identity was exercised.

## Evidence and remaining gaps

TDD evidence: the first run contained eight failing assertions for absent public APIs. Implementation followed those failures; the initial focused implementation run passed eight tests. Follow-on CLI/transport coverage brings the final focused suite to ten tests.

Final command: `node --test tests/enterprise/operations.test.mjs tests/enterprise/signing.test.mjs` — **10 passed, 0 failed, 0 skipped** on 2026-11-17, Node 22 / Windows workspace. It exercised:

- Real temporary encrypted source/destination files, independent SHA-256 comparison, decrypted content equality after copying, collision refusal preserving destination bytes, destination corruption rejection and recovered-byte verification.
- Wrong recovery key and malformed envelope refusal before destination creation; real Windows directory junctions including ancestor junction paths; retention entry bounds and unchanged directory contents.
- Actual loopback HTTP 200/503, redirect refusal with no follow-up request, deadline failure; real filesystem capacity and a deliberately unsatisfiable threshold; authentic backup staleness/corruption and missing UNKNOWN evidence.
- Fresh synthetic OpenSSL certificates, expiration warning, accepted validity and expired-certificate CRITICAL. No production certificate or key was read.
- Health CLI UNKNOWN exit 2; operational failure exit 1 without supplied sensitive-path text; inert systemd generation and input-injection refusal.
- Real Ed25519 sign/verify, a real tar.gz produced by `tar`, CLI signature rejection, archive-byte tampering, payload tampering, source/version mismatch, missing expected version, unsupported RSA key, explicit trusted-key rotation and rejection of the old trust binding. Reports/attestations were checked for absence of key material.

`npm test` was started before parent coordination requested exclusive ownership of broad-suite execution; it was then interrupted. Observed before interruption: OPA 12/12 and the first managed-identity HTTP test passed. That interrupted run is **not** a full-suite pass. Parent owns the final-source broad suite and package/CI integration.

Remaining operational acceptance: actual off-host storage and ACL/mount behavior, full cold-backup recovery in a fresh installation, maintenance/backup scheduling, retention approval and execution policy, backup/key disaster separation and custody rotation, Linux systemd validation, real HTTPS deployed-certificate monitoring, alert delivery/escalation/response times, real release-key custody and independent distribution, reproducible/hosted provenance and final-source package validation. No external/live/whole-product completion is claimed.

## R1 recovery authority regression and lifecycle fix

The subsequent security review demonstrated a separate P1 integration defect: backup/restore's existing file allowlist omitted Enterprise configuration, while restored local accounts retained password verifiers. Recovered account revision bumps invalidated sessions but did not preserve SSO-required policy. Starting with absent Enterprise configuration could consequently accept a previously blocked local administrator password. This was a demonstrated authentication downgrade, not a defect in AES-GCM or copy custody.

The nonsecret `installation.enterpriseRequired` marker has only two valid states: absent for compatible legacy/local installations, or literal `true`. A second `installation.enterpriseIdentityRequired` marker preserves the SSO requirement specifically; it accepts only absent/true and true requires `enterpriseRequired:true`. Backup writes these requirements inside the authenticated envelope from persisted markers or the loaded source Enterprise manifest/identity flag. This includes enabled source installations whose metadata predates the markers. Inspection rejects false/malformed markers and an identity requirement without the enclosing Enterprise requirement. Restore copies the authenticated installation metadata, so both markers survive without including old IdP/SIEM endpoints or credentials in the file allowlist.

Ordinary `startProduct` re-reads the persisted installation before any Docker operation and rejects missing Enterprise configuration when required, even if its caller passed a configuration object loaded before Enterprise enablement. When identity is required, audit-only configuration is also refused. Marked restore still runs the existing volume recovery, account/session invalidation, agent revocation and audit validation. After successful recovery it stops the scoped services and returns `status: RESTORED_REQUIRES_ENTERPRISE_CONFIGURATION`; it does not start the application. The operator must explicitly re-provision HTTPS and validated Enterprise identity configuration for the restored installation before ordinary start. Existing unmarked local backups keep their prior startup behavior.

Parent integration owns durable marker persistence before Enterprise enablement, refusal to configure an identity-required installation as audit-only, installation/config schema validation and the independent runtime environment/config guard. The lifecycle markers preserve the identity-versus-audit requirement and mandate explicit reconfiguration; they do not encode the previous IdP or break-glass identity or permit silently recreating those authorities. Completion of those parent-owned guards and actual HTTP login regression remains required for final R1 acceptance.

Added `tests/enterprise/restore-authority.test.mjs` uses the actual maintenance module, real temporary files and encryption/decryption, and actual product configuration loading. Only Docker/Compose transports are simulated. Four behavior regressions failed before the lifecycle fix: enabled-source backup omitted the marker, malformed marker was accepted, Enterprise restore auto-started instead of returning the required staged state, and a stale startup config bypassed the persisted requirement. Follow-on failing assertions demonstrated that a generic Enterprise marker alone could not prevent audit-only replacement of SSO, leading to the specific identity marker and relationship validation. All eight final cases pass; restored markers are checked on disk, application autostart is absent, recovery suspension is invoked, services stop and subsequent ordinary/audit-only startup is refused without identity reprovisioning.

Focused command: `node --test tests/enterprise/restore-authority.test.mjs tests/enforcement/backup-format.test.mjs tests/enforcement/product-recovery.test.mjs` — **17 passed, 0 failed, 0 skipped**. This includes existing local/minimal recovery success, build/recovery failure barriers, image/profile mismatch and ordinary local start. These are real orchestration/filesystem/cryptographic checks with simulated Docker, not a live recovered PostgreSQL or production IdP acceptance claim. No installed backup, secret, container or service was changed.
