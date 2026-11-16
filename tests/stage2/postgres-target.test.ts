import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";
import { PostgresFixtureAdapter } from "../../server/adapters/postgres-fixture.js";

const database = "agentbrake_target_fixture";
const readUrl = `postgresql://fixture_reader:unit-test-only@127.0.0.1:5432/${database}`;
const writeUrl = `postgresql://fixture_writer:unit-test-only@127.0.0.1:5432/${database}`;

test("local adapter refuses remote, privileged, alternate-database and URL override configurations", () => {
  for (const unsafe of [
    readUrl.replace("127.0.0.1", "example.com"),
    readUrl.replace("127.0.0.1", "10.1.2.3"),
    readUrl.replace(database, "postgres"),
    readUrl.replace("fixture_reader", "fixture_owner"),
    readUrl.replace(":unit-test-only", ""),
    `${readUrl}?host=example.com`,
    `${readUrl}?options=-c%20role%3Dfixture_owner`,
    `${readUrl}#ignored`,
  ]) {
    assert.throws(
      () => new PostgresFixtureAdapter({ readUrl: unsafe, writeUrl }),
    );
  }
  assert.throws(
    () => new PostgresFixtureAdapter({ readUrl, writeUrl: readUrl }),
  );
  assert.throws(
    () =>
      new PostgresFixtureAdapter({
        readUrl,
        writeUrl: writeUrl.replace("5432", "5433"),
      }),
  );
});

test("local adapter rejects out-of-contract input before opening a database connection", async () => {
  const adapter = new PostgresFixtureAdapter({ readUrl, writeUrl });
  try {
    for (const action of [
      { tool: "database_read", arguments: { limit: 1 }, sandbox: false },
      { tool: "database_read", arguments: { limit: 0 }, sandbox: true },
      { tool: "database_read", arguments: { limit: 101 }, sandbox: true },
      { tool: "database_read", arguments: { limit: 1.5 }, sandbox: true },
      { tool: "database_read", arguments: { limit: "1" }, sandbox: true },
      {
        tool: "database_read",
        arguments: { limit: 1, sql: "DROP TABLE customers" },
        sandbox: true,
      },
      {
        tool: "database_update",
        arguments: { id: 0, status: "paused" },
        sandbox: true,
      },
      {
        tool: "database_update",
        arguments: { id: 1, status: "deleted" },
        sandbox: true,
      },
      {
        tool: "database_update",
        arguments: { id: "1 OR TRUE", status: "paused" },
        sandbox: true,
      },
      {
        tool: "database_update",
        arguments: { id: 1, status: "paused", where: "TRUE" },
        sandbox: true,
      },
      {
        tool: "database_schema",
        arguments: { schema: "pg_catalog" },
        sandbox: true,
      },
      { tool: "database_sql", arguments: { sql: "SELECT 1" }, sandbox: true },
      {
        tool: ["database_schema"] as unknown as string,
        arguments: {},
        sandbox: true,
      },
    ]) {
      await assert.rejects(
        adapter.execute(action),
        /invalid|unsupported|sandbox/i,
      );
    }
  } finally {
    await adapter.close();
  }
});

test("local adapter schema exposes only the approved customer template", async () => {
  const adapter = new PostgresFixtureAdapter({ readUrl, writeUrl });
  try {
    assert.deepEqual(
      await adapter.execute({
        tool: "database_schema",
        arguments: {},
        sandbox: true,
      }),
      {
        tables: [
          {
            schema: "public",
            name: "agentbrake_customers",
            columns: [
              { name: "id", type: "integer" },
              { name: "name", type: "text" },
              { name: "plan", type: "text" },
              { name: "status", type: "text", values: ["active", "paused"] },
              { name: "version", type: "integer" },
            ],
          },
        ],
        maximumRows: 100,
      },
    );
  } finally {
    await adapter.close();
  }
  await assert.rejects(
    adapter.execute({ tool: "database_schema", arguments: {}, sandbox: true }),
    /closed/i,
  );
  await adapter.close();
});

const integration = process.env.POSTGRES_TARGET_TEST === "1";
const integrationOptions = {
  skip: integration
    ? false
    : "Requires the dedicated local Docker target runner (POSTGRES_TARGET_TEST=1).",
};

