# Service operations scoped review

2026-11-16. Verdict: **CHANGES REQUIRED — 2 Important/P2 findings**. Reviewed the full 14-file `service-operations-review.diff`, `SERVICE_DESIGN.md`, task3 and applicable constraints in `PLAN_SERVICE_OPERATION.md`, and `service-operations-report.md`. Read current affected implementations and the directly called PostgreSQL recovery methods. Account backend review remains separate; this review does not reopen it.

## OPS-1 — P2: Backup can report success for a snapshot that restore rejects

Location: `infra/product/volume-archive.mjs:110`, with the incompatible reader bound at line25; `scripts/product-maintenance.mjs:262` publishes the encrypted artifact without validating the generated snapshots.

Cause: the writer limits uncompressed file bytes to256MiB but does not enforce the reader's48MiB limit on the encoded snapshot. The Docker output bound and encrypted-envelope bound are both64MiB. A compressed/base64 snapshot between48MiB and64MiB can therefore pass snapshot generation and package encryption while `inspectBackup` deterministically rejects it through `validateSnapshot`. The source can resume and the backup command can return successful completion for an unusable recovery artifact.

Evidence: a focused file-only diagnostic created one synthetic36MiB random binary file under a newly allocated `.agentbrake-local/ops-review-size-*` directory, called the real `snapshotVolume`, then the real `encryptBackup` and `validateSnapshot`. Observed source bytes37,748,736; encoded snapshot characters50,544,712; encrypted envelope bytes50,544,791 (below64MiB); validation failed with `Invalid volume snapshot`. The minimal envelope intentionally isolates the format mismatch; no full Docker backup was claimed. Other small snapshots and configuration fit in the remaining package budget. The temporary directory was removed after checking its resolved parent/name.

Required change/acceptance: use a shared effective bound or validate every generated snapshot before publishing backup success. A synthetic incompressible boundary case must either round-trip through the actual inspection/restore validator or fail the backup explicitly before successful completion. Preserve the existing source-service resumption behavior on this rejection. Merely increasing one bound without keeping writer, transport, envelope and reader limits consistent does not close this finding.

## OPS-2 — P2: Restore can mutate an existing foreign volume before rejecting it

Location: `scripts/product-maintenance.mjs:361` (label-only volume collision query) and lines410–423 (initialization before ownership validation). The invoked `infra/product/compose.yaml` volume-init command runs `chown` and `chmod` on all three named volume roots.

Cause: the fresh-destination preflight only finds volumes carrying `com.docker.compose.project=<destination project>`. An existing exact-name volume such as `agentbrake-product-<name>_control-data` without that label is invisible to the query. Compose can reuse an existing unlabelled named volume. Restore then runs volume-init against it, changing ownership/mode, and only afterward reaches `volumeInfo` via `volumeTransfer`, where the foreign ownership is rejected. Rejecting at that point does not undo the already-performed metadata mutation. This violates the required existing/foreign destination rejection without damage even though file contents are not overwritten.

Evidence: source/command-order finding; no Docker mutation or runtime reproduction was performed in this review. The preflight has no exact-name volume lookup, the helper mounts the generated exact volume names, and the first ownership check is downstream of the mutating Compose initialization. This is independent of the successful prior fresh-project restore, which had no foreign-name collision.

Required change/acceptance: reject every existing exact destination volume name before invoking any initializer or mutating Compose command, regardless of its labels; retain the project-label check for other existing project resources. A focused disposable integration case should precreate an exact-name unlabelled volume with sentinel content and known ownership/mode, attempt restore, and verify refusal with content/metadata unchanged and no installation directory created. Do not rely on the later transfer ownership guard.

## Verification and limits

The only executed diagnostic was the local synthetic size-bound reproduction above. No source files, real credentials/data, Git state, Docker resources or external services were changed. Only this review report was added. No broad suite or new runtime acceptance was run.

The source review found no additional concrete defect in the cold stop/snapshot/finally-resume ordering, AES-GCM authentication, archive traversal/duplicate-entry handling, recovery's use of existing audited store operations, or the current additive migration's transaction/checksum guard. The release gate requires the service proof and matching source hash; packaging and complete release remain pending as the implementation report states. These observations are scoped review conclusions, not runtime certification.

Prior run5e7893b0 remains evidence for its real cold backup/restore, preserved audit/target state and authority suspension, with `PASS_RUNTIME_SOURCE_CHANGED`. The newer managed-account recovery and migration-ledger extensions have not yet run through the installed service. Their missing runtime coverage is explicitly an outstanding integration gate, not a third confirmed defect. Completion status: scoped review complete; task3 approval withheld until OPS-1 and OPS-2 are resolved and the planned relevant checks pass.
