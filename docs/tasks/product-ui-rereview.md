# Product UI scoped re-review — round 1

Date: 2026-11-16. Scope: the original Important selected-evidence synchronization finding and new breakage introduced by `docs/tasks/product-ui-fix1.diff`. Reviewed that diff and the appended round-1 implementation report. No product code edits, subagents, external services or test reruns.

**Original finding: ADDRESSED.**

**Scoped specification verdict: pass. Scoped code-quality verdict: pass.** No new Critical, Important or Minor findings within this fix.

The caller at `src/ProductApp.tsx:108` now passes `workspace.updatedAt`. The evidence fetch effect at `src/ProductApp.tsx:189` depends on both the retained selection and that revision. Thus both explicit workspace Refresh and ordinary polling invalidate the selected evidence. The effect clears prior evidence/error before the new read, retains its active-request cleanup guard and leaves failed reads visible without showing the old observation. The new loading message at `src/ProductApp.tsx:190` makes the intermediate state explicit. This fixes the demonstrated cause without changing approval, proof, mutation or authorization behavior.

The three new tests cover the requested real transition family: separate-session approval followed by manual Refresh to allowed/adapter-reported; actual lost-response UNKNOWN followed by the ordinary ten-second poll to unknown/unverified with reconciliation guidance; and an aborted evidence read after real approval, requiring visible failure, retained selection and removal of obsolete details. The last case correctly describes its fault injection as browser transport failure. Successful approval/workspace responses are not mocked. The tests derive expectations from the observed API outcomes and preserve the selected ID.

The appended report records all three regressions failing before the fix and the final built standalone suite passing 10/10, plus Next/root compatibility checks. Those are implementer-reported execution results; this re-review did not rerun the successful suite, as instructed. The code and targeted assertions satisfy the original acceptance conditions; no remaining evidence gap requires another run for this scoped verdict.

The root-owned MCP template/control URL correction is outside this fix and verdict. Docker installation/restart, network isolation, persistent target integration, final product acceptance and production/live-service claims remain outside this UI re-review. Completion: scoped re-review complete; the original Important UI finding is closed.
