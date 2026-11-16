# Private production candidate review

Status: review complete; one Minor verification finding, no demonstrated Critical or Important defect. This is an agent code review, not external human security sign-off or production acceptance.

Reviewed source: `a1cab2725487abef99275f3b6e8ec4f8c973611dd66c6459b9208b4fdf12d368`, as identified by the supplied review package. Baseline: verified v0.2 archive `d036bd48e5521a477fb407cf71a8692aee31b7275da0d170fa76e64ca2f66700`. No Git repository was initialized or assumed.

## Scope and method

Read `docs/PLAN_PRODUCTION.md` and `docs/ADR/0005-production-candidate.md` before the review package. Inspected its new files and diffs, and the surrounding Gateway, contracts, policy, installation, maintenance, proxy and test paths. Traced authorization through policy, preview, independent review, destination binding, reservation, adapter execution, terminal outcome and replay. Checked the candidate configuration and Compose boundaries against the documented installation path.

No tests were rerun, services started, external targets contacted or application files changed during this review. Previously reported test results are contextual evidence, not independent proof of the design. The cited local TLS report `17105b4e-f3f4-486b-bcbf-e83a64bfe13a` records source `02f873369b611636eb9db4f9e547e57f4a01018f8880588fa7b4cebaf76f3db5`; it must not be treated as exact-revision verification of this reviewed source. The final suite and image scans were still in progress when this review was requested.

## Spec compliance and code quality

- The App connector is explicitly configured and separate from fixture identities. The control API narrows App identities/grants; Gateway independently checks resource and tool authority and retains the existing OPA, approval, reservation and audit path. App key/configuration changes participate in destination binding.
- Repository access verifies numeric repository and owner IDs, full name, default branch and repository state. Reviewed writes also require protected main, the exact base and feature ref, and an unchanged preview. Redirects are refused by both HTTP layers. A rename/transfer cannot simply inherit the previous preview's identity.
- Token minting requests the configured installation and one repository with Contents/Pull requests permissions. Response permissions and repository IDs are checked, and invalid lifetimes are rejected in code. Requests are bounded and provider errors are replaced with credential-free messages. Expiry behavior lacks the planned targeted verification described below.
- Mutations are limited to feature refs, Git objects and draft PRs. Main/force/delete/merge/workflow writes are absent. Errors after the first possible mutation are deliberately converted to a generic error, so Gateway records UNKNOWN instead of a zero-effect TargetChanged result. The existing request replay path returns recorded state without another dispatch. Subsequent changes by another authorized GitHub actor remain an explicitly documented upstream concurrency limitation.
- HTTPS ingress validates the configured authority, fixes the upstream destination and strips forwarded authority and bearer headers. Dashboard mutations require the configured Origin, independent of forwarding headers. Secure cookie issuance and proxy rejection of insecure Set-Cookie responses are wired through the candidate Compose override. The plaintext private dashboard/control links remain inside the stated network boundary.
- Readiness stays BLOCKED for live GitHub, independent clean-host verification, human review, deployment authorization and operational ownership even when local checks pass. Documentation distinguishes local simulations from those gates and preserves product-local. No production-acceptance claim was found.
- The implementation reuses the existing enforcement architecture rather than introducing a parallel authorization path. Transport/configuration injection is limited to server-owned dependencies. Some new code is dense, but no formatting-only changes or broad redesign are requested.

Task 1 and Task 2 implementation are substantially aligned with the plan. Task 3 cannot be declared complete from this review: final exact-source verification and external acceptance remain distinct outstanding evidence, and the Minor test gap below remains open.

## Actionable findings

### Minor — Add the explicitly planned installation-token expiry/cache tests

Location: `tests/production/github-fixture.ts:38`, `tests/production/github-app.test.ts`; exercised implementation: `server/adapters/github-app-client.ts:63-70`.

Cause: the fixture always returns an expiry one hour in the future, and the App tests only demonstrate reuse of that still-valid token. None vary `expires_at` or advance the clock across the cache cutoff. Consequently the planned expiry rejection and refresh behavior can regress while all current App tests still pass. This is a demonstrated coverage gap, not a demonstrated expired-token dispatch or credential leak; severity is Minor for that reason.

Requested focused change: make fixture expiry controllable and test malformed, expired/near-expiry and excessive-lifetime responses, asserting no subsequent repository request uses their token. With a controlled clock, demonstrate that a valid cached token is reused before its safety cutoff and replaced after it, and that a failed refresh does not fall back to the stale credential. These tests directly close the plan's named token-expiry requirement; no wider infrastructure or redesign is needed.

Acceptance: the focused tests fail if lifetime validation/cache expiry is bypassed, pass with the intended broker behavior, and do not require real credentials or network access.

## Declined to judge

- Actual selected-repository GitHub App permissions and live GitHub API behavior: no authorized named target or real App installation was supplied. Offline fixtures cannot establish these facts.
- Independent clean Linux installation, production certificate/DNS/private routing, and operational recovery at the eventual deployment site: unavailable external environment and authorization.
- External human security sign-off, incident ownership, customer/legal acceptance or production readiness: this review cannot substitute for those parties or gates.
- Final full-suite and OS-image vulnerability disposition for the reviewed revision: those runs were ongoing; this report neither predicts their result nor promotes earlier-source reports.

Completion: requested read-only code review and report complete. Finding counts: Critical 0; Important 0; Minor 1. No runtime bug fix is claimed.
