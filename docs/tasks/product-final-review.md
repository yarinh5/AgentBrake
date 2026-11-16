# AgentBrake final product review

Date: 2026-11-16. Reviewer: separate final-review agent. Review-only task; no product source, tests, configuration, dependency, Git or Docker changes. The only retained file created by this task is this report.

## Verdict

**Changes required before closing local engineering acceptance. Two Important findings (P2), no confirmed Critical finding.** The review is complete within the supplied final core/security/runtime/install package and the named integration checks below. The current design supports the stated local, single-tenant, synthetic-target boundary; this is not a production or external human security certification.

The two findings concern the explicit environment-file isolation contract and missing human attribution for control-plane audit events. Neither is a demonstrated agent authorization bypass or duplicate target mutation. They remain open; this review did not implement fixes. A passing release suite cannot establish these missing contracts because the examined assertions do not exercise them.

Snapshot: `docs/tasks/product-final-review-package.txt`, 44 complete current files, plus `docs/tasks/product-final-source-manifest.json`, source hash `ed21d6ae1f9043b4e2fb0575c2a75395d9d9aa10397e3c3813052c5aa77ba79b`. A read-only manifest regeneration during review matched this hash and counted 140 manifest entries. No Git repository/base exists; no diff or commit has been invented.

Readiness remains conditional on fixing the findings, focused regression checks, and a successful final release gate for the resulting exact source. The parent is running the full release suite separately. Independent clean-machine installation, external human security sign-off, live GitHub App and production remain explicitly outside this local verdict and open/disabled as documented.

## Findings

### CR-001 — Important/P2: Compose can load existing environment files despite the isolated-install contract

Status: **open**. Confidence: **confirmed by source and official Compose contract; Docker reproduction not run**.

Locations: `scripts/product.mjs:34`, `scripts/product.mjs:163`, `scripts/product.mjs:201`; the same launch family occurs in `scripts/verify-isolation.mjs:40`, `scripts/verify-isolation.mjs:100` and `scripts/verify-isolation.mjs:156`.

Expected: the explicit continuation boundary and `docs/LOCAL_PRODUCT_OPERATIONS.md` promise no loading of existing `.env` files. Installation and verification should derive their Compose configuration from the selected installation and intentionally supported inputs, without silently consulting unrelated environment files.

Actual: `productConfig()` copies all of `process.env`; `dockerProduct()` forwards it to the child. `composeProduct()` supplies the project and Compose file but neither an explicit controlled `--env-file` nor a default-environment-file disable setting. Thus normal Compose default loading remains enabled. An inherited `COMPOSE_ENV_FILES` also selects existing files automatically. The isolated verification wrapper has the same omissions and retains its inherited environment when adding generated values.

Supported trigger: run `node scripts/product.mjs start NAME` or the isolation verifier from a shell with `COMPOSE_ENV_FILES` pointing to an existing unrelated environment file; alternatively, have an existing `.env` at Compose's default project location. Compose reads it even though the application never imports `dotenv`. A value such as `RESULT_RETENTION_HOURS` or `LOG_MAX_SIZE` can unexpectedly change the generated product configuration; malformed environment-file content can prevent startup. Reading the unrelated file itself violates the authorization boundary. This finding does **not** claim that all its values are passed into every container or that a secret was actually disclosed in this review.

