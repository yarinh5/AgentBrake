# Product UI review

Review date: 2026-11-16. Scope: the saved UI source diff and new-file package, the task brief and implementation report. This was a read-only review apart from this report. No product source edits, Git operations, services, paid APIs or deployment were used.

**Specification verdict: changes required.** The assigned local UI substantially follows the brief, but the evidence view can continue presenting an obsolete execution observation after the action changes.

**Code-quality verdict: changes required.** One Important state-synchronization defect; no Critical findings. The existing components/styles are reused, API transport is centralized, and the proxy has a small explicit destination/route/header contract.

## Findings

### Important — Refreshing the workspace does not refresh the selected evidence

Location: `src/ProductApp.tsx:189` (effect dependency), with the caller at `src/ProductApp.tsx:108`.

`EvidencePage` fetches `/evidence/:id` only when `id` changes. Its `actions` prop changes on the application's ten-second workspace polling and explicit Refresh button, but neither causes that effect to run. A reviewer can select evidence for a pending action, another reviewer can execute it, and the first browser will keep rendering the old `pending` / `not-dispatched` evidence and “No target dispatch was recorded” text indefinitely. The action selector can already say `allowed` or `unknown`, and an export fetches the newer evidence, leaving contradictory observations on the same page. Explicit Refresh does not resolve it.

This follows the real interface: `server/control-experience.ts:27` derives observation from the action's current status, and `server/control-experience.ts:40` builds evidence on each GET. The defect is the browser's stale cached response, not an API requirement for a push stream. It matters to the brief's honest execution/UNKNOWN evidence requirement.

Change: invalidate/refetch selected evidence on the workspace revision (as Activity already does), or on authoritative changes to that selected action, with existing cleanup guarding stale requests. Keep the selected action ID. Clear or explicitly label an obsolete evidence snapshot while refreshing, and preserve visible read failures.

Acceptance: open pending evidence, complete the action in another session, then use Refresh (and separately allow ordinary polling). The selected evidence must update to the actual `allowed`/`adapter-reported` or `unknown`/`unverified` result without changing the selection. UNKNOWN must show reconciliation guidance. A failed evidence refresh must not silently continue presenting the earlier observation as current.

### Critical

None found in the assigned diff.

### Minor

None raised. Formatting preferences and hypothetical hardening were not promoted to findings.

## Compliance and quality observations

- All eight requested sections are present. Role controls follow the supplied roles. Session CSRF remains in module memory; login input clears on submission; the new bearer is confined to creation-dialog state and cleared on close. No browser storage credential persistence appears in the package.
- Action review obtains the authoritative preview/proof, displays target, arguments, escaped preview, fingerprint, expiry and reviewer, and submits the displayed proof. The decision is locally invalidated before dispatch. A 409 reads workspace state without acquiring a replacement proof or retrying. UNKNOWN has reconciliation guidance and no retry control. Missing preview/review failure disables approval.
- UI authorization is not being treated as the security boundary. The named backend interface inspected in `server/app.ts` authenticates cookie sessions, checks mutation CSRF, restricts task/policy/approval roles, and passes the authenticated actor to approval. Backend self-approval logic is separately present in `server/gateway.ts:452`. This interface inspection is not a full backend security audit.
- Structured grant/revoke, server activity filters/pagination, read-only policy history and authenticated evidence exports match the supplied API. Counts are clearly described as a workspace snapshot. Connections distinguish configuration from verified connectivity. Stop text avoids rollback claims.
- The Next wrapper retains shared React source. The proxy fixes its server-side target, bounds JSON reads, validates loopback Host and browser Origin, permits explicit routes/methods, strips bearer/arbitrary headers, and forwards cookie/CSRF with explicit no-store and redirect rejection. Preview content is rendered as escaped text. Pinned dependency manifests and standalone packaging are included.
- The new browser suite uses a real local control app/native OPA and disposable HTTP/Git target fixture rather than mocked product responses. Assertions inspect the exact submitted proof, server self-approval denial, replay/conflict behavior, actual lost response after target commit, grant/revoke, evidence download, role gating and Git previews.

## Verification and boundaries

Reviewed the supplied package once, recovering only output-truncated portions, and inspected the named approval/workspace/evidence interface risks outside it. No successful whole suite was rerun. No additional focused execution was necessary to establish the finding: its trigger and stale response follow directly from the effect's sole `[id]` dependency and the real evidence endpoint's current-state projection.

The implementation report records passing Next build/typecheck, root TypeScript/Vite compatibility, 3 proxy tests and 7 native standalone browser workflows. Those are implementer-reported results, not independently rerun review results. The suite does not cover the stale selected-evidence transition described above.

Docker installation, clean-machine startup/restart, persistent product targets, final control/PEP network isolation and whole-product acceptance remain root-owned cross-task gates. Their completion cannot be inferred from this UI package or native fixture tests. This review makes no production, deployment, live GitHub, PostgreSQL integration or real Codex-session claim. Root's concurrently changing backend/Docker work is outside this verdict except for the named interface checks above.

Completion: review complete; UI acceptance should remain open until the Important evidence-refresh defect and its focused real transition check are addressed.
