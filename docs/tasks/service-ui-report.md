# Task 2 — managed account UI and onboarding handoff

Status: scoped UI/proxy implementation complete. Final local production dashboard build, TypeScript, 16 real-browser workflows and 4 focused proxy checks passed. Installed Docker service, encrypted backup/restore and full release checks remain parent-owned; this report does not claim those results or live integration.

## Cause, contracts and change

The demonstrated initial gap was that the public React shell offered only workspace-key login and the dashboard proxy returned 404 for the new account routes. Read the actual managed backend endpoints and response projections before editing. In particular, member updates use `PATCH /api/team/:id`, recovery uses `POST /api/team/:id/recovery`, profile responses wrap `{account}`, member updates return the member directly, and reset returns success without a session.

Added focused AuthPanel, AccountPanels and GettingStarted components. The existing dashboard and real enforcement/preview/evidence components remain in place. Public setup/session loading now selects one-time managed bootstrap, normal email/password sign-in or the existing key-compatible flow. Bootstrap explains the generated administrator key and subsequent ordinary account access. Password confirmation and length constraints are visible and enforced by forms and the real backend; secrets clear on submission.

Invitation and recovery tokens are accepted only from the fragment, removed with history.replaceState before API work, and held in component state. No credentials or tokens use localStorage/sessionStorage or query parameters. Successful invitations open an account session; successful resets clear the landing state and return sign-in. Expired/replayed/revoked links show the backend failure plus administrator/fresh-link guidance. The browser suite exposed a real additional failure: navigating to a recovery fragment within an already signed-in document does not remount React. The fix handles hashchange as well as initial loads and clears the existing client workspace/session before presenting the landing form. Its actual same-tab reset and invitation replay paths now pass.

Team navigation is available only to account administrators. Real APIs list active/disabled members and pending invitations, create/revoke invitations, update role/active status and issue recovery links. Issued links appear once in panel memory with copy/select fallback, expiration and secure manual sharing instructions; the UI never claims an email was sent. A current authoritative member state remains visible when the last-administrator change fails. All client API 401 responses dispatch session invalidation: session, CSRF, workspace, selected action and generated task credential are cleared. The tests demonstrate role revision and disable invalidation on the next UI refresh.

Settings loads the safe profile, updates only the name, displays email and role readonly and changes the password using the current password. A successful password change returns the user to sign-in, and the tests verify the old password is denied. Administrator-issued 15-minute recovery resets and replay rejection are exercised through actual endpoints.

Get started is linked from Overview and Connections and describes scoped identity/grant creation, the generated MCP HTTP connection template, isolated agent network, permitted read, independent human review and evidence. It distinguishes the private HTTP service from the compatibility stdio fixture and explains the control/gateway/target boundary and UNKNOWN reconciliation. Host doctor, backup, restore and diagnostics are copyable command instructions only; no host operation is claimed to run in the UI. Demo Lab stays real.

Proxy changes add exact route/method allowlist entries only. Trusted loopback Host, actual browser Origin, fixed backend destination, bounded JSON body, strict segment/path rules, cookie/CSRF pass-through, dropped bearer authorization, no-store and redirect:error behavior remain. Added account route method and Origin checks plus invalid sibling-route denials. Dashboard package and lockfile root version are 0.2.0 at parent request; dependencies did not change.

## Observable acceptance and verification

Acceptance was the brief's account lifecycle through the real Next proxy/backend with fresh managed fixtures, existing key compatibility, memory-only secrets, server-authoritative failures and retained real approval/evidence behavior. No mocked authentication or fabricated target execution was used. Browser transport abort is used only for the explicit setup-offline test. A test-only bounded invitation-expiry helper changes existing ephemeral fixture invitations; it is not a production endpoint.

RED commands observed before implementation:

- `node --import tsx --test tests/product-ui/proxy.test.ts`: original 3 passed, new account-route check failed on `GET setup` returning 404 instead of 200.
- `node tests/product-ui/run.mjs --managed-only`: new real-browser bootstrap test failed because the Set up workspace heading/form did not exist. The fixture was already in real managed mode and the existing dashboard still showed key login.

Additional diagnostic runs were honestly red during implementation. Recovery in an existing tab demonstrated the fragment-handler bug described above. Other failures were test errors, not backend defects: missing mandatory Origin on Playwright request-context mutations; ambiguous Next route-announcer alert selectors; a mismatched newly added onboarding button label; and replay incorrectly deriving a proof from a redacted evidence projection. Tests now use the caller's required Origin, target the visible error panel, use the actual button label, and capture the proof actually submitted by the browser for replay. No backend change was made to satisfy these incorrect test assumptions.

Final GREEN commands against the final source:

- `npx tsc --noEmit`: passed.
- `node scripts/build-dashboard.mjs`: passed, including Next production TypeScript and standalone build.
- `node --import tsx --test tests/product-ui/proxy.test.ts`: **4/4 passed**, including all original 3 tests.
- `node tests/product-ui/run.mjs`: **16/16 browser workflows passed**, no skipped tests: original legacy **10/10** (25.2s) followed by new managed **6/6** (23.8s), with separate fresh backend/OPA/target/dashboard fixture processes and owned sequential cleanup.

