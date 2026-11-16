import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  HttpError,
  toolDescriptions,
  toolSchemas,
  type Tool,
} from "./contracts.js";
import type { ControlStore } from "./control-store.js";
import type {GatewayPort} from './gateway-port.js';
import { assertPayloadLimits, RequestLimits } from "./security/limits.js";

export const MCP_VERSIONS = ["2026-07-28", "2025-11-25"] as const;
const envelope = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string().max(128), z.number()]).optional(),
    method: z.string().max(100),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const methods = new Set([
  "server/discover",
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
  "tools/call",
]);

// Authentication is outside MCP metadata. A fresh server is created per request;
// no protocol session can carry authority from one principal to another.
export function mountMcp(app: Express, store: ControlStore, gateway: GatewayPort) {
  const limits = new RequestLimits();
  const handler = createMcpHandler(
    async ({ authInfo }) => {
      const agent = (await store.agent(authInfo!.clientId))!;
      const server = new McpServer({ name: "AgentBrake", version: "0.3.0-rc.1" });
      for (const name of Object.keys(toolSchemas) as Tool[]) {
        if (!agent.grant?.actions.includes(name) || !agent.tools.includes(name))
          continue;
        server.registerTool(
          name,
          {
            description: toolDescriptions[name],
            inputSchema: toolSchemas[name].extend({
              requestId: z.string().uuid().optional(),
            }),
          },
          async (input: Record<string, unknown> & { requestId?: string }) => {
            const { requestId, ...args } = input;
            try {
              const action = await gateway.submit(agent.id, {
                requestId: requestId ?? randomUUID(),
                tool: name,
                arguments: args,
              });
              return {
                content: [
                  { type: "text" as const, text: JSON.stringify(action) },
                ],
                isError: ["blocked", "failed", "unknown"].includes(
                  action.status,
                ),
              };
            } catch (error) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({
                      error:
                        error instanceof HttpError
                          ? error.message
                          : "Request could not be completed safely",
                    }),
                  },
                ],
                isError: true,
              };
            }
          },
        );
      }
      server.registerTool(
        "action_status",
        {
          description:
            "Read your own action outcome. Pending is not executed. Never retry an uncertain write with a new ID.",
          inputSchema: z.object({ id: z.string().uuid() }).strict(),
        },
        async ({ id }) => {
          const action = await gateway.actionForAgent(agent.id, id);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(action) }],
          };
        },
      );
      return server;
    },
    { legacy: "stateless", responseMode: "json", maxRequestBodySize: 32768 },
  );
  const nodeHandler = toNodeHandler(handler, { maxRequestBodySize: 32768 });
  app.all("/mcp", async (req, res) => {
    const correlationId = randomUUID();
    res.setHeader("X-Correlation-ID", correlationId);
    res.setHeader("Cache-Control", "no-store");
    let release: (() => void) | undefined;
    try {
      const bearer = req.headers.authorization;
      const agent = bearer?.startsWith("Bearer ")
        ? await store.authenticate(bearer.slice(7))
        : undefined;
      if (
        !agent ||
        agent.status !== "active" ||
        !agent.grant ||
        agent.grant.revoked ||
        agent.grant.expires_at_ms <= Date.now()
      )
        throw new HttpError(
          401,
          "Valid active agent credential and grant required",
        );
      release = limits.enter(agent.id);
      if (req.method !== "POST")
        throw new HttpError(405, "Only stateless POST requests are supported");
      assertPayloadLimits(req.body);
      const parsed = envelope.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Invalid MCP envelope");
      const body = parsed.data;
      const version = req.headers["mcp-protocol-version"];
      if (
        typeof version !== "string" ||
        !MCP_VERSIONS.includes(version as (typeof MCP_VERSIONS)[number])
      )
        throw new HttpError(400, "Unsupported or missing MCP protocol version");
      if (!methods.has(body.method))
        throw new HttpError(400, "Unsupported MCP method");
      if (
        body.method === "initialize" &&
        (version !== "2025-11-25" || body.params?.protocolVersion !== version)
      )
        throw new HttpError(400, "Initialization protocol version mismatch");
      if (body.method === "tools/call" && body.id === undefined)
        throw new HttpError(400, "Tool calls must have a request ID");
      // Do not let SDK unknown-tool errors echo arbitrary, possibly secret,
      // identifiers. Only this trusted catalog can be named in diagnostics.
      if (
        body.method === "tools/call" &&
        (typeof body.params?.name !== "string" ||
          (!Object.hasOwn(toolSchemas, body.params.name) &&
            body.params.name !== "action_status"))
      )
        throw new HttpError(400, "Tool is not registered");
      // The SDK checks modern header/body agreement and required envelope keys.
      // Reject identity-bearing metadata; it is never a task grant.
      const meta = body.params?._meta;
      if (
        meta &&
        typeof meta === "object" &&
        Object.keys(meta).some(
          (key) =>
            ![
              "io.modelcontextprotocol/protocolVersion",
              "io.modelcontextprotocol/clientInfo",
              "io.modelcontextprotocol/clientCapabilities",
              "io.modelcontextprotocol/logLevel",
              "traceparent",
              "tracestate",
              "baggage",
            ].includes(key),
        )
      )
        throw new HttpError(400, "Unsupported MCP metadata");
      (req as Request & { auth: unknown }).auth = {
        token: "",
        clientId: agent.id,
        scopes: [],
      };
      await nodeHandler(req, res, body);
      await store.audit("mcp.response", {
        correlationId,
        agentId: agent.id,
        method: body.method,
        protocolVersion: version,
        status: res.statusCode,
      });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      try {
        await store.audit("mcp.rejected", { correlationId, status });
      } catch {
        if (!res.headersSent)
          res.status(503).json({ error: "Audit unavailable" });
        return;
      }
      if (!res.headersSent)
        res.status(status).json({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32600,
            message:
              error instanceof HttpError
                ? error.message
                : "Request could not be completed safely",
          },
        });
    } finally {
      release?.();
    }
  });
  return () => handler.close();
}
