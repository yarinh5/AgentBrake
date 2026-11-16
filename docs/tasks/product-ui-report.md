# Product UI implementation report

Status: complete for the assigned local dashboard implementation and native standalone verification. This does not establish whole-product completion, Docker installation acceptance, live integration, production readiness or independent security review. Root owns those broader gates.

## Scope and acceptance

Implemented only dashboard/shared browser source, new product UI tests and this report. Preserved the existing palette, responsive shell, logo, badges, modal, metric and policy components. No Git operations, deployment, real account/service access, paid inference, global configuration edits, existing `.env`/auth reads or existing application servers were used. Dependencies were installed only under `apps/dashboard`, using the project-local npm cache; root package manifests were not edited.

Acceptance for this work: standalone Next build and typecheck, root TypeScript/Vite compatibility, actual team-session workflows with in-memory CSRF, structured task grant/revoke, exact reviewed preview/proof submission, independent human review and replay rejection, visible conflict and actual transport-loss UNKNOWN, real evidence export, role gating/mobile layout, and real local Git branch/PR previews. These checks pass against the final revision.

## Changed files

- `apps/dashboard/package.json`, `package-lock.json`: exact pinned Next 16.4.6, React/React DOM 19.3.1, lucide-react 0.468.0 and build/type dependencies. Separate local install; install audit reported zero vulnerabilities.
- `apps/dashboard/next.config.mjs`, `tsconfig.json`, `next-env.d.ts`, `.gitignore`: App Router, standalone root tracing, shared-source package resolution, local security headers and generated-artifact exclusions.
- `apps/dashboard/app/layout.tsx`, `page.tsx`, `dashboard.tsx`: Next wrapper importing the shared React application and styles. No browser exposure of control secrets.
- `apps/dashboard/app/api/[...path]/route.ts`, `lib/control-proxy.ts`: fixed server-only local control destination; allowlisted API methods/routes; loopback Host and exact browser Origin validation; bounded incremental 32 KiB JSON bodies; explicit no-store/redirect:error; cookie and CSRF forwarding; bearer and arbitrary-header stripping; streamed response/SSE forwarding with bounded lifetime. No `/mcp` or agent-action proxy.
- `apps/dashboard/Dockerfile`: root-context build, pinned base-image digest from the existing image lock, standalone nested `apps/dashboard/server.js`, numeric user 1000, port 3000 and fixed `http://control-api:4314`. Container parent `node_modules` symlink resolves shared src against the same pinned dashboard install. No Docker command was executed by this UI task.
- `src/App.tsx`, `ProductApp.tsx`, `api.ts`, `ui.tsx`, `types.ts`, `styles.css`: shared browser-only dashboard and API types. Existing root Vite entry remains compatible. Remote Google font import removed, so the local dashboard does not request third-party fonts.
- `tests/product-ui/constants.ts`, `fixture.ts`, `playwright.config.ts`, `run.mjs`, `workflows.spec.ts`, `proxy.test.ts`: seven real browser workflows and three focused proxy unit tests. The runner explicitly manages/cleans its own native OPA, HTTP target, real temporary Git repository, team API and built standalone Next process.

## Behavior

- Overview derives recorded counts from the workspace API and labels snapshot/fixture limitations; no invented telemetry or charts.
- Tasks displays actual identity/grant owners, resources/actions, expiry, call/row budgets and state; creates sandbox identities, issues structured grants and revokes them. The server records trusted ownership.
- Session reload reads `/api/session`; CSRF stays in browser memory and is attached to mutations. Login input clears immediately on submission. Bearers appear only in the creation dialog and are cleared when it closes; no localStorage/sessionStorage persistence.
- Approvals fetches the real authoritative review. It displays target/destination, exact arguments, adapter preview/diff as escaped text, proof fingerprint, grant fingerprint, policy hash, expiry and reviewer identity. Current grant context is clearly distinguished from the immutable action binding. Missing review/preview disables approval. Independent mutation review is explained and the self-approval button is disabled; the server separately enforces the restriction.
- Decisions submit the already displayed proof once. A 409 triggers a workspace read and visible error, without acquiring a replacement proof or resubmitting. UNKNOWN shows target-reconciliation guidance and no retry/approval button. Recorded reviewer receipts remain inspectable.
- Activity uses server-side agent/grant/tool/status/resource/time filters and pagination. Policies retains the existing editor, gates saves by role and adds read-only revision differences. Save errors remain in the application error banner.
- Connections reflects only API configuration status and says connectivity is unverified. Evidence shows policy binding, review, adapter/not-dispatched/unverified observation, correlation and bounded redacted audit records, including the API's full-chain-verification limitation. JSON/CSV exports use the authenticated API.
- Demo Lab calls the gateway-backed safe-read, blocked-SQL and PR-review endpoints. Branch/PR operations remain pending for a different authorized human. Stop text explicitly avoids rollback/recall claims.