Evidence: Docker documents that `COMPOSE_ENV_FILES` selects files when `--env-file` is absent, default `.env` discovery otherwise applies, and `COMPOSE_DISABLE_ENV_FILE` defaults to false. See [Docker's Compose environment controls](https://docs.docker.com/compose/how-tos/environment-variables/envvars/) and [interpolation/default file selection](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/). The separate `docker --config` directory controls Docker CLI configuration; it does not disable Compose environment-file loading. Explicit `-p` and `-f` protect project/file selection but do not close this boundary.

Smallest systematic repair: explicitly select a generated empty/controlled Compose environment file or disable default discovery, and prevent inherited environment-file selectors from bypassing that decision. Apply the same rule to the product lifecycle and isolated release-verification launchers. Preserve intentional documented retention/log inputs. Do not solve this by reading or rewriting the user's real `.env`.

Acceptance checks, **not run**: use disposable synthetic directories/files with unique canary values and an inherited `COMPOSE_ENV_FILES`; verify the actual launcher ignores both implicit and inherited files, configured defaults remain unchanged, intentionally supplied retention/log options still work, and normal product install/stop/restart/reset remain scoped to the named installation. A malformed synthetic environment file makes unintended reads observable without using real credentials. Check the verifier launcher too.

### CR-002 — Important/P2: Human control changes lose the authenticated actor in audit

Status: **open**. Confidence: **reproduced through real loopback team API with in-memory storage; persistent PostgreSQL path confirmed by source**.

Locations: `server/app.ts:272`, `server/app.ts:328`, `server/app.ts:335`, `server/app.ts:344`, `server/app.ts:349`; persistent audit writes at `server/postgres-store.ts:156`, `server/postgres-store.ts:172`, `server/postgres-store.ts:314`; compatibility equivalents at `server/store.ts:78`, `server/store.ts:84`, `server/store.ts:221`.

Expected: FR-08 requires actor-bearing events, the completion plan promises actual operator identity in audit, and team stop/revoke/policy management must remain attributable to the authenticated human. The task owner is not necessarily the operator who later revokes or changes a task.

Actual: access middleware authenticates the human and places the trusted identity in `res.locals.actor`, but policy, stop, pause/resume and grant/revoke calls omit that context when calling the store. Store audit writes record only new policy/paused values or agent/grant identifiers. The interface has no actor argument. Exports and local traces cannot reconstruct the missing actor; traces intentionally omit session/credential data. Approval execution does retain its approver receipt, so this is specifically the other control-mutation family.

Supported trigger: Alice, an administrator, changes a policy or stops/resumes the workspace; Bob, an operator, revokes Alice's task. All requests succeed, but their audit events do not identify Alice or Bob. With multiple configured operators, an incident investigation cannot distinguish who weakened a policy, resumed execution or revoked another task. The grant's current `human_owner` cannot fill this gap because it identifies ownership, can change on reissue, and is not the revoker.

Observed probe on the reviewed source: an ephemeral team `createApp` server, `Store(':memory:')`, Alice administrator and Bob operator, with real login cookies/CSRF. Alice created a synthetic read task, then sent stop and policy-change requests; Bob revoked that task. HTTP statuses were `[200,200,200]`. The resulting event details were:

```json
[
  {"type":"control.changed","details":{"paused":true}},
  {"type":"policy.changed","details":{"reads":"deny","databaseWrites":"approval","githubWrites":"approval"}},
  {"type":"grant.revoked","details":{"agentId":"<generated UUID>","grantId":"<generated UUID>"}}
]
```

No target tool was invoked, no OPA or Docker process was started, and the listener/store were closed in `finally`. This demonstrates the API/caller omission; the PostgreSQL implementation was inspected rather than rerun.

Smallest systematic repair: pass a small trusted audit context from the authenticated control handler into the store mutations, and persist actor ID/tenant (and correlation if used) within the same mutation/audit transaction. Cover policy, stop/resume, agent pause/resume and grant issue/revoke consistently; attribute creation from its trusted owner context. Do not accept client-supplied actor fields and do not serialize sessions, keys or CSRF values.

Acceptance checks, **not run**: actual team API requests from distinct humans produce correctly attributed durable events; an operator revoking another owner's task is recorded as the operator. Forged client actor fields cannot alter attribution. Missing CSRF/insufficient roles change neither state nor successful-mutation audit. Injected audit failure preserves transaction rollback in the PostgreSQL mutation paths. Assert the actor survives JSON/CSV redaction/export and restart, with no credentials included. Retain the existing independent-approval receipt tests.

## Coverage and architecture

Read requirements: `README.md`, `docs/PLAN_PRODUCT_COMPLETION.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/TEST_MATRIX.md`, `docs/LOCAL_PRODUCT_OPERATIONS.md`, relevant FR-01–09/PD-16/threat-model/T13–30 portions of the PRD, and the master build prompt. The scoped UI review, fix re-review and implementation report were read; their separate UI work was not represented as a fresh rendered review here.

The important path is browser → loopback fixed ingress → Next allowlisted proxy → role/CSRF-authenticated Control API → authenticated private Gateway bridge → PEP/OPA → atomic control reservation → fixed local target adapter. Agents enter only the Gateway action/MCP surface. PostgreSQL control and target stores are separate. Pending review, target response and independently observed target state are distinct concepts.

| Area | Coverage | Evidence and limits |
| --- | --- | --- |
| Control API, operators, grants, approval proof | Reviewed | Complete packaged `app`, `operators`, `approval`, `contracts`, control interface; traced caller identity through private bridge and reservation; bounded real API audit probe. |
| PEP, idempotency, authority rechecks, request limits | Reviewed | Complete `gateway`, `limits`, connector contracts; examined current/persisted envelope comparison, quota and taint behavior, errors and replay. |
| MCP HTTP/stdio, protocol/config | Reviewed | Complete packaged transports; authenticated agent identity, envelope/header/SDK contract, per-request server, error minimization and recovery paths. Official SDK internals not independently re-audited. |
| PDP | Reviewed | Packaged client/contracts plus actual Rego/authz files to resolve final grant/action/row checks and policy-byte binding. No PDP process launched by reviewer. |
| Control persistence, query/export, retention | Reviewed | Complete PG/SQLite stores, control experience/query, startup recovery; bootstrap control SQL/shell inspected to resolve runtime privilege and append-only enforcement. PostgreSQL execution belongs to parent suite. |
| Git and PostgreSQL target adapters | Reviewed | Complete adapters, HTTP fixture transport/target/mock process, DB preview and version migration; target bootstrap SQL/shell inspected for function ownership, permissions and checked-function migration. |
| Product install, ingress and private-network boundary | Reviewed | Complete packaged product entrypoint, lifecycle, Compose and probe; Dockerfiles and ignore rules sampled for image/credential boundary. No Docker commands run by reviewer. CR-001 remains open. |
| UI | Separate review incorporated; cross-boundary code reviewed here | `product-ui-review.md`, `product-ui-rereview.md`, `product-ui-report.md`; complete packaged Next control proxy. Visual/shared React source and 10 browser workflows rely on the separate review and reported execution, not an independent repeat. |
| Local telemetry | Reviewed | Explicit SDK/exporter and safe fixed attributes; no automatic request/resource collection or remote exporter configured. Runtime exclusion test result supplied by parent. |
| Release/source/security tooling | Reviewed within package; wider harness sampled | Complete product/security/release/source/stage1 verifier files and eight local scanner rules; `verify-all` and isolation launcher inspected for hash gating/environment-risk callers. Detailed model/corpus/isolation workload implementations outside package were not re-audited. Parent owns their execution. |
| Tests | Sampled | Team approvals/control experience source read; named PG, REST audit, race, restart/retention evidence mapped. Full suite not rerun. This review does not claim every test implementation was examined. |
| Legacy developer entrypoints | Reviewed within package | `index`, `stage1`, `isolated` and MCP config; live connectors fail closed. `package.json` confirms documented developer command routes through the disposable launcher, not the old dotenv entrypoint. |
| Real GitHub, production, SSO, multi-host HA, external review, independent clean machine | Excluded | Explicit local MVP limits; not silently treated as passing. |

## Security behaviors examined and not promoted to findings

- **Forged approval and self-approval:** team role/tenant/CSRF checks precede bridge dispatch; bridge requires its separate bearer, literal team mode and strict proof. PEP checks the independent reviewer against current grant owner, immutable fingerprint/nonce and expiry. Grant or policy change invalidates the old review. A host administrator possessing all keys remains outside the promised boundary.
- **Duplicate approval and authority races:** PostgreSQL reservation locks settings, agent and action in a consistent order, rechecks the persisted envelope and current authority, and writes execution claim/quota/taint/pre-dispatch audit in one transaction. Losing a claim conflicts rather than calling the target. Local process inflight coalescing is an optimization, not the sole persistent guard. One Gateway per installation is an explicit limitation.
- **TOCTOU at target:** DB execution forwards the reviewed version to the checked one-row function; version mismatch makes no update. Git verifies main/feature/state refs in one ref transaction and persists mock PR metadata with the feature update. A Git failure may conservatively yield UNKNOWN even if no ref changed; this does not fabricate success. Temporary unreachable Git objects are not a published branch/PR effect.
- **Post-dispatch uncertainty:** write transport/adapter errors become UNKNOWN and consume the original request identity. Recovery at exclusive Gateway startup changes queued/executing records to UNKNOWN without replay. Control API startup does not reconcile active Gateway work. Stop/revoke applies at new reservation, not rollback of an already reserved effect; this matches the explicit operations boundary.
- **Private interface exposure:** public Gateway surface rejects human-control routes; control surface rejects agent routes; private bridge binds the control-network address. Next has no target/PDP credential and no arbitrary proxy destination. Loopback ingress is the documented sole ordinary-network member and has a fixed destination. Full DNS/IP/mount checks are parent-run evidence, not something this static pass claims to have reproduced.
- **Secret/evidence claims:** blocked raw arguments are discarded, common secret-shaped output is withheld, agent projections strip human preview/proof/receipt, exports redact credential fields/patterns and neutralize CSV formula cells. Pattern-based content controls are explicitly bounded, not universal DLP. Evidence labels `adapter-reported`, `not-dispatched` or `unverified` and explicitly denies standalone full-chain proof for filtered/redacted exports. UI stale evidence is addressed by its separately reviewed fix.
- **Audit failure and tampering:** dangerous dispatch requires successful reservation audit; PG runtime cannot UPDATE/DELETE/TRUNCATE audit rows and startup verifies the chain. The host/bootstrap owner can rewrite storage/code; no WORM/signing claim is made. This does not excuse CR-002: authentic events still need their human actor.
- **Retention and tracing:** pruning removes terminal result payload only; approval/replay/audit metadata persists. The disk-growth limitation is documented. Local telemetry emits fixed route/method/status/server-generated correlation fields and no bodies, headers, URLs or error strings. Missing external collector/HA/backup is an excluded production capability, not a newly invented local blocker.
- **Preview is not mutation:** DB preview is a bounded reader operation exposing id/status/version, and Git proposal reads objects to construct the canonical diff. Target observation counters separate preview from execution. Adapter rejection after a reserved dispatch is not mislabeled as zero upstream calls in the documented contract.
- **Release precision:** aggregate verifiers require successful subordinate results, cleanup and matching source hashes; prior `PASS_RUNTIME_SOURCE_CHANGED` is correctly insufficient. The limited Semgrep rules/SBOM/npm scans do not claim exhaustive vulnerability or OS-image coverage. No dependency vulnerability was invented from a manifest alone.

## Checks actually performed and evidence limits

All commands ran from `F:\project love\AgentBrake`. Read-only bounded `Get-Content`/`rg` inspection covered the source package and named files above. An initial test-path search used guessed flat paths and reported missing files; `rg --files tests` resolved the real nested paths before inspection. This was a discovery miss, not a product/test failure.

1. `node --input-type=module -e "import {sourceManifest} from './scripts/source-manifest.mjs'; const m=await sourceManifest(); console.log(JSON.stringify({sourceHash:m.sourceHash,files:m.files.length}));"` — exit 0; exact hash above, 140 files.
2. `node --import tsx --input-type=module` with an inline stdin probe — exit 0; real control API returned 200 for stop/policy/revoke and emitted the unattributed audit events recorded in CR-002. The probe used `createApp({databasePath:':memory:', operators:[Alice administrator, Bob operator]})`, two synthetic login credentials, actual cookie/CSRF authentication, POST `/api/agents`, POST `/api/control`, PUT `/api/policies`, POST `/api/agents/:id/grant/revoke`, then `store.auditTrail()`. The listener/store were closed and no fixture state was retained.
3. Official Docker documentation read on 2026-11-16 to verify environment-file behavior; URLs cited in CR-001. No private source or credentials were sent to those pages.

For an exact repeat of the bounded audit probe, the essential real-path sequence is:

```js
// Run with Node --import tsx --input-type=module.
import { createApp } from './server/app.ts';
const operators = [
  {id:'alice',name:'Alice',tenant:'local',role:'administrator',key:'review-only-alice-key-00000000000000'},
  {id:'bob',name:'Bob',tenant:'local',role:'operator',key:'review-only-bob-key-0000000000000000'}
];
const s = createApp({databasePath:':memory:',adminKey:'review-only-admin-key-00000000000000',operators});
const server = s.app.listen(0,'127.0.0.1');
await new Promise(r => server.once('listening',r));
const base = 'http://127.0.0.1:'+server.address().port;
async function request(path, headers, body, method='POST') {
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json(),headers:r.headers};
}
async function login(key) {
  const r=await request('/api/login',{}, {key});
  return {Cookie:r.headers.get('set-cookie').split(';')[0],'X-AB-CSRF':r.body.csrfToken};
}
try {
  const alice=await login(operators[0].key), bob=await login(operators[1].key);
  const made=await request('/api/agents',alice,{name:'review audit probe',tools:['database_read'],resources:['customers'],sandbox:true});
  await request('/api/control',alice,{paused:true});
  await request('/api/policies',alice,{reads:'deny',databaseWrites:'approval',githubWrites:'approval'},'PUT');
  await request('/api/agents/'+made.body.agent.id+'/grant/revoke',bob,{});
  console.log((await s.store.auditTrail()).map(r=>JSON.parse(r.data)));
} finally {
  server.closeAllConnections(); await new Promise(r=>server.close(r)); await s.close();
}
```

The parent supplied these preceding results: native 122 pass / 4 explicit PG skips; security run `8840c26d-ebd2-4bd5-a705-5c57ac9d264d` with eight rules/zero findings and npm zero advisories; product run `4be2de94-e134-468c-83c6-39d943136c9a` with all runtime cases passing but source changed during execution; UI final 10 real browser workflows passing. At report finalization, the parent additionally reported the frozen-source native/Codex/isolation gate passing: 122 native, 4 explicit PG skips, 20 actual PostgreSQL checks, 16 Linux Git checks, 10 browser workflows, 26 baseline tasks with 24 completed and 2 false blocks, authorization p95 5.85 ms, actual Codex 2 actions/2 replays/task-scope denial, and zero remaining scoped resources. Persistent product/security aggregation was still running. These are **parent-reported execution evidence**, not tests run by this reviewer, and do not replace a matching-source gate after fixes.

No heavy tests, Docker commands, real/paid service access, deployment, existing `.env`/data/global authentication reads, or code fixes were performed. Finding causes and required checks are concrete; no further broad audit is requested. Completion: review/report done; local acceptance requires the focused consolidated fix wave and resulting verification. External gates remain open.
