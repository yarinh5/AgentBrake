import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolve } from "node:path";
import { Store } from "./store.js";
import { Connectors, type ConnectionConfig } from "./connectors.js";
import { Gateway } from "./gateway.js";
import { HttpError, policiesSchema, toolSchemas } from "./contracts.js";
import { OpaEvaluator } from "./policy/opa-client.js";
import type { PolicyEvaluator } from "./policy/contracts.js";
import { mountMcp } from "./mcp-http.js";

import type { AuditContext, ControlStore } from "./control-store.js";
import { POLICY_VERSION, type TaskGrant } from "./policy/contracts.js";
import {
  LocalOperators,
  type OperatorCredential,
  type OperatorRole,
  type OperatorIdentity,
} from "./security/operators.js";
import { reviewProofSchema } from "./security/approval.js";
import { mountControlExperience } from "./control-experience.js";
import type { GatewayPort } from "./gateway-port.js";
import type { LocalTelemetry } from "./telemetry.js";
import { ManagedAccounts } from "./security/accounts.js";
export function createApp<
  S extends ControlStore = Store,
  G extends GatewayPort = Gateway,
>(options: {
  store?: S;
  databasePath: string;
  adminKey: string;
  connections?: ConnectionConfig;
  connectionModes?: ReturnType<Connectors['modes']>;
  githubTransport?: typeof fetch;
  policy?: PolicyEvaluator;
  allowedHosts?: string[];
  operators?: OperatorCredential[];
  managedAccounts?: boolean;
  secureCookies?: boolean;
  surface?: "combined" | "control" | "gateway";
  gateway?: G;
  telemetry?: LocalTelemetry;
  mcp?: { url: string; bearer_token_env_var: string };
}) {
  if (options.adminKey.length < 24)
    throw new Error("ADMIN_KEY must contain at least 24 characters");
  const store = (options.store ?? new Store(options.databasePath)) as S;
  const connectors = new Connectors(
    store,
    options.connections ?? {},
    options.adminKey,
    options.githubTransport,
  );
  const modes = () => options.connectionModes ?? connectors.modes();
  const appScope = (agent: { resources: string[]; tools: string[] }) =>
    modes().github === 'github-app-sandbox' && agent.resources.length === 1 && agent.resources[0] === modes().repository &&
    agent.tools.every(t => ['github_list_repo', 'github_list_branches', 'github_read_file', 'github_propose_change', 'github_create_branch', 'github_open_pull_request'].includes(t));
  const clients = new Set<express.Response>();
  const notify = () => {
    for (const client of clients) client.write("data: update\n\n");
  };
  if (options.surface === "control" && (!options.gateway || !options.operators))
    throw Error(
      "Control surface requires remote Gateway and configured operators",
    );
  if (options.surface === "control" && options.connections)
    throw Error("Control surface must not have target connections");
  const gateway = (options.gateway ??
    new Gateway(
      store,
      connectors,
      notify,
      options.policy ?? new OpaEvaluator(),
    )) as G;
  const app = express();
  const legacyIdentities = new LocalOperators(options.adminKey, options.operators);
  if (options.managedAccounts && options.surface === "gateway")
    throw Error("Gateway cannot enable managed accounts");
  const accounts = options.managedAccounts
    ? new ManagedAccounts(store, legacyIdentities)
    : undefined;
  const identities = accounts ?? legacyIdentities;
  const sessionCookie = (token: string, seconds: number) =>
    `ab_session=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${seconds}${options.secureCookies ? '; Secure' : ''}`;
  let loginAttempts: number[] = [];
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.locals.correlationId = randomUUID();
    res.setHeader("X-Correlation-ID", res.locals.correlationId);
    const host = req.headers.host || "";
    const hostname = /^([a-zA-Z0-9.-]+)(?::[0-9]+)?$/
      .exec(host)?.[1]
      .toLowerCase();
    if (
      !hostname ||
      !["127.0.0.1", "localhost", ...(options.allowedHosts ?? [])].includes(
        hostname,
      )
    ) {
      throw new HttpError(403, "Untrusted host");
    }
    if (req.headers.origin && req.headers.origin !== `http://${host}`) {
      throw new HttpError(403, "Untrusted origin");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    if (req.path.startsWith("/api/"))
      res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  if (options.telemetry) app.use(options.telemetry.middleware());
  app.use((req, _res, next) => {
    const agentPath =
      req.path === "/mcp" ||
      /^\/api\/actions(?:\/[a-zA-Z0-9-]+)?$/.test(req.path);
    if (
      (options.surface === "control" && agentPath) ||
      (options.surface === "gateway" &&
        !agentPath &&
        req.path !== "/api/health")
    )
      throw new HttpError(404, "Route not found");
    next();
  });
  const closeMcp =
    options.surface === "control"
      ? async () => {}
      : mountMcp(app, store, gateway);
  app.get("/api/health", (_req, res) =>
    res.json({ status: "ok", version: "0.3.0-rc.1" }),
  );
  app.post("/api/login", async (req, res) => {
    loginAttempts = loginAttempts.filter((t) => t > Date.now() - 60_000);
    if (loginAttempts.length >= 15)
      throw new HttpError(429, "Too many attempts. Try again in one minute.");
    let session;
    try {
      if (accounts) session = await accounts.login(req.body);
      else {
        const key = z.object({key:z.string().max(200)}).strict().safeParse(req.body);
        if (!key.success) throw new HttpError(401,"Invalid workspace key");
        session = legacyIdentities.login(key.data.key);
      }
    } catch (error) {
      loginAttempts.push(Date.now());
      throw error;
    }
    res.setHeader(
      "Set-Cookie",
      sessionCookie(session.token, 28800),
    );
    res.json({
      ok: true,
      actor: session.actor,
      csrfToken: session.csrfToken,
      teamMode: identities.team,
      authMode: session.authMode,
    });
  });
  const access =
    (...roles: OperatorRole[]): express.RequestHandler =>
    async (req, res, next) => {
      try {
        const session = await identities.authenticate(req.headers.cookie);
        if (
          req.headers["x-ab-tenant"] &&
          req.headers["x-ab-tenant"] !== "local"
        )
          throw new HttpError(403, "Tenant access denied");
        if (roles.length && !roles.includes(session.actor.role))
          throw new HttpError(403, "Operator role does not permit this action");
        if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
          identities.checkCsrf(session, req.headers["x-ab-csrf"]);
        res.locals.actor = session.actor;
        res.locals.csrfToken = session.csrfToken;
        res.locals.session = session;
        res.locals.authMode = session.authMode;
        next();
      } catch (error) {
        next(error);
      }
    };
  const admin = access(),
    manage = access("administrator", "operator"),
    configure = access("administrator"),
    approve = access("administrator", "approver");
  const auditContext = (res: express.Response): AuditContext => {
    const actor = res.locals.actor as OperatorIdentity;
    return {
      actorId: actor.id,
      tenant: actor.tenant,
      correlationId: res.locals.correlationId,
    };
  };
  app.get("/api/session", admin, (_req, res) =>
    res.json({
      actor: res.locals.actor,
      csrfToken: res.locals.csrfToken,
      teamMode: identities.team,
      authMode: res.locals.authMode,
    }),
  );
  app.post("/api/logout", admin, async (req, res) => {
    identities.logout(req.headers.cookie);
    res.setHeader(
      "Set-Cookie",
      sessionCookie('', 0),
    );
    res.json({ ok: true });
  });
  const managed = () => {
    if (!accounts) throw new HttpError(409,"Managed accounts are disabled in compatibility mode");
    return accounts;
  };
  const accountSession = (res: express.Response, session: Awaited<ReturnType<ManagedAccounts["setup"]>>) => {
    res.setHeader("Set-Cookie",sessionCookie(session.token, 28800));
    res.json({ok:true,actor:session.actor,csrfToken:session.csrfToken,teamMode:true,authMode:"account"});
  };
  const credentialAttempt = () => {
    loginAttempts = loginAttempts.filter(t=>t>Date.now()-60_000);
    if(loginAttempts.length>=15) throw new HttpError(429,"Too many attempts. Try again in one minute.");
    loginAttempts.push(Date.now());
  };
  app.get("/api/setup", async (_req,res)=>res.json(accounts ? await accounts.status() : {managed:false,initialized:false}));
  app.post("/api/setup",async(req,res)=>{
    credentialAttempt();
    accountSession(res,await managed().setup(req.body));
  });
  app.post("/api/invitations/accept",async(req,res)=>{
    credentialAttempt();
    accountSession(res,await managed().accept(req.body));
  });
  app.post("/api/password/reset",async(req,res)=>{
    credentialAttempt();
    await managed().reset(req.body);res.json({ok:true});
  });
  app.get("/api/profile",admin,async(_req,res)=>res.json({account:await managed().profile(res.locals.session)}));
  app.patch("/api/profile",admin,async(req,res)=>res.json({account:await managed().rename(res.locals.session,req.body)}));
  app.post("/api/password/change",admin,async(req,res)=>{
    await managed().changePassword(res.locals.session,req.body);
    identities.logout(req.headers.cookie);
    res.setHeader("Set-Cookie","ab_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0");res.json({ok:true});
  });
  app.get("/api/team",configure,async(_req,res)=>res.json(await managed().teamMembers(res.locals.session)));
  app.post("/api/team/invitations",configure,async(req,res)=>res.status(201).json(await managed().invite(res.locals.session,req.body)));
  app.delete("/api/team/invitations/:id",configure,async(req,res)=>{await managed().revoke(res.locals.session,String(req.params.id));res.json({ok:true});});
  app.patch("/api/team/:id",configure,async(req,res)=>res.json(await managed().changeMember(res.locals.session,String(req.params.id),req.body)));
  app.post("/api/team/:id/recovery",configure,async(req,res)=>res.json(await managed().recovery(res.locals.session,String(req.params.id),req.body)));
  app.post("/api/actions", async (req, res) => {
    const auth = req.headers.authorization;
    const agent = auth?.startsWith("Bearer ")
      ? await store.authenticate(auth.slice(7))
      : undefined;
    if (!agent) throw new HttpError(401, "Valid agent bearer token required");
    res.json(await gateway.submit(agent.id, req.body));
  });
  app.get("/api/actions/:id", async (req, res) => {
    const auth = req.headers.authorization;
    const agent = auth?.startsWith("Bearer ")
      ? await store.authenticate(auth.slice(7))
      : undefined;
    if (!agent) throw new HttpError(401, "Valid agent bearer token required");
    res.json(await gateway.actionForAgent(agent.id, req.params.id));
  });
  app.get("/api/workspace", admin, async (req, res) => {
    const page = await store.actionsPage({ offset: 0, limit: 500 });
    const actions = page.items.map(({ result, digest, ...action }) => action);
    res.json({
      agents: await store.agents(),
      actions,
      actionCount: page.total,
      ...(await store.settings()),
      connections: modes(),
      mcp: options.mcp ?? {
        command: process.execPath,
        args: [
          "--import",
          import.meta.resolve("tsx"),
          resolve("server/mcp.ts"),
        ],
        env: {
          AGENTBRAKE_URL: `http://${req.headers.host}`,
          AGENTBRAKE_TOKEN: "<your-agent-token>",
        },
      },
      auditValid: await store.verifyAudit(),
      updatedAt: new Date().toISOString(),
      actor: res.locals.actor,
      teamMode: identities.team,
    });
  });
  app.get("/api/events", admin, async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write("data: connected\n\n");
    clients.add(res);
    const heartbeat = setInterval(() => {
      if (req.destroyed) return;
      res.write(": heartbeat\n\n");
    }, 20_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
  });
  app.post("/api/agents", manage, async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(2).max(60),
        tools: z
          .array(z.enum(Object.keys(toolSchemas) as [string, ...string[]]))
          .min(1)
          .max(Object.keys(toolSchemas).length),
        resources: z.array(z.string().min(1).max(120)).min(1).max(10),
        sandbox: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    if (!input.sandbox && modes().github === 'github-app-sandbox' && !appScope(input))
      throw new HttpError(400, 'Identity exceeds the configured GitHub App sandbox scope');
    const created = await store.createAgent(
      {
        ...input,
        ownerId: (res.locals.actor as OperatorIdentity).id,
      },
      auditContext(res),
    );
    notify();
    res.status(201).json(created);
  });
  app.patch("/api/agents/:id", manage, async (req, res) => {
    const { status } = z
      .object({ status: z.enum(["active", "paused"]) })
      .strict()
      .parse(req.body);
    const agent = await store.agent(z.string().parse(req.params.id));
    if (!agent) throw new HttpError(404, "Agent not found");
    const updated = await store.changeAgent(
      agent.id,
      { status },
      "agent." + status,
      auditContext(res),
    );
    notify();
    res.json(updated);
  });
  app.post("/api/agents/:id/grant", manage, async (req, res) => {
    const task = z
      .object({
        actions: z
          .array(z.enum(Object.keys(toolSchemas) as [string, ...string[]]))
          .min(1)
          .max(Object.keys(toolSchemas).length),
        resources: z
          .array(z.string().min(1).max(120))
          .min(1)
          .max(2),
        environments: z.array(z.literal("sandbox")).length(1),
        expiresInSeconds: z.number().int().min(30).max(3600),
        maxCalls: z.number().int().min(1).max(1000),
        maxRows: z.number().int().min(1).max(100),
      })
      .strict()
      .parse(req.body);
    const agent = await store.agent(String(req.params.id));
    if (!agent) throw new HttpError(404, "Agent not found");
    if (
      (!agent.sandbox && !appScope(agent)) ||
      (agent.sandbox && task.resources.some(r => !['customers', 'agentbrake/sandbox'].includes(r))) ||
      task.actions.some((a) => !agent.tools.includes(a)) ||
      task.resources.some((r) => !agent.resources.includes(r)) ||
      (agent.tokenExpiresAt ?? 0) <= Date.now()
    )
      throw new HttpError(
        400,
        "Task exceeds the configured fixture identity scope",
      );
    const grant: TaskGrant = {
      id: randomUUID(),
      agent_id: agent.id,
      tenant: "local" as const,
      human_owner: (res.locals.actor as OperatorIdentity).id,
      actions: task.actions,
      resources: task.resources,
      environments: task.environments,
      expires_at_ms: Math.min(
        Date.now() + task.expiresInSeconds * 1000,
        agent.tokenExpiresAt!,
      ),
      revoked: false,
      policy_version: POLICY_VERSION,
      max_calls: task.maxCalls,
      used_calls: 0,
      max_rows: task.maxRows,
    };
    await store.changeAgent(
      agent.id,
      { grant },
      "grant.issued",
      auditContext(res),
    );
    notify();
    res.status(201).json(grant);
  });
  app.post("/api/agents/:id/grant/revoke", manage, async (req, res) => {
    const agent = await store.agent(String(req.params.id));
    if (!agent?.grant) throw new HttpError(404, "Task grant not found");
    await store.changeAgent(
      agent.id,
      { grant: { ...agent.grant, revoked: true } },
      "grant.revoked",
      auditContext(res),
    );
    notify();
    res.json({ ok: true });
  });
  app.put("/api/policies", configure, async (req, res) => {
    await store.setPolicies(policiesSchema.parse(req.body), auditContext(res));
    notify();
    res.json({ ok: true });
  });
  app.post("/api/control", configure, async (req, res) => {
    await store.setPaused(
      z.object({ paused: z.boolean() }).strict().parse(req.body).paused,
      auditContext(res),
    );
    notify();
    res.json({ ok: true });
  });
  app.get("/api/approvals/:id", admin, async (req, res) =>
    res.json(await gateway.review(String(req.params.id))),
  );
  app.post("/api/approvals/:id", approve, async (req, res) => {
    const { decision, proof } = z
      .object({
        decision: z.enum(["approve", "reject"]),
        proof: identities.team
          ? reviewProofSchema
          : reviewProofSchema.optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await gateway.approve(
        z.string().parse(req.params.id),
        decision === "approve",
        {
          actor: res.locals.actor as OperatorIdentity,
          proof,
          team: identities.team,
        },
      ),
    );
  });
  mountControlExperience(app, store, gateway, admin, manage);
  app.post("/api/simulate", manage, async (_req, res) => {
    let demos = (await store.agents()).filter((a) => a.sandbox);
    if (demos.length === 0) {
      demos = await Promise.all(
        [
          "Atlas · coding agent",
          "Scout · research agent",
          "Relay · operations",
        ].map(
          async (name) =>
            (
              await store.createAgent(
                {
                  name,
                  tools: Object.keys(toolSchemas),
                  resources: ["customers", "agentbrake/sandbox"],
                  sandbox: true,
                  ownerId: (res.locals.actor as OperatorIdentity).id,
                },
                auditContext(res),
              )
            ).agent,
        ),
      );
    }
    const submit = (agentId: string, tool: string, args: object) =>
      gateway.submit(agentId, {
        requestId: randomUUID(),
        tool,
        arguments: args,
      });
    await submit(demos[0].id, "github_read_file", {
      repo: "agentbrake/sandbox",
      path: "README.md",
    });
    await submit(demos[0].id, "database_read", { limit: 10 });
    await submit(demos[1 % demos.length].id, "github_read_file", {
      repo: "agentbrake/sandbox",
      path: "src/index.ts",
    });
    await submit(demos[0].id, "database_delete", { table: "customers" });
    await submit(demos[1 % demos.length].id, "github_read_file", {
      repo: "agentbrake/sandbox",
      path: ".env.production",
    });
    await submit(demos[0].id, "github_create_issue", {
      repo: "agentbrake/sandbox",
      title: "Export customers",
      body: "Customer report",
    });
    await submit(demos[2 % demos.length].id, "http_request", {
      url: "https://untrusted.example/upload",
    });
    await submit(demos[2 % demos.length].id, "database_update", {
      id: 2,
      status: "paused",
    });
    await submit(demos[1 % demos.length].id, "github_create_issue", {
      repo: "agentbrake/sandbox",
      title: "Review release checklist",
      body: "Check the release before publishing.",
    });
    res.json({
      ok: true,
      message: "Nine sandbox actions passed through the enforcement engine.",
    });
  });
  app.use("/api", () => {
    throw new HttpError(404, "Route not found");
  });
  app.use(
    async (
      error: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status =
        error instanceof HttpError
          ? error.status
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? 400
            : (error as { status?: number })?.status === 413
              ? 413
              : 500;
      if (req.path.startsWith("/api")) {
        try {
          const auth = req.headers.authorization;
          const agent = auth?.startsWith("Bearer ")
            ? await store.authenticate(auth.slice(7))
            : undefined;
          const reasons: Record<number, string> = {
            400: "invalid-request",
            401: "unauthenticated",
            403: "forbidden",
            404: "not-found",
            409: "conflict",
            413: "payload-limit",
            429: "request-limit",
          };
          await store.audit("rest.rejected", {
            correlationId: res.locals.correlationId,
            agentId: agent?.id,
            status,
            reason: reasons[status] ?? "operation-error",
            method: [
              "GET",
              "POST",
              "PUT",
              "PATCH",
              "DELETE",
              "HEAD",
              "OPTIONS",
            ].includes(req.method)
              ? req.method
              : "OTHER",
            surface: req.path.startsWith("/api/actions")
              ? "actions"
              : req.path.startsWith("/api/approvals")
                ? "approvals"
                : "control",
          });
        } catch {
          res.status(503).json({
            error: "Audit unavailable. Request could not be completed safely",
          });
          return;
        }
      }
      res.status(status).json({
        error:
          error instanceof HttpError
            ? error.message
            : status === 400
              ? "Invalid request"
              : status === 413
                ? "Request is too large"
                : "Request could not be completed safely",
      });
    },
  );
  return {
    app,
    store,
    gateway,
    close: async () => {
      for (const client of clients) client.end();
      await closeMcp();
      await connectors.close();
      await store.close();
      await options.telemetry?.shutdown();
    },
  };
}
