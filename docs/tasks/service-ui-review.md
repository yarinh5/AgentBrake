# Task 2 — independent scoped UI/proxy review

Review status: complete, with one required correction. **Specification verdict: substantially implemented, but the team-editing flow has a P2 usability defect. Code-quality verdict: changes requested for that defect.** The diff otherwise preserves the scoped proxy boundary, extracts the new panels appropriately, and uses real account endpoints and server-authoritative outcomes.

## Finding

### P2 — periodic refresh silently discards unsaved member changes

Location: `src/components/AccountPanels.tsx:50` (member draft synchronization), together with `src/components/AccountPanels.tsx:67` (team reload on workspace revision).

`MemberCard` resets its local role and active controls whenever the `member` object changes. `TeamPanel` fetches a new team payload whenever `workspace.updatedAt` changes. The existing App refreshes `/workspace` every ten seconds, and the named backend contract check confirms that `server/app.ts:280` generates `updatedAt` using the current time on every response, even if nothing changed. Each team response produces fresh member objects. Consequently, selecting a role or toggling active, then pausing until the next background refresh, silently restores the original selections. Clicking Save afterward can report success for the unchanged authority and unnecessarily revoke the member's sessions.

Preserve unsaved drafts across unchanged background member data. Synchronize against meaningful authoritative fields, or explicitly handle dirty drafts when actual authority changes. Keep the existing explicit rollback after a rejected save and authoritative update after a successful save. Acceptance: change a role and active selection, allow a normal background workspace/team refresh without server-side member changes, and confirm both edits remain; Save must send those selections. Existing last-administrator rejection must still display authoritative state.

Evidence: direct changed-code inspection plus the focused `/workspace.updatedAt` contract check. No speculative backend or security redesign is required.

## Specification and quality assessment

- Public shell selects setup, managed account sign-in, and legacy key access from the real setup/session APIs. Fragment invitation/reset tokens are removed from the address and held in component memory; the same-document hash listener handles later links. Forms clear submitted secrets and provide backend errors and fresh-link guidance.
- Team and Settings are restricted by account mode and role, and the server remains authoritative. Invitation/recovery creation, revocation, profile rename, password change, session invalidation and role/active updates use the documented routes and projections. One-time links include expiry and manual-sharing instructions; no email delivery is claimed.
- Getting started is linked from the requested pages, describes scoped MCP HTTP access, independent review and evidence, and provides host command instructions without claiming execution. A focused `scripts/product.mjs` command-name check confirmed doctor, backup, restore and diagnostics handling.
- Proxy additions are exact anchored account routes/methods. The diff preserves existing host/origin, fixed destination, body and credential-forwarding boundaries. No arbitrary SQL, target route, agent credential access, or widened agent network access is introduced by this diff.
- The test runner separates fresh legacy and managed fixtures sequentially with cleanup. The managed scenarios use the real Next proxy and backend for the principal account and approval/evidence flows, with synthetic identities. The invitation-expiry mutation is confined to the ephemeral test fixture.
- The new components use native labeled controls and status/error roles and retain the current visual vocabulary. Dense one-line formatting reduces readability, but this is not a separate blocking finding.

## Checks and coverage limits

Read the requirement brief and implementation report and reviewed the complete 14-file snapshot diff. The initial combined tool output was truncated, so only the omitted diff sections were retrieved afterward. Focused outside-diff checks covered the backend account route/result shapes, token format and expiry constants, member session invalidation, workspace timestamp semantics, operational command names, and the existing Playwright runner configuration.

The implementation report records final TypeScript and production dashboard build success, 16/16 browser workflows (10 legacy plus 6 managed), and 4/4 proxy checks. These were **not rerun in this review**, as instructed. The added tests do not exercise a dirty member form across a background poll; their immediate select-and-save interaction does not cover the finding above.

No source, fixture, operational script, configuration, Git state or service was modified or started by this review. This review wrote only this report. Installed Docker/PostgreSQL UI integration, encrypted backup/restore execution, full release checks and live integration remain outside this scoped verdict. The review is complete; the reported P2 correction and its focused acceptance check remain outstanding.
