import express from "express";
import { timingSafeEqual } from "node:crypto";
import { Store, digest } from "./store.js";
import { Connectors } from "./connectors.js";
import {
  actionSchema,
  toolSchemas,
  TargetChangedError,
  type ActionPreview,
  type Tool,
} from "./contracts.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { ExecutionAction } from "./adapters/fixture-http.js";

export function createFixtureTarget(
  token: string,
  observerToken: string,
  controlled?: {
    execute(action: ExecutionAction): Promise<unknown>;
    preview?(action: ExecutionAction): Promise<ActionPreview>;
    snapshot(): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  },
) {
  const store = new Store(":memory:");
  const connectors = new Connectors(
    store,
    {},
    "synthetic-fixture-binding-key-not-a-real-secret",
  );
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  let calls = 0;
  let previewCalls = 0;
  const auth =
    (expected: string): express.RequestHandler =>
    (req, res, next) => {
      const supplied = req.headers.authorization?.slice(7) ?? "";
      if (
        !req.headers.authorization?.startsWith("Bearer ") ||
        !timingSafeEqual(
          Buffer.from(digest(supplied)),
          Buffer.from(digest(expected)),
        )
      ) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    };
  app.get("/health", (_req, res) => res.json({ ok: true, fixture: true }));
  app.get("/observations", auth(observerToken), (_req, res) =>
    res.json({ executionCalls: calls, previewCalls }),
  );
  app.post("/preview", auth(token), async (req, res) => {
    previewCalls++;
    const parsed = actionSchema.safeParse({
      requestId: randomUUID(),
      tool: req.body?.tool,
      arguments: req.body?.arguments,
    });
    if (!parsed.success || !Object.hasOwn(toolSchemas, parsed.data.tool)) {
      res.status(400).json({ error: "Invalid preview operation" });
      return;
    }
    const args = toolSchemas[parsed.data.tool as Tool].parse(
      parsed.data.arguments,
    );
    const action = { tool: parsed.data.tool, arguments: args, sandbox: true };
    res.json(
      controlled
        ? await controlled.preview?.(action)
        : await connectors.preview(action),
    );
  });
  app.post("/execute", auth(token), async (req, res) => {
    calls++;
    const { precondition, ...envelope } = z
      .object({
        precondition: z
          .object({ version: z.number().int().nonnegative() })
          .strict()
          .optional(),
      })
      .passthrough()
      .parse(req.body);
    const parsed = actionSchema.safeParse({
      requestId: randomUUID(),
      ...envelope,
    });
    if (!parsed.success || !Object.hasOwn(toolSchemas, parsed.data.tool)) {
      res.status(400).json({ error: "Invalid fixture operation" });
      return;
    }
    const args = toolSchemas[parsed.data.tool as Tool].safeParse(
      parsed.data.arguments,
    );
    if (!args.success) {
      res.status(400).json({ error: "Invalid fixture arguments" });
      return;
    }
    res.json(
      await (controlled ?? connectors).execute({
        tool: parsed.data.tool,
        arguments: args.data,
        sandbox: true,
        precondition,
      }),
    );
  });
  app.get("/snapshot", auth(observerToken), async (_req, res) =>
    res.json(
      controlled
        ? { calls, ...(await controlled.snapshot()) }
        : {
            calls,
            customers: store.db
              .prepare("SELECT * FROM customers ORDER BY id")
              .all(),
            issues: store.db
              .prepare("SELECT * FROM sandbox_issues ORDER BY id")
              .all(),
            schema: store.db
              .prepare(
                "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name",
              )
              .all(),
          },
    ),
  );
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(error instanceof TargetChangedError ? 409 : 500)
        .json({
          error:
            error instanceof TargetChangedError
              ? "Reviewed target state changed"
              : "Fixture operation failed",
        });
    },
  );
  return {
    app,
    close: async () => {
      await connectors.close();
      await controlled?.close();
      store.close();
    },
  };
}