async function targetConnections() {
  // A dedicated run must fail if a secret or target is unavailable, never skip.
  const host = process.env.POSTGRES_TARGET_HOST ?? "target-db";
  const port = process.env.POSTGRES_TARGET_PORT ?? "5432";
  const [readerPassword, writerPassword] = await Promise.all([
    readFile("/run/secrets/target-read-password", "utf8"),
    readFile("/run/secrets/target-write-password", "utf8"),
  ]);
  const url = (user: string, password: string) =>
    `postgresql://${user}:${encodeURIComponent(password.trim())}@${host}:${port}/${database}`;
  const options = {
    readUrl: url("fixture_reader", readerPassword),
    writeUrl: url("fixture_writer", writerPassword),
  };
  const adapter = new PostgresFixtureAdapter(options);
  const reader = new pg.Client({
    connectionString: options.readUrl,
    connectionTimeoutMillis: 3000,
  });
  const writer = new pg.Client({
    connectionString: options.writeUrl,
    connectionTimeoutMillis: 3000,
  });
  try {
    await reader.connect();
    await writer.connect();
  } catch (error) {
    await Promise.allSettled([reader.end(), writer.end(), adapter.close()]);
    throw error;
  }
  return {
    adapter,
    reader,
    writer,
    close: async () => {
      await Promise.all([reader.end(), writer.end(), adapter.close()]);
    },
  };
}

test(
  "PostgreSQL reviewed update has an atomic version condition and removes the unversioned writer entry point",
  integrationOptions,
  async () => {
    const target = await targetConnections();
    try {
      const before = (
        await target.reader.query(
          "SELECT id,status,version FROM public.agentbrake_customers WHERE id=3",
        )
      ).rows[0];
      const preview = await target.adapter.preview({
        tool: "database_update",
        arguments: { id: 3, status: "paused" },
        sandbox: true,
      });
      assert.deepEqual(preview.details.before, before);
      const write = {
        tool: "database_update",
        arguments: { id: 3, status: "paused" },
        sandbox: true,
        precondition: { version: before.version },
      };
      assert.deepEqual(await target.adapter.execute(write), {
        id: 3,
        status: "paused",
        version: before.version + 1,
      });
      await assert.rejects(
        target.adapter.execute(write),
        /target state changed/i,
      );
      assert.deepEqual(
        (
          await target.reader.query(
            "SELECT id,status,version FROM public.agentbrake_customers WHERE id=3",
          )
        ).rows,
        [{ id: 3, status: "paused", version: before.version + 1 }],
      );
      await assert.rejects(
        target.writer.query(
          "SELECT * FROM public.agentbrake_update_customer(3,'active')",
        ),
        (error) => (error as { code: string }).code === "42501",
      );
    } finally {
      await target.close();
    }
  },
);

test(
  "PostgreSQL target preserves state on denied operations and changes only the approved fixture row",
  integrationOptions,
  async () => {
    const target = await targetConnections();
    try {
      const before = (
        await target.reader.query(
          "SELECT id,name,plan,status,version FROM public.agentbrake_customers ORDER BY id",
        )
      ).rows;
      assert.equal(before.length, 4);
      assert.deepEqual(
        before.map(({ id, name, plan }) => ({ id, name, plan })),
        [
          { id: 1, name: "Acme Studio", plan: "Enterprise" },
          { id: 2, name: "Orbit Labs", plan: "Growth" },
          { id: 3, name: "Northstar", plan: "Enterprise" },
          { id: 4, name: "Forma Design", plan: "Starter" },
        ],
      );
      assert.deepEqual(
        await target.adapter.execute({
          tool: "database_read",
          arguments: { limit: 2 },
          sandbox: true,
        }),
        { rows: before.slice(0, 2) },
      );
      await assert.rejects(
        target.adapter.execute({
          tool: "database_update",
          arguments: { id: 1, status: "paused" },
          sandbox: false,
        }),
      );
      await assert.rejects(
        target.adapter.execute({
          tool: "database_read",
          arguments: { limit: 101 },
          sandbox: true,
        }),
      );
      await assert.rejects(
        target.adapter.execute({
          tool: "database_update",
          arguments: { id: 999999, status: "paused" },
          sandbox: true,
        }),
        /not found/i,
      );
      const unchanged = (
        await target.reader.query(
          "SELECT id,name,plan,status,version FROM public.agentbrake_customers ORDER BY id",
        )
      ).rows;
      assert.deepEqual(unchanged, before);
      const status = before[1].status === "active" ? "paused" : "active";
      assert.deepEqual(
        await target.adapter.execute({
          tool: "database_update",
          arguments: { id: 2, status },
          sandbox: true,
        }),
        { id: 2, status, version: before[1].version + 1 },
      );
      const after = (
        await target.reader.query(
          "SELECT id,name,plan,status,version FROM public.agentbrake_customers ORDER BY id",
        )
      ).rows;
      assert.deepEqual(after, [
        before[0],
        { ...before[1], status, version: before[1].version + 1 },
        before[2],
        before[3],
      ]);
    } finally {
      await target.close();
    }
  },
);