## Research and execution evidence

Official sources read before installing: [Next.js release/security index](https://nextjs.org/blog), [standalone output documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/output). The official docs identified v16.4.6 and `npm view next version` returned 16.4.6; `npm view react version` returned 19.3.1. The Vercel React best-practices skill was read/applied to component boundaries, stable hook dependencies, client-only credential memory, escaped content and server-side authentication responsibilities.

Commands actually run on the final production revision:

| Command, run from repository root unless stated | Result |
| --- | --- |
| `npm install --ignore-scripts --cache ../../.agentbrake-local/npm-cache --fetch-timeout=20000 --fetch-retries=1` from `apps/dashboard` | Installed 30 packages; audit 0 vulnerabilities. Public registry escalation approved. |
| `$env:NEXT_TELEMETRY_DISABLED='1'; npm run build` from `apps/dashboard` | PASS. Next 16.4.6 webpack production build, static dashboard and dynamic allowlisted API proxy; standalone emitted. |
| `npm run typecheck` from `apps/dashboard` | PASS. |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS including root source/server/tests. |
| `node node_modules/vite/bin/vite.js build` | PASS. 1,582 modules; final JS 275.39 kB / 83.50 kB gzip. |
| `node --import tsx --test tests/product-ui/proxy.test.ts` | PASS 3/3. Host/Origin/routes/methods/config/body limits; header binding and credential stripping; Next internal-listen URL regression. These are focused unit tests with an injected transport, not E2E claims. |
| `node tests/product-ui/run.mjs` | PASS 7/7 in 13.1 seconds against actual built standalone Next + team createApp + verified authenticated native OPA + HTTP target + actual disposable Git adapter. No mocked product API responses. |
| Read-only fetches to fixture ports 44214/44215 after runner exit | Both listeners closed. |

The seven browser checks cover:

1. Operator identity creation, bearer shown once, no browser storage secrets, bounded grant values, reload/session-CSRF restoration, revoke and login-field clearing.
2. Administrator own-task review disabled; direct actual API self-approval 403; equal target execution counters.
3. Independent reviewer sees actual DB before/after preview, fingerprint and reviewer; submitted POST proof exactly matches fetched/displayed proof; one target effect; actual replay 409; JSON evidence download, fingerprint/receipt and server activity filter.
4. A second reviewer consumes a review; the open browser's stale submission gets real 409, visible error and refreshed blocked status, with exactly one POST and no automatic retry.
5. Actual upstream target commit with deliberately unreturned HTTP response; adapter timeout records UNKNOWN; exactly one target mutation; no retry button and unverified evidence observation.
6. Viewer role gates policy/task mutation controls; policy history/connections readable; 390px mobile viewport fits; no page errors.
7. Demo Lab actual bounded read/denial; real Git branch preview and independent approval, followed by canonical PR diff/proposal fingerprint and actual approved local PR operation.

## Failures, causes and fixes

- Initial sandbox npm version query returned EACCES for registry network access. Repeated with the explicitly allowed public-registry escalation and project-local cache; succeeded.
- First Next build compiled but prerender failed with React `useContext` null. Cause: an overly broad React webpack alias replaced Next's conditional React aliases. Removed that override; prepend the dashboard install to ordinary package resolution. Final standalone build passes.
- Root's separate Docker build found shared `src` TypeScript unable to resolve React/lucide because Docker installs only `apps/dashboard/node_modules`, whereas host root already had dependencies. Added the minimal build-container parent symlink to the exact app install. Root owns the actual Docker rerun and its acceptance evidence; this task does not claim Docker success.
- Initial browser requests were rejected by proxy Host checks. Installed Next source `next-server.js::attachRequestMeta` confirms Request.url is reconstructed from internal listening hostname/port. Comparing it to the actual browser Host was incorrect, especially with Docker's `0.0.0.0`. Validate the real loopback Host, derive `http://${Host}`, and compare browser Origin against that. Added unit regression and verified all real browser logins/flows.
- Initial Playwright webServer configuration resolved its command relative to the nested config directory. Fixed the root working directory, then replaced opaque Windows webServer cleanup with an explicit IPC fixture runner. An interrupted initial run left the standalone process locked during a build; stopping only this task's session released it. Subsequent final runner exits cleanly and ports are closed.
- First workflow locator assumed the Approvals button accessible name lacked its pending-count badge. Corrected the test to identify the navigation button by name prefix; no product authorization behavior changed to satisfy the incorrect selector.
- First Git demo test read backend workspace immediately after a click, before the second `/api/demo` response. Wait for the real response before asserting the PR. Final actual Git workflow passes.

## Remaining boundaries and concerns

- Root-managed full disposable Docker install/start/restart and final integration verification remain outside this UI task. The actual native standalone entrypoint and static-asset packaging path are exercised by this task; this is scoped evidence, not a Docker or clean-machine claim.
- Existing `tests/browser/workspace.spec.ts` is intentionally untouched per ownership boundaries. Its old Run simulation/Agents/Connect agent/unbound-approval assertions are stale after the C3 flow change. Root was notified to update root verification orchestration to this new runner or migrate those tests.
- The native target fixture is synthetic HTTP state with version checks; the PR path uses actual local Git. Native browser success does not independently prove the product PostgreSQL target, live GitHub App, external TLS or a real Codex session.
- This suite tests real conflict/error and UNKNOWN paths. Historical missing-preview/review-GET failure and policy-save outage are disabled/visible in code but are not separately fault-injected browser acceptance cases. Time expiry/race/cross-tenant authorization remain root backend acceptance responsibilities.
- Browser types intentionally mirror the safe API projection and the exact tool catalog without importing server/driver code. Future backend contract/catalog changes require updating this projection; no runtime fallback fabricates responses.
- Activity uses 10-second polling, not a claimed live stream. The proxy can stream SSE with a 30-second bounded request lifetime, but SSE reconnection is not used or tested by the UI.

Completion: assigned local UI scope and its defined native acceptance conditions are met. No pending backend API mismatch remains for the exercised flows. No whole-product, deployment or production-completion claim is made.

## Review round 1 — selected evidence synchronization

Finding from `docs/tasks/product-ui-review.md` verified: `EvidencePage` depended only on the selected ID. The surrounding workspace refreshed every ten seconds or via Refresh, but its evidence remained the earlier pending/not-dispatched response after another reviewer actually executed the action. The prior suite did not cover this transition, so its passing result did not establish synchronization correctness.

Changed `src/ProductApp.tsx` only in the affected path: pass `workspace.updatedAt` into EvidencePage, include that revision in the existing guarded fetch effect, retain the selected ID, clear the preceding evidence/error before each read and show an explicit refreshing status. Read failures remain visible and leave no earlier execution observation displayed as current. Existing cleanup ignores superseded requests. No result-retention or other product scope was added.

Added three regressions in `tests/product-ui/workflows.spec.ts`, using the same real native team/OPA/HTTP/Git fixture:

- Open pending evidence, approve in a separate actual authenticated reviewer session, press workspace Refresh, and observe allowed/adapter-reported without reselection or old not-dispatched text.
- Open pending evidence for the actual lost-response fixture, approve elsewhere and obtain real UNKNOWN, then allow the normal ten-second poll to update the retained selection to unknown/unverified with reconciliation guidance. This test does not click Refresh or accelerate the application timer.
- After another actual approval, fail only the browser's next evidence transport read. Workspace/approval responses are real; no successful API response is mocked. The error becomes visible, the obsolete evidence detail disappears and the selection remains. The network-failure injection uses Playwright `route.abort("connectionfailed")` and is specifically a browser transport-failure check, not a claimed server outage.

Commands/results for this review fix:

| Exact command | Result |
| --- | --- |
| `node tests/product-ui/run.mjs --grep "selected evidence"` before production changes | FAIL 3/3 as expected: manual-refresh observation remained old, normal-poll UNKNOWN remained old, and no evidence retry occurred to expose the injected read failure. The actual separate-session approvals returned their required allowed/UNKNOWN states first. |
| `$env:NEXT_TELEMETRY_DISABLED='1'; npm run build` from `apps/dashboard` | PASS on the final revision, including standalone emission. An intermediate build found a Windows editing script had inserted a non-UTF-8 ellipsis byte in the new loading label; replaced that byte with ASCII and verified UTF-8 before the successful build. |
| `node tests/product-ui/run.mjs` | PASS 10/10 in 25.2 seconds on the final built standalone. The seven previous workflows also pass. |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS. |
| `npm run typecheck` from `apps/dashboard` | PASS. |
| `node node_modules/vite/bin/vite.js build` | PASS; final JS 275.51 kB / 83.50 kB gzip. |
| Read-only health fetches to this runner's 44214/44215 after exit | Both listeners closed. |

Status: Important review finding fixed and demonstrated acceptance met. Earlier cross-task integration/production boundaries remain unchanged; no additional backend dependency or observed mismatch was introduced.
