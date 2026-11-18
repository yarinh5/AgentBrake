# Authorized GitHub Sandbox validation — executed

Result: **PASS_GH01_GH07_SCOPED_LIVE**, 2026-11-17 11:49:32–11:51:34 UTC. Technical integration only; commercial pilot and Production acceptance remain BLOCKED in ../../EXTERNAL_GATE_STATUS.md.

## Cause, change and scope

The admission check correctly refused an App with `repository_custom_properties:write`. The authenticated settings UI removed that excess permission. App5796132/installation182835437 now expose exactly Contents write, Pull Requests write and Metadata read; only repository1461019528 (`yarinh5/AgentBrake-Sandbox`, owner87584981) is selected. The inspection token was revoked. App events are empty. Hook configuration REST returned404 for an unknown reason; fresh authenticated UI Active=false and empty URL supplied explicit alternative evidence, not an inference from404.

After the user's separate approval, operator setup created only the reviewed README.md and src/example.ts fixtures, disabled Actions, and protected main: one PR approval, stale dismissal, administrator enforcement, no force/deletion, linear history and conversation resolution. No App bypass allowance was returned. These are readback checks, not destructive protection tests. Initial main commit: `7d7873af0fa09e12f12217a40e6030df5bcd8058`.

Existing Gateway, OPA, PostgreSQL, GitHub App adapter and fixed egress were reused without application-code changes. Source SHA256: `855b2915022fae9542d05207f62bec5eb356d942a001a9f3415a738f3b453c8c`, unchanged before/after. Exact image IDs are in summary.json. A separate disposable HTTPS installation used port4336 on loopback. The real App PEM remained outside the repository and was bind-mounted read-only into Gateway only. Public candidate metadata and an explicit validation Compose override prepared that mount; this does not validate the installer's key-copy behavior on Linux.

## Actual checks

| Case | Observed result |
|---|---|
| GH01 | Actual permitted repository/README reads; content SHA256 matched independent observation; target unchanged |
| GH02 | Other repository, unknown delete, write without grant, secret path, main branch, force parameter and workflow path denied before upstream requests; no mutation |
| GH03 | Pending branch did not exist; self-approval denied; distinct managed approver created exactly one feature ref at the baseline SHA |
| GH04 | Rejected PR proposal left target unchanged; subsequent approved proposal changed only src/example.ts and created one Draft PR |
| GH05 | Exact replay returned the same action with no upstream request; repeated approval and changed-argument request ID reuse refused; target unchanged |
| GH06 | Grant revocation stopped pending approval and subsequent read; a stale branch preview refused after the authorized change, with no additional mutation |
| GH07 | Nine selected DNS/direct-IP TCP probes to GitHub API, egress, control API and OPA were unreachable from isolated agent; /run/secrets empty; mediated positive reads/writes succeeded |
| GH08 | NOT RUN LIVE. Fresh offline regression included lost PR response yielding UNKNOWN and replay without side effects; no external fault injection |

The task window began11:50:06 UTC, allowed15minutes and at most20 calls. It used17 tool requests, including replays and denies. Grant changes shared that absolute deadline and the harness retained a total-call ceiling. Fifteen action exports, fifteen independent target snapshots,39 audit entries and74 sanitized upstream request observations were retained. These74 include authentication, previews, reads and five target-mutation HTTP requests; they are not74 agent tool calls. The egress observer records GitHub request IDs where returned, never Authorization or response bodies.

Independent connector fetch_pr/compare_commits corroborated that the actor was `agentbrake-validation[bot]`, the PR is open/draft/unmerged, and exactly one commit/file changed. Result: [Sandbox Draft PR1](https://github.com/yarinh5/AgentBrake-Sandbox/pull/1), branch `agentbrake/validation-28f3ddc1`, head `8ba823980cd1c693df00722e6f1fb7ccffac427c`. Main retained its baseline SHA. The one-line synthetic result has SHA256 `ac3bc40b3f723eca7ec330e913a5016718d74be7447f1fbbeec66426722cee38`. GitHub's synthetic merge_commit_sha field in connector metadata does not mean the PR was merged; merged=false and merged_at=null.

Existing offline adapter/Gateway/control/egress suite was run again with real local OPA and fake GitHub transport: **16 tests PASS,0 failed,0 skipped**, exit0. See offline-regression.json/log. It covers response loss, partial writes, strict scope, preview binding, token refresh and fixed egress. Live success does not replace those fault tests, and local fault tests are not live failure evidence.

## Cleanup and limits

Task grant revoked. The one runtime installation token was revoked with GitHub204; the egress validation wrapper performed this cleanup, so this is not a claim that ordinary product shutdown revokes cached GitHub tokens. Named disposable containers, volumes and networks were removed and absence checked. The synthetic branch/PR remain for review. Existing product-local:9 unchanged image/volume bindings, healthy/running, HTTP200 after the run; no transaction-level continuity claim or upgrade.

The harness used REST /api/actions from an isolated Node probe. It did not run MCP/Codex against live GitHub. Both synthetic owner and approver accounts were automated under the user's preauthorization: account separation was tested, independent human review was not. The separately authenticated observer is independent of the App execution credential, not an independent human auditor. The Gateway export honestly retains adapter-reported execution; independent target confirmation is supplied alongside it rather than rewriting its status.

Audit valid=true is the live server's chain check; the redacted export is not a signed external/WORM receipt. Known test/observer credentials were checked absent from exports/summary; a further bounded pattern scan and checksum inventory accompany the review addendum. No universal DLP, host-agent bypass protection, atomic multi-step Git write, production readiness or broad attack resistance is claimed. No paid services, deployment, merge, App main write or customer systems were used.

## Evidence index

- ../github-live-preflight-99a49dd4-4f23-4f47-8c54-5d26bbd979c9/summary.json; ../github-app-webhook-ui-20261117.json
- ../github-sandbox-setup-af2b4ff8-a0cc-4e50-a1e1-6cfad6e18a29/summary.json
- summary.json, source-manifest.json, harness.mjs, egress-probe.mjs, action-*.json, audit.json
- connector-readback.json; offline-regression.json/log
- ../enterprise-installed-final-health.json

Do not rerun this create-once harness against the populated Sandbox. It intentionally refuses an existing feature branch/PR; any further writes require a reconciled, separately scoped plan. Historical failures and the earlier immutable UNRELEASED archive remain unchanged.
