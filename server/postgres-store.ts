import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg, { type PoolClient } from "pg";
import { activityWhere } from "./storage-query.js";
import type { IdentityState, IdentityChange } from "./security/accounts-state.js";
import type { ActivityQuery, AuditQuery } from "./control-store.js";
import {
  HttpError,
  type ActionRecord,
  type Agent,
  type Policies,
} from "./contracts.js";
import type {
  AgentInput,
  AuditContext,
  ControlStore,
  ReservationCheck,
  Settings,
} from "./control-store.js";
import { auditDetails } from "./control-store.js";
import {
  AUDIENCE,
  POLICY_VERSION,
  type TaskGrant,
} from "./policy/contracts.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
// Every audit writer uses the same transaction-scoped lock, across processes.
const AUDIT_LOCK = 1478629041;
type Queryable = Pick<pg.Pool, "query"> | Pick<PoolClient, "query">;
type AuditRow = {
  seq: number;
  data: string;
  previous_hash: string;
  hash: string;
};

function connection(url: string): pg.PoolConfig {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("A PostgreSQL isolated control fixture URL is required");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]", "control-db"].includes(
      parsed.hostname,
    ) ||
    parsed.pathname !== "/agentbrake_control_fixture" ||
    parsed.username !== "control_runtime" ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(
      "Only the isolated control fixture and control_runtime role are permitted",
    );
  // Explicit fields prevent connection-string query options from overriding the boundary.
  return {
    host: parsed.hostname === "[::1]" ? "::1" : parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database: "agentbrake_control_fixture",
    user: "control_runtime",
    password: decodeURIComponent(parsed.password),
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15_000,
    application_name: "agentbrake-control-fixture",
  };
}

export class PostgresStore implements ControlStore {
  private constructor(private pool: pg.Pool) {}

  async identityState(): Promise<IdentityState> {
    const {rows} = await this.pool.query("SELECT data FROM identity_state WHERE id=1");
    if (!rows[0]) throw Error("Identity state is unavailable; apply the owner-run accounts migration");
    return JSON.parse(rows[0].data);
  }
  async changeIdentity<T>(change: IdentityChange<T>): Promise<T> {
    return this.transaction(async client => {
      const {rows} = await client.query("SELECT data FROM identity_state WHERE id=1 FOR UPDATE");
      if (!rows[0]) throw Error("Identity state is unavailable; apply the owner-run accounts migration");
      const state: IdentityState = JSON.parse(rows[0].data);
      const {result, audit} = change(state);
      await client.query("UPDATE identity_state SET data=$1 WHERE id=1", [JSON.stringify(state)]);
      await this.appendAudit(client, audit.type, audit.details);
      return result;
    });
  }

  static async open(
    url: string,
    options: { reconcile?: boolean } = {},
  ): Promise<PostgresStore> {
    const store = new PostgresStore(new pg.Pool(connection(url)));
    try {
      const { rows } = await store.pool.query(`SELECT current_user AS name,
        r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
        pg_has_role(current_user, 'control_owner', 'MEMBER') AS owner_member,
        has_database_privilege(current_user, current_database(), 'CREATE') AS db_create,
        has_database_privilege(current_user, current_database(), 'TEMP') AS db_temp,
        has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
        has_table_privilege(current_user, 'audit', 'UPDATE,DELETE,TRUNCATE') AS audit_mutate
        FROM pg_roles r WHERE r.rolname=current_user`);
      const role = rows[0];
      if (
        !role ||
        role.name !== "control_runtime" ||
        [
          role.rolsuper,
          role.rolbypassrls,
          role.rolcreaterole,
          role.rolcreatedb,
          role.owner_member,
          role.db_create,
          role.db_temp,
          role.schema_create,
          role.audit_mutate,
        ].some(Boolean)
      )
        throw new Error(
          "The isolated control fixture runtime role has unsafe privileges",
        );
      if (!(await store.verifyAudit()))
        throw new Error("Control audit chain verification failed");
      // The caller must select this only once at exclusive process startup.
      if (options.reconcile) await store.reconcile();
      return store;
    } catch (error) {
      await store.close();
      throw error;
    }
  }

