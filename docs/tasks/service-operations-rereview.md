# Service operations fix1 scoped re-review

2026-11-16. Verdict: **APPROVED within the repair scope — OPS-1 and OPS-2 ADDRESSED; zero open findings in fix1.** This re-review covers the two original findings, the repair brief, the six-file `service-operations-fix1.diff`, the appended implementation report, retained tests and the directly relevant recorded evidence. It does not reopen unrelated operations, identity or UI code.

## OPS-1 — ADDRESSED

The cause was inconsistent encoded snapshot limits: the writer and outer package could accept data rejected by the reader/stdin path. The repair uses `SNAPSHOT_MAX_BYTES` for snapshot generation, validation, stdin and Docker output transport; `BACKUP_MAX_BYTES` shares that64MiB ceiling for envelope creation, decryption and package inspection. The writer explicitly rejects an oversized encoded snapshot. Aggregate package encryption still includes all volumes/configuration and enforces its own overhead allowance, so raising individual snapshot acceptance does not permit an oversized backup.

The retained regression exercises the demonstrated36MiB incompressible file through snapshot generation, authenticated package inspection and the actual helper subprocess stdin/restore path, then compares the restored bytes. The separate50MiB incompressible case verifies writer refusal above the encoded ceiling. Existing envelope authentication, traversal, duplicate/noncanonical entry and nonempty destination checks remain covered. Snapshot/encryption failures still occur inside backup's unchanged `try/finally`, which resumes previously running services; no new return path bypasses that cleanup.

Independent check run for this re-review: `node --test tests/enforcement/volume-archive.test.mjs tests/enforcement/backup-format.test.mjs` exited0: **4tests,4pass,0fail,0skip**, about7.1seconds. No oversized live-source backup/resumption drill was performed; the source-resumption conclusion is based on the unchanged enclosing control flow, not new Docker evidence.

## OPS-2 — ADDRESSED

The cause was label-only collision detection and an ownership check after volume-init's metadata mutation. Restore now lists matching volume names and checks each of the three exact destination names before creating the installation directory; the original project-label checks remain. Before running volume-init, it also creates the stopped container and validates all three volume names/ownership labels. Thus the initializer no longer precedes the ownership guard, including if a foreign volume appears after the initial preflight. The existing per-transfer guard is retained.

Reviewed the controller's recorded RED evidence in `docs/tasks/ops2-red.json`: UID/GID0:0 became70:70, mode0751 became0700, and the destination was created. Reviewed the repair's real-Docker result in `.agentbrake-local/ops-fix1-collision-result.json`: all three exact-name collisions refused; control-data had no Compose project label, target-data and git-data had foreign project labels; each sentinel and UID/GID0:0/mode0751 remained unchanged, each destination stayed absent, and cleanup passed. I did not rerun Docker in this re-review.

The retained `service-volume-collision.mjs` helper asserts these properties, verifies its unique fixture label before deletion, and is called by `verify-service.mjs`. The fix therefore preserves the regression in the full service gate rather than relying only on the one-off evidence.

## Introduced breakage and remaining gates

No concrete introduced breakage was found in the scoped diff. The constant imports are compatible with the standalone mounted archive helper, and the new preflight/ownership ordering leaves fresh restore's migration/recovery sequence in place. The full managed lifecycle and fresh-destination restore, including the new stopped-container creation step, remain the controller's pending integration checks. Neither worker evidence nor this scoped approval claims they have passed, or claims matching-source release/product completion.

Only this re-review report was added by the reviewer. No implementation edits, subagents, Git actions, Docker operations, external services or real credentials/data were used. Completion status: fix1 scoped review complete and both original findings closed; continue the already-planned integration/release gates.
