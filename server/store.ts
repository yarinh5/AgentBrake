import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
} from "./control-store.js";
import { auditDetails } from "./control-store.js";
import type { TaskGrant } from "./policy/contracts.js";
import { AUDIENCE, POLICY_VERSION } from "./policy/contracts.js";
import { activityWhere } from "./storage-query.js";
import type { ActivityQuery, AuditQuery } from "./control-store.js";
import type { IdentityState, IdentityChange } from "./security/accounts-state.js";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonical((value as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}
export class Store implements ControlStore {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL, policies TEXT NOT NULL);
      INSERT OR IGNORE INTO settings VALUES (1,0,'{"reads":"allow","databaseWrites":"approval","githubWrites":"approval"}');
      CREATE TABLE IF NOT EXISTS policy_revisions (version INTEGER PRIMARY KEY AUTOINCREMENT, policies TEXT NOT NULL);
      INSERT INTO policy_revisions(policies) SELECT policies FROM settings WHERE NOT EXISTS (SELECT 1 FROM policy_revisions);
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, request_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(agent_id,request_id));
      CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS identity_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
      INSERT OR IGNORE INTO identity_state VALUES (1,'{"initialized":false,"accounts":[],"invitations":[],"recoveries":[]}');
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'audit is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'audit is append-only'); END;
      CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0);
      INSERT OR IGNORE INTO customers VALUES (1,'Acme Studio','Enterprise','active',0),(2,'Orbit Labs','Growth','active',0),(3,'Northstar','Enterprise','active',0),(4,'Forma Design','Starter','active',0);
      CREATE TABLE IF NOT EXISTS sandbox_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL);
    `);
    for (const action of this.actions().filter(
      (a) => a.status === "executing" || a.status === "queued",
    )) {
      action.status = "unknown";
      action.reason =
        "Server restarted during execution. Reconcile the destination before retrying with a new request ID.";
      this.saveAction(action);
      this.audit("execution.unknown", { actionId: action.id });
    }
  }
  identityState(): IdentityState {
    const row = this.db.prepare("SELECT data FROM identity_state WHERE id=1").get();
    if (!row) throw Error("Identity state is unavailable");
    return JSON.parse(row.data as string);
  }
  changeIdentity<T>(change: IdentityChange<T>): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.identityState();
      const {result, audit} = change(state);
      this.db.prepare("UPDATE identity_state SET data=? WHERE id=1").run(JSON.stringify(state));
      this.audit(audit.type, audit.details);
      this.db.exec("COMMIT");
      return result;
    } catch(error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  settings(): { paused: boolean; policies: Policies; revision: number } {
    const row = this.db.prepare("SELECT * FROM settings WHERE id=1").get()!;
    return {
      paused: Boolean(row.paused),
      policies: JSON.parse(row.policies as string),
      revision: Number(
        this.db
          .prepare("SELECT MAX(version) AS version FROM policy_revisions")
          .get()!.version,
      ),
    };
  }
  setPaused(paused: boolean, context?: AuditContext) {
    this.db
      .prepare("UPDATE settings SET paused=? WHERE id=1")
      .run(Number(paused));
    this.audit("control.changed", { paused, ...auditDetails(context) });
  }
  setPolicies(policies: Policies, context?: AuditContext) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("UPDATE settings SET policies=? WHERE id=1")
        .run(JSON.stringify(policies));
      this.audit("policy.changed", { ...policies, ...auditDetails(context) });
      this.db
        .prepare("INSERT INTO policy_revisions(policies) VALUES (?)")
        .run(JSON.stringify(policies));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  agents(): Agent[] {
    return this.db
      .prepare("SELECT data FROM agents ORDER BY rowid")
      .all()
      .map((r) => JSON.parse(r.data as string));
  }
  policyHistory(limit = 100) {
    return this.db
      .prepare(
        "SELECT version,policies FROM policy_revisions ORDER BY version DESC LIMIT ?",
      )
      .all(limit)
      .map((r) => ({
        version: Number(r.version),
        policies: JSON.parse(r.policies as string),
      }));
  }
  pruneResults(before: string) {
    return Number(
      this.db
        .prepare(
          "UPDATE actions SET data=json_set(json_remove(data,'$.result'),'$.resultPurgedAt',?) WHERE status IN ('allowed','blocked','failed','unknown') AND json_extract(data,'$.createdAt')<? AND json_type(data,'$.result') IS NOT NULL",
        )
        .run(new Date().toISOString(), before).changes,
    );
  }
  actionsPage(query: ActivityQuery) {
    const { where, values } = activityWhere(query, "sqlite");
    return {
      items: this.db
        .prepare(
          "SELECT data FROM actions" +
            where +
            " ORDER BY rowid DESC LIMIT ? OFFSET ?",
        )
        .all(...values, query.limit, query.offset)
        .map((r) => JSON.parse(r.data as string) as ActionRecord),
      total: Number(
        this.db
          .prepare("SELECT COUNT(*) AS total FROM actions" + where)
          .get(...values)!.total,
      ),
      offset: query.offset,
      limit: query.limit,
    };
  }
  agent(id: string): Agent | undefined {
    const row = this.db.prepare("SELECT data FROM agents WHERE id=?").get(id);
    return row ? JSON.parse(row.data as string) : undefined;
  }
  authenticate(token: string): Agent | undefined {
    const row = this.db
      .prepare("SELECT data FROM agents WHERE token_hash=?")
      .get(digest(token));
    const agent: Agent | undefined = row
      ? JSON.parse(row.data as string)
      : undefined;
    return agent?.tokenAudience === AUDIENCE &&
      (agent.tokenExpiresAt ?? 0) > Date.now()
      ? agent
      : undefined;
  }
  createAgent(input: AgentInput, context?: AuditContext) {
    const token = "ab_" + randomBytes(32).toString("hex");
    const agent: Agent = {
      ...input,
      id: randomUUID(),
      status: "active",
      tainted: false,
      createdAt: new Date().toISOString(),
    };
    agent.tokenAudience = AUDIENCE;
    agent.tokenExpiresAt = Date.now() + 3600_000;
    agent.grant = {
      id: randomUUID(),
      agent_id: agent.id,
      tenant: "local",
      human_owner: input.ownerId ?? "local-administrator",
      actions: input.tools,
      resources: input.resources,
      environments: ["sandbox"],
      expires_at_ms: agent.tokenExpiresAt,
      revoked: false,
      policy_version: POLICY_VERSION,
      max_calls: 1000,
      used_calls: 0,
      max_rows: 100,
    };
    this.db
      .prepare("INSERT INTO agents VALUES (?,?,?)")
      .run(agent.id, digest(token), JSON.stringify(agent));
    this.audit("agent.created", {
      agentId: agent.id,
      name: agent.name,
      ...auditDetails(
        context ??
          (input.ownerId
            ? { actorId: input.ownerId, tenant: "local" }
            : undefined),
      ),
    });
    return { agent, token };
  }
  saveAgent(agent: Agent) {
    this.db
      .prepare("UPDATE agents SET data=? WHERE id=?")
      .run(JSON.stringify(agent), agent.id);
  }
  changeAgent(
    id: string,
    patch: { status?: Agent["status"]; grant?: TaskGrant },
    event: string,
    context?: AuditContext,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const agent = this.agent(id);
      if (agent) {
        if (patch.grant?.id === agent.grant?.id && patch.grant && agent.grant)
          patch = {
            ...patch,
            grant: {
              ...patch.grant,
              used_calls: Math.max(
                agent.grant.used_calls,
                patch.grant.used_calls,
              ),
            },
          };
        Object.assign(agent, patch);
        this.saveAgent(agent);
        this.audit(event, {
          agentId: id,
          grantId: agent.grant?.id,
          ...auditDetails(context),
        });
      }
      this.db.exec("COMMIT");
      return agent;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  actions(): ActionRecord[] {
    return this.db
      .prepare("SELECT data FROM actions ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(r.data as string));
  }
  action(id: string): ActionRecord | undefined {
    const row = this.db.prepare("SELECT data FROM actions WHERE id=?").get(id);
    return row ? JSON.parse(row.data as string) : undefined;
  }
  previous(agentId: string, requestId: string): ActionRecord | undefined {
    const row = this.db
      .prepare("SELECT data FROM actions WHERE agent_id=? AND request_id=?")
      .get(agentId, requestId);
    return row ? JSON.parse(row.data as string) : undefined;
  }
  insertAction(a: ActionRecord) {
    this.db
      .prepare("INSERT INTO actions VALUES (?,?,?,?,?)")
      .run(a.id, a.agentId, a.requestId, a.status, JSON.stringify(a));
  }
  saveAction(a: ActionRecord) {
    this.db
      .prepare("UPDATE actions SET status=?, data=? WHERE id=?")
      .run(a.status, JSON.stringify(a), a.id);
  }
  claim(a: ActionRecord) {
    const oldStatus = a.status;
    a.status = "executing";
    return (
      this.db
        .prepare("UPDATE actions SET status=?, data=? WHERE id=? AND status=?")
        .run(a.status, JSON.stringify(a), a.id, oldStatus).changes === 1
    );
  }
  blockPending(a: ActionRecord) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const persisted = this.action(a.id);
      if (!persisted || persisted.status !== "pending")
        throw new HttpError(409, "This action is no longer awaiting approval");
      const next = {
        ...persisted,
        status: "blocked" as const,
        rule: a.rule,
        reason: a.reason,
        approvalReceipt: a.approvalReceipt,
      };
      this.saveAction(next);
      this.audit("approval.blocked", {
        actionId: a.id,
        rule: a.rule,
        ...auditDetails(next.approvalReceipt),
      });
      this.db.exec("COMMIT");
      Object.assign(a, next);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  reserve(a: ActionRecord, check: ReservationCheck) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const persisted = this.action(a.id),
        agent = this.agent(a.agentId);
      if (
        !persisted ||
        !agent ||
        !["queued", "pending"].includes(persisted.status) ||
        persisted.status !== a.status
      )
        throw new HttpError(409, "Execution has already been claimed");
      const denial = check(agent, this.settings(), persisted);
      if (denial) {
        Object.assign(a, denial, { status: "blocked" });
        this.saveAction(a);
        this.audit("execution.blocked", { actionId: a.id, rule: denial.rule });
      } else {
        a.status = "executing";
        agent.grant!.used_calls++;
        if (a.tool === "database_read") agent.tainted = true;
        this.saveAgent(agent);
        this.saveAction(a);
        this.audit("execution.started", {
          actionId: a.id,
          correlationId: a.correlationId,
          approverId: a.approvalReceipt?.actorId,
        });
      }
      this.db.exec("COMMIT");
      return !denial;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  audit(type: string, details: unknown) {
    const previous =
      (this.db.prepare("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").get()
        ?.hash as string) ?? "genesis";
    const data = JSON.stringify({
      type,
      details,
      at: new Date().toISOString(),
    });
    this.db
      .prepare("INSERT INTO audit(data,previous_hash,hash) VALUES (?,?,?)")
      .run(data, previous, digest(previous + data));
  }
  auditTrail(query?: AuditQuery) {
    const where = query?.actionId
      ? " WHERE json_extract(data,'$.details.actionId')=?"
      : "";
    const values: (string | number)[] = query?.actionId ? [query.actionId] : [];
    if (query) values.push(query.limit, query.offset ?? 0);
    return this.db
      .prepare(
        "SELECT * FROM audit" +
          where +
          " ORDER BY seq" +
          (query ? " LIMIT ? OFFSET ?" : ""),
      )
      .all(...values) as {
      seq: number;
      data: string;
      previous_hash: string;
      hash: string;
    }[];
  }
  verifyAudit() {
    let previous = "genesis";
    for (const row of this.auditTrail()) {
      if (
        row.previous_hash !== previous ||
        row.hash !== digest(previous + row.data)
      )
        return false;
      previous = row.hash as string;
    }
    return true;
  }
  close() {
    this.db.close();
  }
}
