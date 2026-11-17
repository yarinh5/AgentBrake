# Continuous integration gate

Prepared locally 2026-11-17. Hosted execution and branch protection: NOT RUN / NOT CONFIGURED. No repository was created, pushed to, or connected. Activation may incur hosting costs and requires explicit approval of the repository/runner plan.

Workflow: .github/workflows/security-validation.yml, expressed in JSON (a YAML subset) so its structure can be validated without a new parser dependency. All pushes and pull requests run; no path filter can silently omit a security-relevant change. Manual trigger is available. There is no deploy/publish job, production secret, privileged pull_request_target event or persistent self-hosted runner.

| Required job | Executed checks |
|---|---|
| native | Pinned lockfile installs; verified OPA binary; Rego tests; Node regression/security/protocol tests; TypeScript/Vite/Next builds; Chromium managed-account/approval/evidence UI; counted upstream scenarios via verify:stage1 |
| security | Pinned offline Semgrep container with local rules and parser-error gate; CycloneDX SBOM and npm advisory scan for both root and dashboard via verify:security. Registry/API/scanner failures fail job |
| isolation | Disposable Docker network/credential/CLI probes, PostgreSQL authorization/control races and Git fixture workflow via verify:isolation; no real target or paid model |

Each job has a timeout, read-only contents permission, checkout persist-credentials=false and immutable action commit pins. npm install lifecycle scripts are disabled in preparation; normal project builds/tests still execute repository code. An untrusted PR is arbitrary code: keep runners ephemeral with no production access, repository secrets or privileged follow-up jobs. Fork approval/review rules still need repository owner configuration. Workflow self-tests are regression guardrails, not protection against a contributor modifying both workflow and tests; enforce review/CODEOWNERS externally.

Artifacts retain only selected summaries/manifests/SBOM/advisory reports for 14 days; no .agentbrake-local, credentials, backups or browser state. Artifact patterns can include historical checked-in reports: use the current run's sourceHash and timestamps, never an older PASS. Console errors and failed jobs must remain visible. Before enabling remote runs, review the repository/evidence tree for sensitive data independently of upload patterns.

Local validation: tests/production/ci-contract.test.mjs checks parseability, triggers, immutable pins, permissions, execution commands and inclusion in source/package inventory. The same underlying commands are run locally and recorded separately. These checks do not prove GitHub's scheduler, Ubuntu runner, action downloads or branch protection work; obtain a real failed-and-passed hosted run after authorization.

Repository owner must require native, security and isolation checks with no bypass for ordinary changes, protect workflow/policy changes and record exact check names from the first run. Release acceptance additionally requires verify:release (including locally prepared Codex inference/service/TLS), verify:images and external gates. CI passing is not deployment approval. Image CVE scans remain a separate release gate; host/build/helper images are outside the existing four-image scan.

Reviewed official references: [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use), [checkout credential persistence](https://github.com/actions/checkout/tree/11bd71901bbe5b1630ceea73d27597364c9af683), [setup-node](https://github.com/actions/setup-node/tree/49933ea5288caeca8642d1e84afbd3f7d6820020), [artifact retention](https://github.com/actions/upload-artifact/tree/ea165f8d65b6e75b540449e92b4886f43607fa02). Pin updates require review; no automatic dependency upgrades were added.
