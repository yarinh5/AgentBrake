# Product-to-test traceability

PASS is bounded to local synthetic paths and exact source hashes. Final gate: evidence/local-release.json; preceding runs are separately scoped. Live GitHub and independent external review are not inferred.

| ID | Required behavior | Local evidence path / external gap |
|---|---|---|
| T01 | Approved repository read | Actual Codex/MCP local Git read and audit/replay in milestone-b; opt-in GitHub App contracts covered offline, actual GitHub acceptance pending |
| T02 | Outside repository denied,0calls | Native counted proof + isolated workflow snapshots |
| T03 | Feature proposal/approval preview | Git canonical-diff tests; real browser branch/PR; persistent product review |
| T04 | Main/force push denied | PEP/tool schema + Git tests, unchanged main SHA |
| T05 | Repo/secrets/workflow mutation denied | PEP0calls + adapter path tests |
| T06 | Bounded readonly SELECT | Actual PG reader role/transaction and product mediated read |
| T07 | DROP/TRUNCATE/role/grants denied | PEP0calls and actual PG role/schema equality |
| T08 | Obfuscated/multiple SQL rejected | Strict typed templates; no raw SQL API |
| T09 | Injection does not expand grant | Actual Codex hostile README plus separately forced unauthorized request,0dispatch |
| T10 | Missing/invalid/expired grant | Real OPA/PEP tests and product revoke |
| T11 | Token expiry/audience/theft model | Invalid/expired/wrong audience denied; valid stolen bearer remains bounded until revoke/expiry (no theft detector) |
| T12 | Forged identity/tenant/resource | REST/MCP strict envelopes, trusted owner and team tenant tests |
| T13 | Tool/schema/MCP name mismatch | Protocol/REST rejection audit,0dispatch |
| T14 | PDP fail closed | Fault matrix and actual product OPA stop with unchanged target |
| T15 | Pending restart | Real child-process restart + full product down/up preserves PG proof and Git state |
| T16 | Reviewed action/target changed | Team nonce/fingerprint tests, target re-preview, atomic DB CAS, Git refs |
| T17 | Duplicate/race once | Control reservation races and actual concurrent product approvals200/409,one write |
| T18 | Lost response UNKNOWN/no retry | Actual target commit with lost HTTP response, killed child gateway/recovery, real browser UNKNOWN |
| T19 | Target privilege escalation denied | Dedicated PG role tests including COPY PROGRAM/DDL/old unchecked function denial |
| T20 | Isolated agent cannot bypass | Existing curl/psql/git probes plus product DNS/IP/private-bridge probes and credential mount checks |
| T21 | Kill switch | Native race tests and product stop; already reserved effects cannot be recalled |
| T22 | Other tenant audit/log access | Team foreign tenant login and X-AB-Tenant rejection; one hosted tenant only |
| T23 | Secret minimization | Args/result/error regressions, redacted JSON/CSV, trace secret-exclusion, credential artifact scan |
| T24 | Policy change pending | Revision/hash checks under reservation; product denies previous review |
| T25 | Unknown/malformed/traversal | REST/MCP/OPA/adapter contracts and size/depth limits |
| T26 | Concurrency/rate/audit | Native limits/atomic PG races/audit sink-failure and chain tests |
| T27 | Completion/false blocks |26-task direct baseline vs mediated benchmark; approvals separate; exact final metrics in milestone-b |
| T28 | MCP current/legacy | Executable HTTP2026-07-28/2025-11-25 + SDK stdio interoperability |
| T29 | Fresh clean machine | Fresh disposable product volumes/images on this host tested; independent clean physical machine NOT RUN |
| T30 | Denial leaves state unchanged | Actual PG rows/schema and Git object/ref snapshots; distinguish preview reads from executions |

C requires T13–18,T21–24,T30: final local-release gate records closure only after matching-source verification. D engineering scope includes install/restart/Next/UI/SBOM/SAST/dependency checks; external human sign-off and independent T29 remain open. No market or production gate is claimed.

FR01 → installer/Next/product verifier; FR02 → MCP/Gateway/limits; FR03 → tasks/grants/roles; FR04 → OPA/version binding; FR05 → previews/proof/CAS/receipt; FR06 → local Git mock plus opt-in App adapter with offline contracts; FR07 → typed PG adapters; FR08 → activity/evidence/export/retention/local traces; FR09 → stop/revoke.


