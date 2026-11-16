# Local operations

> Current persistent product: [LOCAL_PRODUCT_OPERATIONS.md](LOCAL_PRODUCT_OPERATIONS.md). The sections below retain the earlier native/A-B verification instructions. The primary browser suite is now `node tests/product-ui/run.mjs` after the dashboard build; its own ports are44214/44215. Use README for current installation/demo commands; old single-owner UI labels are historical.

1. Node 22.13+: `npm ci`, `npm run setup:policy`. The OPA installer verifies the pinned platform SHA-256 in `services/policy/toolchain.json`; no global install.
2. `npm run dev`, or `npm run build` then `npm start`. Both use port 4312, authenticated OPA and synthetic memory state. The sign-in key is in `.agentbrake-local/access.json`; do not share it. Old port 4310, `.env` and `data/` are not opened.
3. Create a scoped agent and run simulation/MCP. Pending means not executed. Review in the dashboard; agent tokens cannot use admin endpoints.
4. Ctrl+C stops this supervisor's processes and removes temporary OPA auth. Forced Windows termination can leave `access.json`; its key loses authority when the memory server exits and is replaced next launch. Do not stop unrelated Node/Docker processes.

## Failure behavior

- OPA unavailable/timeout/bad auth/malformed output/wrong decision ID or policy hash → DENY. No fallback ALLOW.
- Revoke/expiry/policy change/emergency stop during the PDP await → no dispatch. Quota, taint, authority and execution claim are reserved in one control-store transaction with audit; failures may consume quota conservatively. Revocation after the reservation commits does not cancel that in-flight action.
- Approval expires after 15 minutes or is invalidated by task/policy/destination changes. A new review is required.
- Mutation timeout/crash → UNKNOWN or EXECUTING requiring target reconciliation. Do not retry under a new ID. `action_status` does not consume another execution quota.
- Audit failure before dispatch prevents invocation; failure after dispatch may leave a real effect without final status. No rollback guarantee.
- `/api/health` is process liveness, not OPA readiness or production readiness.

## Reproduce evidence

Run `npm run verify:full` for the Stage2 gate, or `npm run verify:stage1` for native checks and `npm run verify:stage2` for Docker checks separately. Milestone B adds actual local Codex inference using the commands below. Inspect `docs/evidence/latest.json` and that run's summary, logs, manifest and `upstream-proof.json`. `PASS_SCOPED` excludes Docker preflight failure; it never satisfies T20. All included target records are synthetic. Re-run after source changes.

The Node suite uses real OPA, HTTP/MCP, fault injection, races, limits and audit failures. Browser tests start their own memory server at 4311 and refuse to reuse an existing server. If Chromium is absent, install with `npx playwright install chromium`.

Docker verification uses pinned images from `infra/local/images.lock.json`. It generates a unique `agentbrake-a-*` project and synthetic credential files, then tears down only its containers/networks/temporary data. It never prunes Docker or touches `.env`, `data/` or unrelated WSL distributions. Build can download pinned public images/packages; no paid service or real upstream account is used. The verifier does not auto-repair Docker.

The isolated Gateway is private at `gateway:4313` inside its agent network. The trusted verifier creates admin sessions and scoped identities locally; the unprivileged agent has only its one read-only credential mount, no secret/socket mounts and no protected network. Target/control DB, OPA and mock target publish no host ports. The automated verifier intentionally removes fixtures after capturing evidence; this is not yet a persistent installer.

Task API (administrator session only): `POST /api/agents/:id/grant` accepts only `{actions,resources,environments:["sandbox"],expiresInSeconds,maxCalls,maxRows}` within the identity/configured fixture scope, then returns a new grant ID; `POST /api/agents/:id/grant/revoke` blocks future reservations. Agent bearer tokens cannot call either endpoint. Defaults remain compatible with the existing UI; no global Codex configuration is written.

Dedicated PostgreSQL tests use a trusted verifier container with its own synthetic role/owner secrets to inspect grants and inject failures. Those credentials are never mounted into the agent or Gateway. Keep failed run logs and distinguish test/observer failure from a demonstrated security bypass. See `SECURITY_EVIDENCE.md` for retained failures.

## Actual local Codex verification

```powershell
npm run setup:codex-local
npm run verify:milestone-b
```

Preparation downloads the pinned public Ollama image and about 2.5 GB of Qwen3 4B weights to ignored `.tools/ollama-models`. Docker builds also obtain public pinned dependencies, including official Codex CLI 0.169.0. This is not inference on a paid service. The tested host has 64 GiB RAM and NVIDIA RTX2060 SUPER 8 GiB; the overlay requests an NVIDIA GPU. Other hardware/CPU-only operation and fresh-machine provisioning are unverified. No global model service or Codex configuration is installed. `setup:codex-local` validates registry provenance and every model blob; the verifier repeats integrity checking.

Runtime has no public route or published ports. Codex uses an ephemeral home with no inherited login and only its bounded agent token. Qwen runs in a separate hardened inference container; it has only a read-only model cache. Local inference uses 65536 context tokens and records actual runtime metadata. `AGENTBRAKE_ISOLATED=1` permits only the exact private `http://gateway:4313` URL in the stdio bridge, in addition to its existing supported URL contract. The global/client configuration is unchanged.

The full command runs native checks first, then Docker role/isolation/workflow tests, the 26-task deterministic benchmark and actual Codex README/two-row read. It correlates MCP event action IDs with Gateway records, replays the same reads, forces an unauthorized injected write, scans credentials and checks teardown. Expected human approvals are made by a separate trusted fixture operator, never the agent. The published `docs/evidence/milestone-b.json` requires both current-source manifests, all gates and cleanup to pass. `milestone-b-latest.json` is the individual container attempt; inspect its result, not just its presence. Historical success labels in runs before the cleanup correction are explicitly superseded in SECURITY_EVIDENCE.

Teardown enables every Compose profile and verifies zero containers, networks and volumes with that exact project label before removing its synthetic credential directory. If teardown fails, evidence is FAIL and the directory is retained for scoped recovery. Do not use global Docker prune or remove unrelated projects. Public image/model caches remain for reproducibility. Codex warnings about unknown local-model metadata or helper aliases under `/tmp` are retained; acceptance depends on actual successful calls and independent target evidence, not its exit status alone.