Managed browser coverage includes invalid bootstrap and repeated setup; wrong and correct account sign-in; invitation acceptance in a different browser context and correct viewer role; fragment removal and empty browser storage; viewer/team API and UI restrictions; role change, session invalidation and disable; last-active-administrator rejection; profile rename and password change; old-password denial/new-password success; administrator-issued recovery and old-password denial after reset; same-document reset navigation; recovery replay; expired/revoked/replayed invitations; setup transport error plus real retry and mobile form width; real managed task owned by an account, invited independent approver, displayed actual before/after preview, exactly one committed target update, evidence export and 409 replay of the actual submitted proof. All existing UNKNOWN, stale review, evidence polling/refresh/error, task grant, mobile role controls and Git Demo Lab tests remain unchanged and pass.

Review used the applicable React component-quality guidance: focused components, stable hook ordering, effect cleanup for data reads/listeners, labeled native inputs, readonly authority fields, status/error roles, keyboard-native buttons, min-width and wrapping rules. No new runtime library was introduced. Verification-before-completion was applied to the final checks above.

## Owned source and remaining boundary

- src/ProductApp.tsx, src/api.ts, src/types.ts, src/styles.css
- src/components/AuthPanel.tsx (new)
- src/components/AccountPanels.tsx (new)
- src/components/GettingStarted.tsx (new)
- apps/dashboard/lib/control-proxy.ts
- apps/dashboard/package.json and package-lock.json (version fields only)
- tests/product-ui/fixture.ts, run.mjs, proxy.test.ts
- tests/product-ui/managed.spec.ts (new)
- docs/tasks/service-ui-report.md (this report)

No server, operational scripts, Compose, user .env, global config, Git, dependencies, email/cloud/payment service or live target was changed by this task. No subagents were used. Full product release, Docker/PostgreSQL installed UI integration and host recovery execution remain with the parent task. Native SQLite emits its existing experimental warning; the fixture's existing MCP transport informational message is unchanged. No known scoped UI acceptance failure remains after the final run.

## UI repair round 1 — preserve member drafts across polling

Review finding P2 accepted after checking the execution path and obtaining real-browser RED evidence. The unchanged workspace snapshot still receives a new updatedAt on every normal ten-second poll. TeamPanel therefore reloads team data, producing new member objects. MemberCard synchronized its role/active draft using the whole member object as its effect dependency, so fresh but equivalent data silently discarded unsaved selections.

The smallest correction changes only that synchronization dependency to member.id, member.role and member.active. Unchanged background data preserves drafts; a real authoritative role/active change still reconciles both controls. The existing explicit post-save reset remains, including rollback after rejected last-administrator updates. Polling frequency, APIs, backend authority and session handling are unchanged.

Added a real Playwright regression through the production Next proxy/backend. After the initial team load finishes, it changes both role and active on an existing synthetic account, waits for an ordinary background team read without a manual Refresh or mocked clock, checks both drafts, saves and checks the actual PATCH payload and persisted GET team values. It checks the controls after successful save, then dirties the role again, changes real server authority through the API and waits for another normal background read to confirm authoritative reconciliation. Strengthened the existing last-admin test to assert that both role and active controls return to authoritative values after rejection.

RED: `node tests/product-ui/run.mjs --managed-only` before the source fix passed the first two existing managed workflows and failed the new poll-before-save regression: expected operator, received viewer after the normal refresh. Four later workflows were not run because the suite is serial. This established the reported cause through actual browser/proxy behavior.

The first run after the production fix passed the new 20.9s regression and five other workflows, but the final existing sign-in received the real backend's credential-attempt 429. The additional invitation acceptance in the regression had exhausted the shared bounded attempt budget. This was a test setup issue, not another member-draft defect. The regression now reuses the synthetic account created by the preceding serial workflow; it adds no credential mutation attempt and does not change or bypass the limiter. After that adjustment the seven managed workflows passed. The initial-load wait was then made explicit so neither tested refresh can be a pending manual refresh; the final run below verifies that exact test revision.

Final GREEN against this repair:

- `node scripts/build-dashboard.mjs`: production standalone dashboard and its TypeScript build passed.
- `npx tsc --noEmit`: passed after the final test revision.
- `node tests/product-ui/run.mjs --managed-only`: **7/7 passed**, no skips. The poll/draft/save/reconciliation regression passed in 20.9s; all original six managed account, recovery, invitation and approval/evidence workflows passed. The last-admin role and active rollback assertions passed.

Repair source scope: src/components/AccountPanels.tsx, tests/product-ui/managed.spec.ts and this appended report only. No backend, proxy, operations, fixture, dependency, environment or Git changes. Scoped completion conditions are met; source is stable and implementation edits have stopped. Parent owns the combined legacy/managed run and installed-service/full-release verification; those checks were not rerun in this repair.
