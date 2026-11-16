# Stage 2 PostgreSQL target fixture handoff

Scope: local disposable target only; no `.env` or `data/` was read, no Docker/system action or real-service connection was performed by this implementation task. Specification: PRD FR-07 and Master Stage 2.

The demonstrated gap was that the current fixture path used control-store SQLite state rather than a separate PostgreSQL target with database-enforced permissions. Added `PostgresFixtureAdapter({readUrl, writeUrl})`, `execute({tool, arguments, sandbox})`, and `close()` in `server/adapters/postgres-fixture.ts`. The adapter independently requires `sandbox: true`, validates strict typed arguments, permits only fixed SQL templates, uses a read-only transaction for reads, and checks actual role attributes/ownership/privileges before accessing data. Fixed schema metadata is returned without a database call; it is template documentation, not live catalog discovery.

Allowed operations:

| Tool | Input | Result |
| --- | --- | --- |
| `database_schema` | `{}` | `tables` containing only `public.agentbrake_customers`, plus `maximumRows: 100` |
| `database_read` | `{limit: 1..100}`; omitted limit defaults to 10 | `{rows: [{id,name,plan,status,version}]}` ordered by ID |
| `database_update` | positive integer `id`, `status: active\|paused` | `{id,status,version}`; nonexistent ID rejects |

Both URLs must address the same `localhost`, `127.0.0.1`, `::1`, or `target-db` endpoint, the exact database `agentbrake_target_fixture`, and respective usernames `fixture_reader` / `fixture_writer`. URL query/hash overrides and absent credentials reject. Credentials never enter error messages. The pools use a 1.5-second statement timeout, 1-second lock timeout, 2-second connection timeout, and 5-second idle transaction timeout.

Database setup:

- Mount `infra/local/target-db/010-target-fixture.sh` at `/docker-entrypoint-initdb.d/010-target-fixture.sh`.
- Mount `infra/local/target-db/001-fixture.sql` at `/opt/agentbrake-target/001-fixture.sql` (not directly in the automatically executed SQL directory).
- Mount generated `/run/secrets/target-read-password` and `/run/secrets/target-write-password`; each must contain at least 24 bytes. Bootstrap remains `POSTGRES_USER=fixture_owner`, `POSTGRES_DB=agentbrake_target_fixture`, with its existing password-file configuration.
- The SQL records migration version 1, seeds the four existing synthetic customers, revokes PUBLIC database/schema privileges, and creates non-superuser/non-owner/non-BYPASSRLS/non-CREATEDB/non-CREATEROLE login roles without memberships.
- Reader receives only SELECT on the customer table. Writer receives only EXECUTE on `public.agentbrake_update_customer(integer,text)`, with no direct table writes. The function validates status/ID and targets the primary key, bounding each call to one row. Its owner is a separate NOLOGIN/nonadmin `fixture_data_owner`; its search path is fixed and its table reference is qualified. The bootstrap owner is not a runtime credential.

Approval authorization remains the Gateway's responsibility. The adapter does not accept approval tokens. The write function is a database permission boundary, not an approval service. A holder of write credentials could call its allowed template repeatedly; isolated agent credential/network denial must be verified by the parent harness. PostgreSQL role timeout defaults are not an immutable constraint on arbitrary clients holding credentials; adapter SQL provides no timeout-changing operation. Production/remote database operation and arbitrary SQL remain unsupported.

Checks actually run:

- Fail-first run against minimal adapter scaffolding: all three local contract tests failed on absent rejection/schema behavior.
- A further malformed-tool regression failed because an array tool name passed property coercion; fixed with an explicit string check. This was one diagnosed correction, not repeated speculative patches.
- Final local command `node --import tsx --test --test-name-pattern='local adapter' tests/stage2/postgres-target.test.ts`: 3 passed, 0 failed.
- `node --import tsx --test tests/stage2/postgres-target.test.ts`: 3 passed, 3 explicitly skipped because the Docker integration opt-in was absent.
- Scoped TypeScript compile of adapter/test with NodeNext, strict, ES2022: passed.
- Byte-level check: both initialization files use LF, no CR, no BOM.

Integration command inside the Docker runtime: `POSTGRES_TARGET_TEST=1 node --import tsx --test tests/stage2/postgres-target.test.ts`, with both secret files mounted and `target-db:5432` reachable. Optional `POSTGRES_TARGET_HOST` / `POSTGRES_TARGET_PORT` select another approved local endpoint. Dedicated mode fails on missing secrets or connectivity, never silently skips. Tests inspect actual roles, test denials of write/DDL/escalation/extensions/COPY PROGRAM with read-only mode explicitly disabled during privilege probes, compare target state before/after, exercise bounded update/read, and observe server statement cancellation.

Not run by this task: Docker SQL initialization, PostgreSQL integration tests, full project suite, Gateway approvals/isolation tests. Parent owns those shared runs and Compose/configuration wiring. Status: implementation and offline validation complete; database behavior remains unverified until those runs pass.

Technical references: [PostgreSQL 18 CREATE FUNCTION](https://www.postgresql.org/docs/18/sql-createfunction.html), [GRANT](https://www.postgresql.org/docs/18/sql-grant.html), [CREATE ROLE](https://www.postgresql.org/docs/18/sql-createrole.html), [psql](https://www.postgresql.org/docs/18/app-psql.html).
