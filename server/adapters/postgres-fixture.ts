import pg from "pg";
import { z } from "zod";
import { TargetChangedError, type ActionPreview } from "../contracts.js";
import { databasePreview, expectedVersion } from "./preview.js";

type ExecutionAction = {
  tool: string;
  arguments: Record<string, unknown>;
  sandbox: boolean;
  precondition?: { version: number };
};

const schemas = {
  database_read: z
    .object({ limit: z.number().int().min(1).max(100).default(10) })
    .strict(),
  database_update: z
    .object({
      id: z.number().int().positive(),
      status: z.enum(["active", "paused"]),
    })
    .strict(),
  database_schema: z.object({}).strict(),
};

function connection(url: string, username: string): pg.PoolConfig {
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (
      !["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !["127.0.0.1", "localhost", "[::1]", "target-db"].includes(
        parsed.hostname,
      ) ||
      parsed.pathname !== "/agentbrake_target_fixture" ||
      decodeURIComponent(parsed.username) !== username ||
      !parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.port === "0"
    )
      throw new Error();
    return {
      host: parsed.hostname === "[::1]" ? "::1" : parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 5432,
      database: "agentbrake_target_fixture",
      user: username,
      password: decodeURIComponent(parsed.password),
      ssl: false,
      max: 2,
      connectionTimeoutMillis: 2000,
      statement_timeout: 1500,
      lock_timeout: 1000,
      idle_in_transaction_session_timeout: 5000,
    };
  } catch {
    // Never expose a connection string (including credentials) in an error.
    throw new Error("Invalid local PostgreSQL fixture configuration");
  }
}

const roleSafety = `SELECT
  current_user = $1 AND current_database() = 'agentbrake_target_fixture'
  AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication)
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = r.oid)
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datdba = r.oid)
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE relowner = r.oid)
  AND NOT pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE,TEMP')
  AND NOT pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
  AND NOT pg_catalog.has_table_privilege(current_user, 'public.agentbrake_customers', 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
  AS safe FROM pg_catalog.pg_roles r WHERE rolname = current_user`;

export class PostgresFixtureAdapter {
  private reader: pg.Pool;
  private writer: pg.Pool;
  private closed = false;

  constructor(options: { readUrl: string; writeUrl: string }) {
    const read = connection(options.readUrl, "fixture_reader");
    const write = connection(options.writeUrl, "fixture_writer");
    if (read.host !== write.host || read.port !== write.port)
      throw new Error("Invalid local PostgreSQL fixture configuration");
    this.reader = new pg.Pool(read);
    this.writer = new pg.Pool(write);
    // Idle connection errors must not crash the gateway or log credentials.
    this.reader.on("error", () => {});
    this.writer.on("error", () => {});
  }

  async execute(action: ExecutionAction): Promise<unknown> {
    if (this.closed) throw new Error("PostgreSQL fixture adapter is closed");
    if (!action || action.sandbox !== true)
      throw new Error("PostgreSQL fixture requires sandbox execution");
    if (typeof action.tool !== "string" || !Object.hasOwn(schemas, action.tool))
      throw new Error("Unsupported PostgreSQL fixture tool");
    const parsed = schemas[action.tool as keyof typeof schemas].safeParse(
      action.arguments,
    );
    if (!parsed.success)
      throw new Error("Invalid PostgreSQL fixture arguments");
    if (action.tool === "database_schema") {
      // Fixed template metadata: no general catalog browsing or user-controlled SQL.
      return {
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
      };
    }
    const read = action.tool === "database_read";
    const expected = read
      ? undefined
      : (action.precondition?.version ??
        expectedVersion(await this.preview(action)));
    if (
      !read &&
      (typeof expected !== "number" ||
        !Number.isSafeInteger(expected) ||
        expected < 0)
    )
      throw Error("Invalid target precondition");
    const pool = read ? this.reader : this.writer;
    let client: pg.PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query(read ? "BEGIN READ ONLY" : "BEGIN READ WRITE");
      const safety = await client.query(roleSafety, [
        read ? "fixture_reader" : "fixture_writer",
      ]);
      if (safety.rows.length !== 1 || safety.rows[0].safe !== true)
        throw new Error("Unsafe PostgreSQL fixture role");
      let output: unknown;
      if (read) {
        const { limit } = parsed.data as { limit: number };
        const result = await client.query(
          "SELECT id,name,plan,status,version FROM public.agentbrake_customers ORDER BY id LIMIT $1",
          [limit],
        );
        output = { rows: result.rows };
      } else {
        const { id, status } = parsed.data as {
          id: number;
          status: "active" | "paused";
        };
        const result = await client.query(
          "SELECT id,status,version FROM public.agentbrake_update_customer_checked($1::integer,$2::text,$3::integer)",
          [id, status, expected],
        );
        if (result.rows.length === 0) throw new TargetChangedError();
        if (result.rows.length !== 1)
          throw new Error("Unexpected PostgreSQL fixture row count");
        output = result.rows[0];
      }
      await client.query("COMMIT");
      return output;
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      if (error instanceof TargetChangedError) throw error;
      if (
        error instanceof Error &&
        ["Record not found", "Unsafe PostgreSQL fixture role"].includes(
          error.message,
        )
      )
        throw error;
      throw new Error("PostgreSQL fixture execution failed");
    } finally {
      client?.release();
    }
  }

  async preview(action: ExecutionAction): Promise<ActionPreview> {
    if (action.sandbox !== true || !Object.hasOwn(schemas, action.tool))
      throw Error("Unsupported database preview");
    if (action.tool !== "database_update")
      return {
        kind: "operation",
        summary: "Exact bounded database read template",
        details: {
          tool: action.tool,
          arguments: schemas[action.tool as keyof typeof schemas].parse(
            action.arguments,
          ),
        },
      };
    const args = schemas.database_update.parse(action.arguments);
    const result = (await this.execute({
      tool: "database_read",
      arguments: { limit: 100 },
      sandbox: true,
    })) as { rows: { id: number; status: string; version: number }[] };
    const row = result.rows.find((row) => row.id === args.id);
    if (!row) throw Error("Record not found");
    return databasePreview(row, args.status);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await Promise.all([this.reader.end(), this.writer.end()]);
  }
}