test(
  "PostgreSQL target roles deny broad writes, DDL, privilege escalation and program execution",
  integrationOptions,
  async () => {
    const target = await targetConnections();
    try {
      const before = (
        await target.reader.query(
          "SELECT * FROM public.agentbrake_customers ORDER BY id",
        )
      ).rows;
      for (const [client, username] of [
        [target.reader, "fixture_reader"],
        [target.writer, "fixture_writer"],
      ] as const) {
        const identity = (
          await client.query(`SELECT current_user AS name, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolbypassrls, r.rolreplication,
        EXISTS(SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = r.oid) AS owns_database,
        EXISTS(SELECT 1 FROM pg_class WHERE oid = 'public.agentbrake_customers'::regclass AND relowner = r.oid) AS owns_table,
        EXISTS(SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS has_memberships
        FROM pg_roles r WHERE rolname = current_user`)
        ).rows[0];
        assert.deepEqual(identity, {
          name: username,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolbypassrls: false,
          rolreplication: false,
          owns_database: false,
          owns_table: false,
          has_memberships: false,
        });
        for (const sql of [
          "UPDATE public.agentbrake_customers SET status='paused'",
          "DELETE FROM public.agentbrake_customers",
          "TRUNCATE public.agentbrake_customers",
          "DROP TABLE public.agentbrake_customers",
          "CREATE TABLE public.must_not_exist(id integer)",
          "CREATE TEMP TABLE must_not_exist(id integer)",
          "CREATE EXTENSION hstore",
          `ALTER ROLE ${username} SUPERUSER`,
          `GRANT fixture_owner TO ${username}`,
          "SET ROLE fixture_data_owner",
          "COPY (SELECT 1) TO PROGRAM 'true'",
        ]) {
          // Turn off the reader default for this probe so grants, not only read-only mode, are exercised.
          await client.query("BEGIN READ WRITE");
          try {
            await assert.rejects(
              client.query(sql),
              (error: unknown) => (error as { code?: string }).code === "42501",
            );
          } finally {
            await client.query("ROLLBACK");
          }
        }
      }
      await assert.rejects(
        target.reader.query(
          "SELECT * FROM public.agentbrake_update_customer_checked(1,'paused',0)",
        ),
        (error: unknown) => (error as { code?: string }).code === "42501",
      );
      await assert.rejects(
        target.writer.query(
          "SELECT * FROM public.agentbrake_update_customer_checked(1,'deleted',0)",
        ),
        (error: unknown) => (error as { code?: string }).code === "22023",
      );
      assert.deepEqual(
        (
          await target.reader.query(
            "SELECT * FROM public.agentbrake_customers ORDER BY id",
          )
        ).rows,
        before,
      );
    } finally {
      await target.close();
    }
  },
);

test(
  "PostgreSQL target default read-only mode and statement timeout are active on the server",
  integrationOptions,
  async () => {
    const target = await targetConnections();
    try {
      assert.equal(
        (await target.reader.query("SHOW transaction_read_only")).rows[0]
          .transaction_read_only,
        "on",
      );
      for (const client of [target.reader, target.writer]) {
        const started = Date.now();
        await assert.rejects(
          client.query("SELECT pg_sleep(4)"),
          (error: unknown) => (error as { code?: string }).code === "57014",
        );
        assert.ok(
          Date.now() - started < 3500,
          "The server should cancel the four-second query before completion",
        );
      }
    } finally {
      await target.close();
    }
  },
);