## Managed service acceptance

| ID | Behavior | Evidence |
|---|---|---|
| S01 | Single bootstrap, generated-key lockout, password accounts | accounts.test.ts plus isolated PostgreSQL; saturated pre-bootstrap session regression |
| S02 | Invite/recovery replay, expiry and role/session changes | Native HTTP tests; managed.spec.ts real Next/browser suite |
| S03 | Last administrator and audited transaction rollback | Native races and actual PG audit-insert rollback |
| S04 | Account-owned task approved by independent account exactly once | managed.spec.ts and installed verify-service.mjs |
| S05 | Encrypted cold snapshot, source resume, restored account/audit/target state | verify-service.mjs, matching latest-service report |
| S06 | Restore refuses wrong key/existing destination/foreign-name volume without mutation | Encrypted format tests and actual Docker collision regression |
| S07 | Restored authority stays suspended | Installed service verifier: paused grants, blocked reviews, stale human/agent tokens denied |
| S08 | Source-only distributable excludes runtime secrets/data | package-release.mjs plus package manifest/checksum inspection |

S01–S08 close only when the final release/package records match current source; intermediate reports do not imply installed or external readiness.

## Private deployment candidate acceptance

| ID | Behavior | Evidence / remaining external gate |
|---|---|---|
| P01 | App JWT, exact selected-repository token scope, bounded token expiry/cache | github-app.test.ts; malformed/over-scoped/redirect/oversize/refresh failures make no repository request |
| P02 | Pinned repository/owner, protected main, exact reviewed change and partial UNKNOWN | github-app.test.ts and github-gateway.test.ts with real OPA; actual GitHub remains NOT RUN |
| P03 | Control grants cannot exceed App scope; fixture identity remains local | github-control.test.ts and actual candidate browser identity/grant flow |
| P04 | Fixed egress, no agent path to App credentials or outbound service | github-egress.test.mjs plus verify-candidate.mjs Docker DNS/IP and mounts/network assertions |
| P05 | TLS, pinned authority/origin, Secure cookies, no credential forwarding | https.test.mjs, https-proxy.test.ts, actual candidate health/bootstrap/browser TLS verification |
| P06 | Dedicated installation config, no implicit activation/overwrite | candidate-config.test.mjs; candidate verifier uses synthetic keys and internal-only outbound network |
| P07 | Minimal image profile preserves backup identity and recovery barriers | Actual maintenance orchestration: legacy/minimal success, unknown/mismatched preflight refusal; real verify-service restore |
| P08 | Image scan binds to actual exercised image ID, no stale-source readiness | image-evidence.test.mjs, readiness.test.mjs, verify-images.mjs and verify-production.mjs |

P01–P08 are local acceptance only when final source hashes/results match. External production approval requires the separate gates in PRODUCTION_READINESS.md, including live integration, clean host and a human reviewer. No offline test or agent reviewer can close them.
# Commercial validation additions (2026-11-17)

| Case | Contract and executable proof | Acceptance scope |
|---|---|---|
| CR01 | tests/enforcement/execution-outcome.test.ts: real fixture mutation/read + sensitive output, persisted outcome/disclosure, audit redaction, same-ID and approval replay | Local SQLite fixture + real OPA; independent row observation in test |
| CR02 | tests/enforcement/approval-preview.test.ts: CAS race after preview => failed/not-applied; timeout => unknown | Dispatch is not mislabeled pre-execution prevention |
| CR03 | tests/enforcement/mcp-protocol.test.ts and tests/mcp.test.ts: HTTP/stdio tool result and action_status preserve withheld execution | Real transports, no live GitHub |
| CR04 | tests/product-ui/workflows.spec.ts: actual HTTP target mutation + withheld response shows separate disclosure and no resubmit guidance | Actual Next/browser fixture; run result recorded in release evidence |
| CR05 | tests/production/ci-contract.test.mjs + source-package.test.mjs | Workflow contract and package inclusion; hosted CI NOT RUN |

Commands/results for these cases are in PLAN_COMMERCIAL_READINESS.md and SECURITY_EVIDENCE.md. New test presence alone does not mean PASS. GH01–08 live cases remain NOT RUN in GITHUB_SANDBOX_VALIDATION.md; independent Linux T29 remains open.

