// Private control-to-PEP boundary. Deployment binds this listener only to the control network.
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { digest } from "./store.js";
import { HttpError, actionSchema } from "./contracts.js";
import { reviewProofSchema, type ReviewContext } from "./security/approval.js";
import type { GatewayPort } from "./gateway-port.js";
const actorSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    name: z.string().min(1).max(80),
    tenant: z.literal("local"),
    role: z.enum(["administrator", "approver"]),
  })
  .strict();
export function createGatewayBridge(gateway: GatewayPort, key: string) {
  if (key.length < 32) throw Error("Private bridge key required");
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const supplied = req.headers.authorization;
    if (
      !supplied?.startsWith("Bearer ") ||
      !timingSafeEqual(
        Buffer.from(digest(supplied.slice(7))),
        Buffer.from(digest(key)),
      )
    )
      throw new HttpError(401, "Private bridge authentication required");
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.post("/submit", async (req, res) => {
    const body = z
      .object({ agentId: z.string().uuid(), input: actionSchema })
      .strict()
      .parse(req.body);
    res.json(await gateway.submit(body.agentId, body.input));
  });
  app.post("/review", async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(req.body);
    res.json(await gateway.review(id));
  });
  app.post("/approve", async (req, res) => {
    const body = z
      .object({
        id: z.string().uuid(),
        approve: z.boolean(),
        reviewer: z
          .object({
            actor: actorSchema,
            proof: reviewProofSchema,
            team: z.literal(true),
          })
          .strict(),
      })
      .strict()
      .parse(req.body);
    res.json(await gateway.approve(body.id, body.approve, body.reviewer));
  });
  app.use((_req, _res) => {
    throw new HttpError(404, "Unknown bridge operation");
  });
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        error instanceof HttpError
          ? error.status
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? 400
            : (error as { status?: number })?.status === 413
              ? 413
              : 503;
      res
        .status(status)
        .json({
          error:
            error instanceof HttpError
              ? error.message
              : "Private Gateway request failed safely",
        });
    },
  );
  return app;
}
export class RemoteGateway implements GatewayPort {
  private url: URL;
  constructor(
    url: string,
    private key: string,
  ) {
    this.url = new URL(url);
    if (
      this.url.protocol !== "http:" ||
      !["gateway-control", "127.0.0.1", "localhost"].includes(
        this.url.hostname,
      ) ||
      this.url.username ||
      this.url.password ||
      this.url.search ||
      this.url.hash ||
      key.length < 32
    )
      throw Error("Only private local Gateway bridge is permitted");
  }
  private async call(path: string, body: unknown) {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + this.key,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
    } catch {
      throw new HttpError(
        503,
        "Gateway response unavailable. Refresh the action state before any further operation.",
      );
    }
    const reader = response.body!.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 256000) {
        await reader.cancel();
        throw new HttpError(503, "Gateway response exceeded the bound");
      }
      chunks.push(value);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString());
    if (!response.ok)
      throw new HttpError(
        [400, 401, 403, 404, 409, 413, 429].includes(response.status)
          ? response.status
          : 503,
        typeof result.error === "string"
          ? result.error
          : "Gateway request failed",
      );
    return result;
  }
  submit(agentId: string, input: unknown) {
    return this.call("/submit", { agentId, input });
  }
  review(id: string) {
    return this.call("/review", { id });
  }
  approve(id: string, approve: boolean, reviewer?: ReviewContext) {
    return this.call("/approve", { id, approve, reviewer });
  }
  async actionForAgent(_agentId: string, _id: string): Promise<never> {
    throw new HttpError(
      404,
      "Agent actions require the agent Gateway endpoint",
    );
  }
}
