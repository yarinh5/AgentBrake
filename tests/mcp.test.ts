import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createApp } from "../server/app.js";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

test("a real MCP stdio client calls the gateway and receives pending approval without a write", async () => {
  const system = createApp({
    databasePath: ":memory:",
    adminKey: "a-test-key-with-at-least-32-characters",
  });
  const { token } = system.store.createAgent({
    name: "MCP developer",
    tools: ["database_read", "database_update"],
    resources: ["customers"],
    sandbox: true,
  });
  const server = system.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const client = new Client({ name: "acceptance-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", import.meta.resolve("tsx"), resolve("server/mcp.ts")],
    cwd: tmpdir(),
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] =>
            entry[1] !== undefined &&
            ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"].includes(
              entry[0].toUpperCase(),
            ),
        ),
      ),
      AGENTBRAKE_URL: `http://127.0.0.1:${port}`,
      AGENTBRAKE_TOKEN: token,
    },
  });
  try {
    await client.connect(transport);
    assert.equal(
      (await client.listTools()).tools.some(
        (t) => t.name === "database_update",
      ),
      true,
    );
    const result = await client.callTool({
      name: "database_update",
      arguments: { id: 1, status: "paused" },
    });
    const body = JSON.parse(
      (result.content as { type: string; text: string }[])[0].text,
    );
    assert.equal(body.status, "pending");
    assert.equal(
      system.store.db.prepare("SELECT status FROM customers WHERE id=1").get()!
        .status,
      "active",
    );
    const status = await client.callTool({
      name: "action_status",
      arguments: { id: body.id },
    });
    assert.equal(
      JSON.parse((status.content as { text: string }[])[0].text).status,
      "pending",
    );
  } finally {
    await client.close();
    await transport.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await system.close();
  }
});