  private async transaction<T>(
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const result = await run(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  private async readSettings(db: Queryable, lock = false): Promise<Settings> {
    const { rows } = await db.query(
      "SELECT paused, policies, revision FROM settings WHERE id=1" +
        (lock ? " FOR UPDATE" : ""),
    );
    if (!rows[0]) throw new Error("Control fixture settings are missing");
    return {
      paused: rows[0].paused,
      policies: JSON.parse(rows[0].policies),
      revision: Number(rows[0].revision),
    };
  }

  settings(): Promise<Settings> {
    return this.readSettings(this.pool);
  }

  async setPaused(paused: boolean, context?: AuditContext): Promise<void> {
    await this.transaction(async (client) => {
      await this.readSettings(client, true);
      await client.query("UPDATE settings SET paused=$1 WHERE id=1", [paused]);
      await this.appendAudit(client, "control.changed", {
        paused,
        ...auditDetails(context),
      });
    });
  }

  async setPolicies(policies: Policies, context?: AuditContext): Promise<void> {
    await this.transaction(async (client) => {
      await this.readSettings(client, true);
      const serialized = JSON.stringify(policies);
      const { rows } = await client.query(
        "INSERT INTO policy_revisions(policies) VALUES ($1) RETURNING version",
        [serialized],
      );
      await client.query(
        "UPDATE settings SET policies=$1, revision=$2 WHERE id=1",
        [serialized, rows[0].version],
      );
      await this.appendAudit(client, "policy.changed", {
        ...policies,
        ...auditDetails(context),
      });
    });
  }

  async agents(): Promise<Agent[]> {
    const { rows } = await this.pool.query(
      "SELECT data FROM agents ORDER BY created_order",
    );
    return rows.map((row) => JSON.parse(row.data));
  }
  async policyHistory(limit = 100) {
    const { rows } = await this.pool.query(
      "SELECT version,policies FROM policy_revisions ORDER BY version DESC LIMIT $1",
      [limit],
    );
    return rows.map((r) => ({
      version: Number(r.version),
      policies: JSON.parse(r.policies),
    }));
  }
  async pruneResults(before: string) {
    const result = await this.pool.query(
      "UPDATE actions SET data=((data::jsonb-'result')||jsonb_build_object('resultPurgedAt',$2::text))::text WHERE status IN ('allowed','blocked','failed','unknown') AND data::jsonb->>'createdAt'<$1 AND data::jsonb ? 'result'",
      [before, new Date().toISOString()],
    );
    return result.rowCount ?? 0;
  }
  async actionsPage(query: ActivityQuery) {
    const { where, values } = activityWhere(query, "postgres");
    const [page, count] = await Promise.all([
      this.pool.query(
        "SELECT data FROM actions" +
          where +
          ` ORDER BY created_order DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.limit, query.offset],
      ),
      this.pool.query("SELECT COUNT(*) AS total FROM actions" + where, values),
    ]);
    return {
      items: page.rows.map((r) => JSON.parse(r.data) as ActionRecord),
      total: Number(count.rows[0].total),
      offset: query.offset,
      limit: query.limit,
    };
  }

  async agent(id: string): Promise<Agent | undefined> {
    const { rows } = await this.pool.query(
      "SELECT data FROM agents WHERE id=$1",
      [id],
    );
    return rows[0] ? JSON.parse(rows[0].data) : undefined;
  }

  async authenticate(token: string): Promise<Agent | undefined> {
    const { rows } = await this.pool.query(
      "SELECT data FROM agents WHERE token_hash=$1",
      [hash(token)],
    );
    const agent: Agent | undefined = rows[0]
      ? JSON.parse(rows[0].data)
      : undefined;
    return agent?.tokenAudience === AUDIENCE &&
      (agent.tokenExpiresAt ?? 0) > Date.now()
      ? agent
      : undefined;
  }

  async createAgent(
    input: AgentInput,
    context?: AuditContext,
  ): Promise<{ agent: Agent; token: string }> {
    const token = "ab_" + randomBytes(32).toString("hex");
    const agent: Agent = {
      ...input,
      id: randomUUID(),
      status: "active",
      tainted: false,
      createdAt: new Date().toISOString(),
      tokenAudience: AUDIENCE,
      tokenExpiresAt: Date.now() + 3600_000,
    };
    agent.grant = {
      id: randomUUID(),
      agent_id: agent.id,
      tenant: "local",
      human_owner: input.ownerId ?? "local-administrator",
      actions: input.tools,
      resources: input.resources,
      environments: ["sandbox"],
      expires_at_ms: agent.tokenExpiresAt!,
      revoked: false,
      policy_version: POLICY_VERSION,
      max_calls: 1000,
      used_calls: 0,
      max_rows: 100,
    };
    await this.transaction(async (client) => {
      await client.query(
        "INSERT INTO agents(id,token_hash,data) VALUES ($1,$2,$3)",
        [agent.id, hash(token), JSON.stringify(agent)],
      );
      await this.appendAudit(client, "agent.created", {
        agentId: agent.id,
        name: agent.name,
        ...auditDetails(
          context ??
            (input.ownerId
              ? { actorId: input.ownerId, tenant: "local" }
              : undefined),
        ),
      });
    });
    return { agent, token };
  }

  async saveAgent(agent: Agent): Promise<void> {
    await this.pool.query("UPDATE agents SET data=$1 WHERE id=$2", [
      JSON.stringify(agent),
      agent.id,
    ]);
  }

  async changeAgent(
    id: string,
    patch: { status?: Agent["status"]; grant?: TaskGrant },
    event: string,
    context?: AuditContext,
  ): Promise<Agent | undefined> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        "SELECT data FROM agents WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!rows[0]) return undefined;
      const current: Agent = JSON.parse(rows[0].data);
      if (patch.status !== undefined) current.status = patch.status;
      if (patch.grant !== undefined) {
        current.grant = {
          ...patch.grant,
          used_calls:
            current.grant?.id === patch.grant.id
              ? Math.max(current.grant.used_calls, patch.grant.used_calls)
              : patch.grant.used_calls,
        };
      }
      await client.query("UPDATE agents SET data=$1 WHERE id=$2", [
        JSON.stringify(current),
        id,
      ]);
      await this.appendAudit(client, event, {
        agentId: id,
        status: current.status,
        grantId: current.grant?.id,
        ...auditDetails(context),
      });
      return current;
    });
  }

  async actions(): Promise<ActionRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT data FROM actions ORDER BY created_order DESC",
    );
    return rows.map((row) => JSON.parse(row.data));
  }

  async action(id: string): Promise<ActionRecord | undefined> {
    const { rows } = await this.pool.query(
      "SELECT data FROM actions WHERE id=$1",
      [id],
    );
    return rows[0] ? JSON.parse(rows[0].data) : undefined;
  }

  async previous(
    agentId: string,
    requestId: string,
  ): Promise<ActionRecord | undefined> {
    const { rows } = await this.pool.query(
      "SELECT data FROM actions WHERE agent_id=$1 AND request_id=$2",
      [agentId, requestId],
    );
    return rows[0] ? JSON.parse(rows[0].data) : undefined;
  }

  async insertAction(action: ActionRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO actions(id,agent_id,request_id,status,data) VALUES ($1,$2,$3,$4,$5)",
      [
        action.id,
        action.agentId,
        action.requestId,
        action.status,
        JSON.stringify(action),
      ],
    );
  }

  private async writeAction(
    db: Queryable,
    action: ActionRecord,
  ): Promise<void> {
    await db.query("UPDATE actions SET status=$1,data=$2 WHERE id=$3", [
      action.status,
      JSON.stringify(action),
      action.id,
    ]);
  }

  async saveAction(action: ActionRecord): Promise<void> {
    await this.writeAction(this.pool, action);
  }

  async reserve(
    action: ActionRecord,
    check: ReservationCheck,
  ): Promise<boolean> {
    const result = await this.transaction(async (client) => {
      // All reservation paths use this order. The synchronous caller check runs
      // with the latest authority and persisted envelope while rows stay locked.
      const settings = await this.readSettings(client, true);
      const agents = await client.query(
        "SELECT data FROM agents WHERE id=$1 FOR UPDATE",
        [action.agentId],
      );
      const actions = await client.query(
        "SELECT status,data FROM actions WHERE id=$1 FOR UPDATE",
        [action.id],
      );
      if (!agents.rows[0] || !actions.rows[0])
        throw new HttpError(409, "Action or identity no longer exists");
      const current: Agent = JSON.parse(agents.rows[0].data);
      const persisted: ActionRecord = JSON.parse(actions.rows[0].data);
      if (
        !["pending", "queued"].includes(action.status) ||
        actions.rows[0].status !== action.status ||
        persisted.status !== action.status ||
        persisted.agentId !== current.id ||
        persisted.requestId !== action.requestId
      )
        throw new HttpError(
          409,
          "Execution has already been claimed or its identity changed",
        );
      const denied = check(current, settings, persisted);
      // Start from the persisted envelope; only a newly issued decision ID is
      // carried from the caller after an approval re-evaluation.
      const next: ActionRecord = {
        ...persisted,
        policyDecisionId: action.policyDecisionId,
        approvalReceipt: action.approvalReceipt,
      };
      if (denied) {
        next.status = "blocked";
        next.rule = denied.rule;
        next.reason = denied.reason;
        await this.writeAction(client, next);
        await this.appendAudit(client, "execution.blocked", {
          actionId: next.id,
          rule: next.rule,
        });
        return { allowed: false, next };
      }
      if (!current.grant)
        throw new Error("Reservation requires a current task grant");
      next.status = "executing";
      current.grant.used_calls++;
      if (next.tool === "database_read") current.tainted = true;
      await this.writeAction(client, next);
      await client.query("UPDATE agents SET data=$1 WHERE id=$2", [
        JSON.stringify(current),
        current.id,
      ]);
      await this.appendAudit(client, "execution.started", {
        actionId: next.id,
        approverId: next.approvalReceipt?.actorId,
      });
      return { allowed: true, next };
    });
    // An audit or commit failure must not leave the caller with apparent success.
    Object.assign(action, result.next);
    return result.allowed;
  }

  async blockPending(action: ActionRecord): Promise<void> {
    const next = await this.transaction(async (client) => {
      const { rows } = await client.query(
        "SELECT data,status FROM actions WHERE id=$1 FOR UPDATE",
        [action.id],
      );
      if (!rows[0] || rows[0].status !== "pending")
        throw new HttpError(409, "This action is no longer awaiting approval");
      const persisted: ActionRecord = JSON.parse(rows[0].data);
      const blocked: ActionRecord = {
        ...persisted,
        status: "blocked",
        rule: action.rule,
        reason: action.reason,
        approvalReceipt: action.approvalReceipt,
      };
      await this.writeAction(client, blocked);
      await this.appendAudit(client, "approval.blocked", {
        actionId: action.id,
        rule: action.rule,
        ...auditDetails(blocked.approvalReceipt),
      });
      return blocked;
    });
    Object.assign(action, next);
  }
  private async appendAudit(
    client: PoolClient,
    type: string,
    details: unknown,
  ): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock($1)", [AUDIT_LOCK]);
    const { rows } = await client.query(
      "SELECT hash FROM audit ORDER BY seq DESC LIMIT 1",
    );
    const previous = rows[0]?.hash ?? "genesis";
    const data = JSON.stringify({
      type,
      details,
      at: new Date().toISOString(),
    });
    await client.query(
      "INSERT INTO audit(data,previous_hash,hash) VALUES ($1,$2,$3)",
      [data, previous, hash(previous + data)],
    );
  }

  async audit(type: string, details: unknown): Promise<void> {
    await this.transaction((client) => this.appendAudit(client, type, details));
  }

  async auditTrail(query?: AuditQuery): Promise<AuditRow[]> {
    const values: (string | number)[] = query?.actionId ? [query.actionId] : [];
    const where = query?.actionId
      ? " WHERE data::jsonb->'details'->>'actionId'=$1"
      : "";
    const bounds = query
      ? ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`
      : "";
    if (query) values.push(query.limit, query.offset ?? 0);
    const { rows } = await this.pool.query(
      "SELECT seq,data,previous_hash,hash FROM audit" +
        where +
        " ORDER BY seq" +
        bounds,
      values,
    );
    return rows.map((row) => ({ ...row, seq: Number(row.seq) }));
  }

  async verifyAudit(): Promise<boolean> {
    let previous = "genesis";
    for (const row of await this.auditTrail()) {
      if (
        row.previous_hash !== previous ||
        row.hash !== hash(previous + row.data)
      )
        return false;
      previous = row.hash;
    }
    return true;
  }

  private async reconcile(): Promise<void> {
    await this.transaction(async (client) => {
      await this.readSettings(client, true);
      const { rows } = await client.query(
        "SELECT data FROM actions WHERE status IN ('queued','executing') ORDER BY created_order FOR UPDATE",
      );
      for (const row of rows) {
        const action: ActionRecord = JSON.parse(row.data);
        action.status = "unknown";
        action.reason =
          "Server restarted during execution. Reconcile the destination before retrying with a new request ID.";
        await this.writeAction(client, action);
        await this.appendAudit(client, "execution.unknown", {
          actionId: action.id,
        });
      }
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
