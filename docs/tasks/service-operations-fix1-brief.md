# Service operations repair — round 1

Read this first. Own only the two confirmed review findings in service-operations-review.md. The root implemented the original operations task; a fresh worker performs this repair so the controller does not self-review its fixes. Do not spawn agents. No Git repository or commits. Preserve all unrelated source/UI work and product-local.

## Scope and boundaries

Local synthetic data only; no paid services, external targets, credentials or deployment. Allowed files: infra/product/volume-archive.mjs, scripts/product-maintenance.mjs, scripts/backup-format.mjs if needed for aligned limits, tests/enforcement/volume-archive.test.mjs, focused new operations test/helper, and scripts/verify-service.mjs only to integrate the collision regression. Do not edit UI, backend identity, Compose network/security, dependencies, or package versions.

## Findings / evidence

Read the exact findings OPS-1 and OPS-2 in docs/tasks/service-operations-review.md.

OPS-1 has an actual RED test already in tests/enforcement/volume-archive.test.mjs: 36MiB random binary snapshot fits the64MiB encrypted envelope, but restore rejects its encoded length exceeding48MiB. Before repair, `node --test tests/enforcement/volume-archive.test.mjs` fails Invalid volume snapshot. Keep an observable boundary regression. Align writer, reader/stdin, Docker transport and outer-package acceptance, or reject invalid generated snapshots before publishing backup success. Do not simply raise an isolated limit. Preserve source service resumption on backup rejection. Existing archive traversal, duplicate, binary and nonempty-destination checks must stay.

OPS-2 was reproduced on real isolated Docker: docs/tasks/ops2-red.json (original copied from ops2-reproduction.json), diagnostic .agentbrake-local/ops-collision-probe.mjs. Exact-name volume with foreign project label escaped the label-only preflight; restore changed root UID/GID0->70 and mode0751->0700 before throwing Volume ownership mismatch, and created the destination directory. Synthetic sentinel contents stayed intact. Probe cleaned only its own resources.

Reject existing exact-name destination volumes regardless of labels before creating the destination or invoking mutating Compose initialization; retain existing project-label checks. Ensure no ownership-validation gap allows an initializer to touch foreign volumes. Add a focused real-Docker regression using only unique verify-* names and a synthetic sentinel, confirming unchanged contents/UID/GID/mode, refusal and absent destination directory. Integrate it into verify-service (or a helper it calls) so final release retains this case. Any cleanup must prove ownership of the freshly created test resource; never remove unrelated volumes.

## Validation / report

Run targeted archive/encryption tests with actual commands/output. Run real Docker collision regression against the retained synthetic backup below (or full verify-service if needed); do not claim runtime proof from mocks. Docker commands need escalation and use the project helper or explicit `--config .agentbrake-local/docker-public --host npipe:////./pipe/docker_engine`. Container helpers must be network-none. Root will run full managed lifecycle and final release after review, so avoid redundant whole suites.

Available synthetic backup: .agentbrake-local/backups/verify-service-5e7893b0-1f0e58a1-7ff7-4397-952b-b3ebe3f874fa.abk
Key file: .agentbrake-local/product-verify-service-5e7893b0/recovery-key (do not print key).

Append cause, change/rationale, commands/results, remaining gaps and status to docs/tasks/service-operations-report.md. Return only status, changed files, focused test summary and concerns. Keep implementation small and stop once these acceptance cases are met.
