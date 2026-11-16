import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { toolSchemas, toolDescriptions, type Tool } from "./contracts.js";
import {gatewayBase} from './mcp-config.js';

// The bridge intentionally never loads the administrator's .env file.
const base = gatewayBase(process.env.AGENTBRAKE_URL || "http://127.0.0.1:4312",process.env.AGENTBRAKE_ISOLATED==='1');
const token = process.env.AGENTBRAKE_TOKEN;
if (!token)
  throw new Error(
    "Set AGENTBRAKE_TOKEN to an administrator-issued agent token",
  );
async function request(path: string, body?: unknown) {
  try {
    const response = await fetch(new URL(path, base), {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data) }],
      isError:
        !response.ok || ["blocked", "failed", "unknown"].includes(data.status),
    };
  } catch {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error:
              "Gateway unavailable. Nothing is authorized locally. Retry the exact action with the same requestId to recover its outcome; never use a new ID for an uncertain write.",
            requestId: (body as { requestId?: string } | undefined)?.requestId,
          }),
        },
      ],
      isError: true,
    };
  }
}
serveStdio(() => {
  const server = new McpServer({ name: "AgentBrake", version: "0.1.0" });
  for (const name of Object.keys(toolSchemas) as Tool[]) {
    server.registerTool(
      name,
      {
        description:
          toolDescriptions[name] +
          " Optional requestId is a UUID for idempotent retries. Pending means not executed; check action_status after human review.",
        inputSchema: toolSchemas[name].extend({
          requestId: z.string().uuid().optional(),
        }),
      },
      async (input: Record<string, unknown> & { requestId?: string }) => {
        const { requestId, ...args } = input;
        return request("/api/actions", {
          requestId: requestId ?? randomUUID(),
          tool: name,
          arguments: args,
        });
      },
    );
  }
  server.registerTool(
    "action_status",
    {
      description:
        "Check your own action outcome. Pending and executing do not mean success. Never resubmit an uncertain write under a new ID.",
      inputSchema: z.object({ id: z.string().uuid() }).strict(),
    },
    ({ id }) => request(`/api/actions/${id}`),
  );
  return server;
});
