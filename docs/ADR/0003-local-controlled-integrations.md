# ADR 0003 — Separate fixture databases and atomic dispatch reservation

Accepted for local Stage2, 2026-11-16. This implements the existing PRD; it does not authorize live services or replace the later product gates.

The existing SQLite native demo remains compatible. Docker uses a separate PostgreSQL control instance and target instance. A `ControlStore` contract allows asynchronous PostgreSQL without synchronous blocking wrappers. Only exclusive startup requests recovery; interrupted queued/executing actions become UNKNOWN, never automatically retried.

Async storage creates a real check/use boundary. `reserve` locks current settings, agent and action; checks original approval binding, latest scope/status/expiry/quota/taint; consumes quota, marks protected-data access and writes execution.started in one transaction. A dispatch begins only after commit. Rejection also atomically transitions pending to blocked with audit. Already committed reservations are in flight and cannot be canceled by later revocation.

The audit runtime role may append/read but cannot update/delete/truncate. Concurrent appenders serialize with a PostgreSQL transaction advisory lock to preserve the chain. This is tamper evidence under the application role, not protection against a host/bootstrap administrator.

Target reader has SELECT only and uses read-only transactions, deadlines and parameterized LIMIT. Writer has no table UPDATE; it can execute one fixed status-update function owned by a NOLOGIN nonadmin fixture role. Database/schema/role names and local endpoints are explicit. No existing database is migrated.

GitHub integration is an actual disposable local Git repository plus in-memory mock PR metadata. Known repository ID/owner/main and current refs supply trusted metadata; exact base SHA, branch namespace, file allowlist and bounded canonical diff constrain changes. No network transport, hooks, global Git config, main push, merge, force, secrets/workflows or live PAT implementation. Eventual GitHub App remains disabled.

Compose publishes no host ports. Agent and protected networks are internal; Gateway straddles them, agent has only its token file. Trusted verification receives fixture owner credentials for negative permission tests; agent never receives them. Docker fixtures are ephemeral and not a production installer.

References used to confirm PostgreSQL contracts: [read-only transactions](https://www.postgresql.org/docs/current/sql-set-transaction.html), [security-definer function precautions](https://www.postgresql.org/docs/current/sql-createfunction.html). Read-only transactions are one defense; independent role privileges enforce the target boundary.
