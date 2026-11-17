import type express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ControlStore } from "./control-store.js";
import type { Gateway } from "./gateway.js";
import { HttpError, type ActionRecord } from "./contracts.js";

const credential =
  /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)|(?:password|api[_-]?key|secret|access[_-]?token)\s*[=:]\s*\S+)/gi;
export function redactExport(value: unknown): unknown {
  if (typeof value === "string") return value.replace(credential, "[REDACTED]");
  if (Array.isArray(value)) return value.map(redactExport);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /^(?:token|password|secret|key|authorization|cookie|csrfToken|nonce)$/i.test(
          key,
        )
          ? "[REDACTED]"
          : redactExport(item),
      ]),
    );
  return value;
}
export const publicAction = ({ result, digest, ...action }: ActionRecord) =>
  redactExport(action);
const cell = (value: unknown) => {
  let s =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
const csv = (rows: unknown[][]) =>
  rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
const formatSchema = z
  .object({ format: z.enum(["json", "csv"]).default("json") })
  .strict();
const iso = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const activitySchema = z
  .object({
    agentId: z.string().uuid().optional(),
    grantId: z.string().uuid().optional(),
    tool: z.string().max(100).optional(),
    status: z
      .enum([
        "queued",
        "pending",
        "executing",
        "allowed",
        "blocked",
        "failed",
        "unknown",
      ])
      .optional(),
    resource: z.string().max(120).optional(),
    from: iso.optional(),
    to: iso.optional(),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to);
const MAX_EXPORT = 10000;
async function auditBundle(store: ControlStore, actionId?: string) {
  const rows = await store.auditTrail({ limit: MAX_EXPORT + 1, actionId });
  if (rows.length > MAX_EXPORT)
    throw new HttpError(
      413,
      "Export exceeds 10000 audit records; use an action evidence export",
    );
  return {
    valid: await store.verifyAudit(),
    redacted: true,
    entries: rows.map((row) => ({
      ...row,
      seq: Number(row.seq),
      data: redactExport(JSON.parse(row.data)),
    })),
    verification:
      "Hash chain checked against stored records before redaction; this filtered redacted export is not an independent full-chain proof.",
  };
}
export async function actionEvidence(store: ControlStore, id: string) {
  const a = await store.action(id);
  if (!a) throw new HttpError(404, "Action not found");
  const audit = await auditBundle(store, id);
  const dispatched = audit.entries.some(
    (row) => (row.data as { type: string }).type === "execution.started",
  );
  const observation =
    a.status === "unknown"
      ? "unverified"
      : a.status === "allowed" || a.executionOutcome === "not-applied"
        ? "adapter-reported"
        : dispatched
          ? "unverified"
          : "not-dispatched";
  let summary: Record<string, unknown> | undefined;
  if (a.status === "allowed" && a.result && typeof a.result === "object") {
    const result = a.result as Record<string, unknown>;
    summary = {};
    if (Array.isArray(result.rows)) summary.rowCount = result.rows.length;
    for (const key of [
      "id",
      "status",
      "version",
      "number",
      "baseSha",
      "headSha",
      "proposalFingerprint",
      "branch",
    ])
      if (["number", "string", "boolean"].includes(typeof result[key]))
        summary[key] = result[key];
    if (result.pullRequest && typeof result.pullRequest === "object") {
      const pr = result.pullRequest as Record<string, unknown>;
      summary.pullRequest = {
        number: pr.number,
        state: pr.state,
        mock: pr.mock,
      };
    }
  }
  return redactExport({
    schemaVersion: 1,
    action: publicAction(a),
    decision: {
      id: a.policyDecisionId,
      policyHash: a.policyHash,
      version: a.policyVersion,
      revision: a.policyRevision,
      effect: a.policyEffect,
      reason: a.reason,
    },
    review: {
      fingerprint: a.review?.fingerprint,
      receipt: a.approvalReceipt,
      preview: a.preview,
    },
    execution: {
      status: a.status,
      observation,
      outcome: a.executionOutcome ?? (dispatched ? "unverified" : "not-dispatched"),
      resultDisclosure: a.resultDisclosure ?? (a.rule === "secret-output" ? "withheld" : "unrecorded"),
      resultRetained: a.result !== undefined,
      summary,
      correlationId: a.correlationId,
    },
    audit,
    coverage:
      "Local synthetic fixture. Adapter response is not independent target verification. UNKNOWN requires target reconciliation; never retry automatically.",
  }) as Record<string, any>;
}
export function mountControlExperience(
  app: express.Express,
  store: ControlStore,
  gateway: Pick<Gateway, "submit">,
  read: express.RequestHandler,
  manage: express.RequestHandler,
) {
  app.get("/api/activity", read, async (req, res) => {
    const page = await store.actionsPage(activitySchema.parse(req.query));
    res.json({ ...page, items: page.items.map(publicAction) });
  });
  app.get("/api/policies/history", read, async (_req, res) =>
    res.json({ items: await store.policyHistory(100) }),
  );
  app.get("/api/evidence/:id", read, async (req, res) =>
    res.json(
      await actionEvidence(store, z.string().uuid().parse(req.params.id)),
    ),
  );
  app.get("/api/evidence/:id/export", read, async (req, res) => {
    const { format } = formatSchema.parse(req.query);
    const id = z.string().uuid().parse(req.params.id);
    const evidence = await actionEvidence(store, id);
    res.attachment("agentbrake-evidence-" + id + "." + format);
    if (format === "json") res.json(evidence);
    else
      res.type("text/csv").send(
        csv([
          [
            "id",
            "tool",
            "status",
            "reason",
            "observation",
            "executionOutcome",
            "resultDisclosure",
            "resultRetained",
            "policyHash",
            "approver",
            "fingerprint",
          ],
          [
            id,
            evidence.action.tool,
            evidence.action.status,
            evidence.action.reason,
            evidence.execution.observation,
            evidence.execution.outcome,
            evidence.execution.resultDisclosure,
            evidence.execution.resultRetained,
            evidence.decision.policyHash,
            evidence.review.receipt?.actorId,
            evidence.review.fingerprint,
          ],
        ]),
      );
  });
  app.get("/api/audit/export", read, async (req, res) => {
    const { format } = formatSchema.parse(req.query);
    const bundle = await auditBundle(store);
    res.attachment("agentbrake-audit." + format);
    if (format === "json")
      res.json({ exportedAt: new Date().toISOString(), ...bundle });
    else
      res.type("text/csv").send(
        csv([
          ["sequence", "type", "time", "details", "previous_hash", "hash"],
          ...bundle.entries.map((row) => {
            const data = row.data as any;
            return [
              row.seq,
              data.type,
              data.at,
              data.details,
              row.previous_hash,
              row.hash,
            ];
          }),
        ]),
      );
  });
  app.post("/api/demo", manage, async (req, res) => {
    const { scenario } = z
      .object({ scenario: z.enum(["safe-read", "blocked-sql", "pr-approval"]) })
      .strict()
      .parse(req.body);
    const tools =
      scenario === "pr-approval"
        ? [
            "github_list_branches",
            "github_create_branch",
            "github_open_pull_request",
          ]
        : ["database_read"];
    const name = "Demo Lab · " + scenario,
      owner = res.locals.actor.id;
    let agent = (await store.agents()).find(
      (a) =>
        a.name === name &&
        a.ownerId === owner &&
        a.status === "active" &&
        !a.grant?.revoked &&
        (a.grant?.expires_at_ms ?? 0) > Date.now(),
    );
    if (!agent)
      agent = (
        await store.createAgent(
          {
            name,
            tools,
            resources: ["customers", "agentbrake/sandbox"],
            sandbox: true,
            ownerId: owner,
          },
          {
            actorId: res.locals.actor.id,
            tenant: res.locals.actor.tenant,
            correlationId: res.locals.correlationId,
          },
        )
      ).agent;
    const submit = (tool: string, args: object) =>
      gateway.submit(agent!.id, {
        requestId: randomUUID(),
        tool,
        arguments: args,
      });
    const actions: ActionRecord[] = [];
    if (scenario === "safe-read")
      actions.push(await submit("database_read", { limit: 2 }));
    else if (scenario === "blocked-sql")
      actions.push(
        await submit("database_read", {
          limit: 1,
          sql: "DROP TABLE customers",
        }),
      );
    else {
      const listed = await submit("github_list_branches", {
        repo: "agentbrake/sandbox",
      });
      actions.push(listed);
      if (listed.status === "allowed") {
        const branches = (
          listed.result as { branches: { name: string; sha: string }[] }
        ).branches;
        const main = branches.find((b) => b.name === "main");
        if (!main) throw new HttpError(503, "Fixture main branch unavailable");
        const branch = "agentbrake/demo-" + agent.id.slice(0, 8),
          feature = branches.find((b) => b.name === branch);
        if (!feature) {
          const pending = (
            await store.actionsPage({
              agentId: agent.id,
              status: "pending",
              tool: "github_create_branch",
              limit: 1,
              offset: 0,
            })
          ).items[0];
          actions.push(
            pending ??
              (await submit("github_create_branch", {
                repo: "agentbrake/sandbox",
                baseSha: main.sha,
                branch,
              })),
          );
        } else
          actions.push(
            await submit("github_open_pull_request", {
              repo: "agentbrake/sandbox",
              baseSha: main.sha,
              branch,
              title: "Local review demo",
              body: "Synthetic local fixture only",
              changes: [
                {
                  path: "docs/demo-review.md",
                  content: "# Reviewed local change\n",
                },
              ],
            }),
          );
      }
    }
    res.json({
      actions: actions.map(publicAction),
      message: actions.some((a) => a.status === "pending")
        ? "Waiting for a different authorized human. Run PR demo again after branch approval to request the PR."
        : "Actual Gateway outcomes shown; no external service was used.",
    });
  });
}
