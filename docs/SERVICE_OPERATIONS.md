# Private team service operations

This distribution runs one private workspace with separate control, gateway, policy and target components. The enabled target data and repository are synthetic. Live GitHub/production systems and public hosting are not configured by installation. Public package/image downloads may be needed during preparation; runtime inference is optional and local.

## Install and create the owner account

Prerequisites: Docker with Linux containers, Node.js22.13+, npm. Extract the source package, run `npm ci`, `npm ci --prefix apps/dashboard`, then:

```powershell
node scripts/product.mjs init team 4318
node scripts/product.mjs start team
```

Open `http://127.0.0.1:4318`. The first-run form requires the generated administrator key in `.agentbrake-local/product-team/operators.json` once, plus your chosen name/email/password. Keep the first administrator ID so historical task ownership remains intact. Once account setup succeeds, every generated role-key login is disabled for this installation. Email is a login identifier, not an externally verified mailbox. No email is sent.

In Team, issue invitations for operators and a separate approver, then share the one-time links manually through your trusted channel. Invitations expire after24hours; password recovery links after15minutes. Password changes, reset, role changes and disable invalidate the affected sessions. The last active administrator cannot be disabled or demoted. Keep a second authorized administrator for account recovery. Host/Docker administrative access remains outside the application boundary.

## Everyday workflow

Create a task identity and structured scope, keep its one-time bearer in the isolated agent environment, and use the MCP template in Connections. A human operator key/password never belongs in agent configuration. Run a bounded read, review proposed changes with a different account, and inspect the resulting decision/evidence. Pending is not executed; UNKNOWN requires inspecting target state before any further attempt. Stop/revoke blocks new dispatch; it cannot recall a request already sent.

## Inspect, stop and start

```powershell
node scripts/product.mjs doctor team
node scripts/product.mjs diagnostics team
node scripts/product.mjs stop team
node scripts/product.mjs start team
```

Doctor reports actual container state and local HTTP status. Diagnostics writes the same bounded report under `.agentbrake-local`; it contains service names/states, source hash and local URL, not request content, operator credentials or database passwords. Review any support bundle before sharing; no automatic upload or support contact is configured. Seven application/database containers define health probes; OPA and the idle test agent are validated by real policy-mediated workflow tests rather than separate Docker probes.

Stop preserves volumes. Start applies the additive owner-run control migration before app startup; the runtime DB role remains unable to create/alter schema. The migration ledger stores its checksum and rejects changed previously applied SQL. Current supported target/control PostgreSQL image is pinned in infra/local/images.lock.json. Cold restore requires that exact image. No automatic major-version upgrade is offered.

## Encrypted backup and tested restore

```powershell
node scripts/product.mjs backup team
node scripts/product.mjs restore recovered-team PATH_TO_BACKUP PATH_TO_RECOVERY_KEY 4319
```

Backup temporarily stops only the named installation, snapshots its three dedicated volumes together and restarts the previously running services. It encrypts the package with AES-256-GCM. The command returns the backup path and a separate recovery-key path; it does not print the key. Keep an additional protected copy of the recovery key separately from the backup: losing it makes the backup unrecoverable. Both command paths must be inside this extracted workspace's `.agentbrake-local` directory. When transferring to another machine, copy the encrypted backup and recovery key into separate protected locations there; independent-machine recovery still needs validation.

The package includes the generated configuration needed to decrypt/authenticate historical state and the control/target/Git volume contents. No plaintext snapshot is written to the host. This bounded distribution limits each uncompressed volume to256MiB/10000 entries and the encrypted package to64MiB; exceeding a bound fails the backup and resumes the source. It is a cold maintenance backup, not HA or online point-in-time recovery. Never treat a path alone as success: require the command to return successful completion and retain the test evidence for the matching release.

Restore authenticates/validates the entire package before creating its destination, rejects links/traversal/unsupported entries, refuses any existing installation/project resources, and never overwrites source data. It preserves evidence and target state but starts with the control switch paused, all restored agent grants revoked and pending approvals blocked. Queued/executing uncertainty is reconciled as UNKNOWN. Outstanding invitations/recovery links are invalidated and account revisions advance; historical account passwords remain those in the selected backup and should be rotated if compromised. Authenticate as an existing restored administrator, inspect audit/target state, create fresh bounded task authority, and only then resume deliberately. Original in-memory browser sessions are gone. The original installation remains separate and unchanged.

If restore fails, its newly created destination is left stopped for diagnosis. A durable `recovery-incomplete.json` barrier blocks ordinary start until restore has successfully suspended authority and verified the recovered audit chain. Removing a stale maintenance lock does not clear that barrier. Do not remove the recovery barrier to retry startup; partially applied recovery needs a separately reviewed host-owner diagnosis procedure. No automatic deletion, overwrite or recovery retry is attempted. A maintenance.lock prevents concurrent CLI lifecycle commands; after an interrupted process, inspect the recorded PID/state before an administrator deliberately removes a stale lock. Never remove a live operation's lock.

## Upgrade and incident handling

Back up before replacing source/images. Keep the matching previous source package and pinned image metadata. Run the new release's disposable verification first, then start the named installation to apply its forward migration. A rollback uses a fresh destination restored with the matching old release/image; it is not an in-place destructive downgrade. No production/custom database migration is authorized by these commands.

For suspected misuse: stop new dispatch, revoke the affected task, disable the affected human account if needed, preserve the relevant evidence and take an encrypted backup. Reconcile UNKNOWN outcomes against the actual target. Do not rewrite audit history, erase the installation, or reissue an uncertain mutation under a new ID as an automated recovery step.

For account recovery, an active administrator issues a one-time recovery link. No email bypass or permanent hidden admin key exists after bootstrap. If all administrators lose access, host-owner disaster recovery requires a separately reviewed local maintenance procedure; there is no silent authentication bypass.

## Release acceptance

`npm run verify:release` must pass native/OPA/browser, isolated PostgreSQL/Git/Codex, fresh product installation, encrypted backup/restore, source consistency and security scans. Package with `node scripts/package-release.mjs` only afterward; its manifest and archive SHA-256 exclude runtime keys/data, dependencies and model caches. The package is local; it is not automatically published. External human review and independent clean-machine validation remain explicit gates before a claim of commercial production readiness.
