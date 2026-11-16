# Persistent local product operations

For managed account setup, Team, recovery and encrypted backup/restore commands, use [Service operations](SERVICE_OPERATIONS.md). This document records the enforcement and container boundary.

`init NAME PORT` creates a new `.agentbrake-local/product-NAME` and refuses overwriting it. `start NAME` prepares exact OPA policy hash metadata and starts only the named Compose project; `stop NAME` removes its containers/networks while preserving named volumes. No global Docker prune, user .env, old data or global client config is used.

Both product and isolation launchers disable Compose's implicit `.env` discovery and discard inherited `COMPOSE_ENV_FILES`, `COMPOSE_FILE`, `COMPOSE_PROFILES` and discovery overrides. Set the supported retention/log options directly in the launching process environment; these explicit inputs are preserved. The generated installation selects its own project and Compose file.

## Roles and credentials

`operators.json` contains generated bootstrap/legacy keys. In managed installations use the administrator key once in Set up workspace; afterward every key login is disabled. Invite separate operator/approver/viewer accounts through Team. Viewer is read-only. Login sessions last8hours and are invalidated when Control API restarts; CSRF stays in browser memory. Tokens/grants last at most1hour. Revoke a task before replacing its identity; replay/status access is rechecked against current authority.

Successful policy, stop/resume, task creation/pause/resume and grant issue/revoke events record the authenticated actor ID, tenant and server-generated request correlation. Revocation records the actual revoker, even when another operator owns the task. JSON/CSV exports retain that attribution without session/key/CSRF values. Direct internal fixture mutations are explicitly marked internal; they do not stand for a human action.

On Windows protect the generated directory using your account's filesystem access controls; POSIX creation uses0700directory/0600files. Do not copy these files into evidence, screenshots or source control. Managed users change passwords through Settings; an administrator issues a short-lived recovery link through Team. These changes invalidate old sessions. Generated-key rotation only applies to legacy compatibility installations before managed setup; it cannot bypass managed login. Keep identity IDs stable for historical ownership. To rotate DB/target/binding keys, create a new disposable installation; editing only password files does not rotate an existing PostgreSQL role.

## Agent access

Inside the isolated agent container: MCP HTTP is `http://gateway:4313/mcp` with a scoped bearer. The dashboard/control listener is not an agent endpoint. The generated `mcp-client.example.json` and Connections template use `bearer_token_env_var: AGENTBRAKE_TOKEN`; do not insert human keys.

`infra/product/agent-probe.mjs` reads a verification JSON envelope from stdin and sends it to the fixed Gateway. `scripts/verify-product.mjs` demonstrates passing a freshly issued bearer over stdin via `docker compose exec -T agent`, never in Docker argv or logs. The product does not configure or start arbitrary host agents. The separate `verify:milestone-b` profile runs actual Codex with local inference and a clean home.

## Data, migrations and recovery

Separate named volumes hold control PostgreSQL, target PostgreSQL and the marked Git fixture. SQL001 bootstraps fresh dedicated databases; SQL002 adds the version-checked target function and revokes the old writer entry point. Startup validates the runtime roles. No existing customer DB is migrated. The separate control SQL002 adds managed accounts; start applies it under an owner transaction/advisory lock and records its checksum, rejecting a changed applied migration. Do not replay bootstrap SQL against existing data.

Git state and mock PR metadata share an atomic ref transaction. Reopening requires the installation marker; arbitrary user repositories are rejected. Pending approval/proof persists across restart; queued/executing records recover as UNKNOWN only at exclusive Gateway startup. Run exactly one Gateway instance per installation. Control API does not reconcile executions.

For UNKNOWN: pause/revoke the task; inspect target state and audit/evidence with the trusted operator; record the reconciliation externally. Do not retry automatically or change request ID merely to bypass idempotency. No reconciliation button claims to undo a side effect.

`RESULT_RETENTION_HOURS` before start sets terminal-result retention (default24, range1..8760). Pruning at startup/hourly removes only result payloads and records `resultPurgedAt`; replay tombstones/audit/reviews remain. Metadata is retained until explicit reset; no implicit audit truncation. Workspace is latest500, activity page max100, JSON/CSV export max10000. Monitor disk use; export before deliberate reset if evidence must be kept. Encrypted cold backup/new-destination restore is available via the service operations guide and its release acceptance gate. No HA.

Application Docker log rotation: `LOG_MAX_SIZE` (default10m), `LOG_MAX_FILES` (default3). OpenTelemetry uses an explicit local SDK and OTLP JSON output with fixed route, method, status and correlation ID only; no remote collector, URL/query/body/header/error capture or environment resource detection. It is operational telemetry, not the audit source of truth.

## Network layout

Browser on127.0.0.1 → fixed TCP ingress → Next.js → Control API → private authenticated bridge → Gateway/PEP → OPA and fixture adapters. Control API and Gateway share control PostgreSQL. Only adapters reach target PostgreSQL/Git. Isolated agents reach only the public MCP/action Gateway surface.

Only ingress is on a regular network, required by Docker29 localhost port publication; all application/agent/target networks are internal. Only ingress3000 is mapped to a127.0.0.1host port. It has a fixed destination and no credentials. Gateway's private bridge binds only its control-network IP; agent-interface access is tested by name and IP. No dashboard/agent target or OPA secrets; no Docker socket mount. Host/Docker administrator remains outside the boundary.

## Verification and external handoff

`verify:release` requires native/Next/browser, isolated PG/Git/Codex/benchmark, a fresh persistent installation/restart, managed account cold backup/restore, security scans, cleanup and matching source hashes. It does not supply an independent clean physical machine or external human sign-off. Share the source manifest, `local-release.json`, referenced run directories, SBOMs, test matrix and known limitations with the external reviewer. Do not send generated credential directories. See `PLAN_PRODUCT_COMPLETION.md` for failed attempts and demonstrated corrections.
