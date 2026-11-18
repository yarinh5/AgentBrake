# Actual local Enterprise PostgreSQL restore acceptance

2026-11-17. **PASS_LOCAL_ENTERPRISE_POSTGRES_RESTORE** on frozen source `fc683bf456d14f756e72671ad24e0e4aee0c2782b86012d17e783360bb03494b`. This closes the previously unexercised actual local maintenance path for preserving Enterprise/SSO requirements through a cold PostgreSQL backup and stopped restore. It does not establish off-host disaster recovery or acceptance of a resumed restored IdP session.

Evidence: [successful summary](restore-evidence-c8ae3c6c-5639-4978-bc51-e3104e9b086b/summary.json), [executed harness copy](restore-evidence-c8ae3c6c-5639-4978-bc51-e3104e9b086b/harness.mjs), [harness checksum](restore-evidence-c8ae3c6c-5639-4978-bc51-e3104e9b086b/harness.sha256), [source manifest](restore-evidence-c8ae3c6c-5639-4978-bc51-e3104e9b086b/source-manifest.json).

This final-source run completed at 08:31:38 UTC with all six acceptance groups and both scoped cleanup checks passing. The earlier-source [report](restore-acceptance-ad12.md) and its evidence remain preserved. After the parent's separate model-verification profile change, the exact same restore workload was rerun once; only the expected source hash in the excluded scratch harness changed. Both source hashes recorded in the final run match the hash above.

The standalone harness lives at `.agentbrake-local/enterprise-real-restore-harness.mjs`, outside the source-manifest inventory, and was executed with `node .agentbrake-local/enterprise-real-restore-harness.mjs`. Its SHA-256 is `875222092f8b1a214dca3e81caa23d222f7e3c070d2edc5211961218d75041f3`. The evidence copy is for inspection; its relative imports assume execution from the original `.agentbrake-local` directory. No server, script, test, infrastructure, dependency or other hashed source file was edited. The actual source manifest was checked before and after and matched the frozen hash.

## Real path exercised

The harness called the existing `initializeProduct`, `configureCandidate`, `configureEnterprise`, `startProduct`, `backupProduct`, `inspectBackup`, `restoreProduct` and `productConfig` helpers directly, with actual Docker, minimal runtime images and PostgreSQL volumes. No maintenance call or Docker transport was mocked.

Two uniquely named installations used dynamically reserved loopback ports: `verify-ent-src-c8ae3c6c` and `verify-ent-rst-c8ae3c6c`. The source was bootstrapped through the production HTTPS ingress/dashboard/control API with one ordinary managed owner, one unused invitation, one account recovery token, one scoped agent, a successful target read and one pending target update. The source then enabled synthetic Enterprise identity without a break-glass account. All runtime endpoint names were synthetic/internal; the existing fixture overlay kept control, agent, protected, dashboard and Enterprise networks internal. Only the fixed ingress joined the established loopback publication bridge. No real IdP, GitHub or external audit sink was contacted.

Six acceptance groups passed:

1. Actual source managed authority existed in PostgreSQL, with a valid audit chain and pending approval.
2. The ordinary owner's password was rejected by the installed SSO-required application, with no break-glass exception.
3. A real encrypted 26,053,990-byte cold backup authenticated both `enterpriseRequired:true` and `enterpriseIdentityRequired:true`; the backup file allowlist contained neither Enterprise configuration nor TLS private-key files. Source services resumed and still rejected the ordinary password. Its target-state hash was unchanged.
4. Actual restore returned `RESTORED_REQUIRES_ENTERPRISE_CONFIGURATION`. Installation identity and both requirements survived. Restored candidate/Enterprise configuration was absent; all created services were exited. Ordinary `startProduct` refused before application startup.
5. After generating new synthetic HTTPS credentials for the restored installation, `configureEnterprise` refused an audit-only replacement. The SSO requirement remained intact, and services remained stopped.
6. After recording stopped-state evidence, the harness started only the restored control/target database services and ran a one-shot maintenance observer using the real `PostgresStore` with `reconcile:false`. It confirmed paused control state, preserved account ID with increased revision, zero invitations/recoveries, paused/revoked agent, blocked pending approval with `recovery-suspension`, a valid audit chain preserving its earlier prefix, and an identical target database hash. The observer made no identity/configuration mutations. Databases were stopped again; no restored application server or IdP login was started.

The target hash compared PostgreSQL customer rows, including status and version. It was `4518a182a773ff6d97d32cbbe6ae7489477b868ba6493de497853bf6dc0d5c8d` before and after. No row data, password verifier, token, private key, decrypted backup or Enterprise configuration was placed in evidence. The final harness/summary scan checked 36 known synthetic secret values and passed.

## Failure and cleanup record

An initial harness parse typo was corrected before any resource operation. The first operational attempt then failed before workload execution because the restricted shell could not read Docker configuration/buildx state. Its failure is preserved in [failed summary](restore-evidence-16004c18-1d79-49a8-8e36-aaaba969fbe9/summary.json). The authorized Docker escalation first performed exact-name cleanup of that attempt, recorded in [cleanup follow-up](restore-evidence-16004c18-1d79-49a8-8e36-aaaba969fbe9/cleanup-followup.json), then ran the successful harness. No product fix or source edit was needed.

During the earlier-source verification, the parent reported a separate Docker host interruption while concurrent release/model diagnostics were running. No new host interruption was observed by this final-source harness. This harness did not restart the daemon or inspect/restart `product-local`. Its successful run completed all acceptance checks; this shared-host event means the elapsed duration must not be treated as latency, restore-time objective, resource isolation or capacity evidence.

For both successful-run projects, exact project-label queries verified zero remaining containers, volumes and networks after cleanup. Exact installation paths and metadata ownership were checked before removing their directories; only their own runtime/dashboard image tags were removed. The generated encrypted backup was removed after its path and source-name prefix were checked. The failed-attempt directory was also removed by its dedicated cleanup. Auditable harnesses and sanitized evidence remain. No installed product resources or shared base-image tags were changed by this task.

## Remaining scope

This result verifies the actual local PostgreSQL cold-backup/recovery lifecycle and its fail-closed authority boundary. It deliberately ends with restored application services stopped. A newly provisioned restored IdP login, physical authenticators, real external provider acceptance, remote storage/key custody, off-host or clean-machine recovery, alert/on-call delivery, RTO/RPO, HA and compliance are not proven here.

No SIEM exporter was enabled in this harness. It therefore does not test restoration of an exporter cursor or remote sink acknowledgement history. Installation ID preservation was verified; any newly provisioned sink/cursor must follow the separately documented source rollback/replay contract, with at-least-once duplicates and operator reconciliation rather than assumed remote delivery continuity.
