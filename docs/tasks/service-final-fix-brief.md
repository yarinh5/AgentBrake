# Single consolidated final repair wave

Read this first, then docs/tasks/service-final-review.md: FINAL-1/P1 and FINAL-2/P2 are the complete findings. Implement only these demonstrated defects, with regression evidence. No subagents/Git/dependency updates/live systems. Local synthetic data, preserve product-local and all existing work. Root handles final full release, package delivery and installation upgrade. You are the sole implementation worker.

## FINAL-1: interrupted restore cannot bypass suspension

Actual orchestration currently writes a normal installation manifest, copies volumes, then migrates/builds/runs recovery. Reviewer injected build failure after all copies: restore stops/removes lock without recovery; ordinary start then opens full service. See exact report evidence. Persist an incomplete-recovery barrier before destination data exists, make ordinary start fail closed while it remains, and clear it only after successful recovery/audit verification. Retain destination for diagnosis. Cover both failure after volume copies before recovery and failure during recovery, followed by ordinary start: no gateway/control/ingress startup. Success must still run existing recovery and preserve data/audit with old authority denied. Avoid a new bypass or automatic retry of partially applied recovery. Host-owner manual diagnosis can remain separate.

Scope: scripts/product-maintenance.mjs, product.mjs only if needed for its current config/start contract, focused tests and concise SERVICE_OPERATIONS/KNOWN_LIMITATIONS wording if useful. Root's integration helpers must remain intact. Use fail-first tests of actual orchestration; simulated fault IO may support precise failure stages but label that scope honestly. Full real installed restore remains a separate required gate.

## FINAL-2: packaged source includes its real build inputs

Root index.html and public/ assets are absent from sourceManifest and therefore package-release, breaking documented Vite build/release on extraction. Include actual required build inputs/assets in verified source inventory. Add regression against real source/package inventory and validate a newly staged/extracted tree builds. Dependencies may be supplied separately from the current local cache/installation; explicitly state same-machine dependency reuse, never claim independent clean-machine validation. Root will generate the actual gated final archive and revalidate extraction after complete release. Do not forge a PASS release JSON merely to bypass packaging gate. No runtime .env/data/keys/node_modules/model inclusion.

## Context / final evidence

Baseline fa431798...165files is preserved in .agentbrake-local/service-final-fix-base. Actual full managed lifecycle run c81e529a-bddc-43a8-86b1-1cf28359ec90 passed7cases/cleanup0; old-schema clone run docs/evidence/service-delivery/upgrade-clone.json preserved4actions/13audit entries and exact target,002checksum,sourceunchanged. These do not cover FINAL-1 failure path or FINAL-2 extracted package. A pre-fix full release may still be running; it is not final candidate after your edits. Avoid unrelated Docker or shared fixture ports.

Append exact causes, changes, commands/results, scope and remaining gates to docs/tasks/service-final-fix-report.md. Return source-stable handoff, changed-file list, tests and concerns. Root sends exactly one focused rereview of this wave and runs the final matching-source gate afterward. No additional theoretical requirements.
