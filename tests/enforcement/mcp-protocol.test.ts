import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../../server/app.js";

const modern = "2026-07-28";
const legacy = "2025-11-25";
const meta = {
  "io.modelcontextprotocol/protocolVersion": modern,
  "io.modelcontextprotocol/clientCapabilities": {},
};
test("MCP withholds sensitive output while retaining execution outcome and replay identity", async () => {
  const s = await fixture();
  try {
    const execute = s.gateway.connectors.execute.bind(s.gateway.connectors);
    const secret = "ghp_" + "Z".repeat(32);
    s.gateway.connectors.execute = async a => ({ ...(await execute(a) as object), note: secret });
    const requestId = randomUUID();
    for (let i = 0; i < 2; i++) {
      const r = await s.send(s.call("database_read", { requestId, limit: 1 }));
      assert.equal(r.status, 200);
      assert.equal(r.data.result.isError, true, "withheld payload must not be treated as usable tool data");
      const a = JSON.parse(r.data.result.content[0].text);
      assert.equal(a.status, "allowed");
      assert.equal(a.executionOutcome, "adapter-reported");
      assert.equal(a.resultDisclosure, "withheld");
      assert.equal(a.result, undefined);
      assert.match(a.reason, /Do not resubmit/);
      assert.equal(JSON.stringify(r.data).includes(secret), false);
      const status = await s.send(s.call("action_status", { id: a.id }));
      assert.equal(status.data.result.isError, true, "status lookup must preserve withheld tool result semantics");
    }
    assert.equal(s.calls(), 1);
  } finally { await s.stop(); }
});
async function fixture() {
  const s = createApp({
    databasePath: ":memory:",
    adminKey: "synthetic-mcp-admin-key-not-shared-with-agent",
  });
  const { agent, token } = s.store.createAgent({
    name: "Protocol test",
    tools: ["database_read", "database_update"],
    resources: ["customers"],
    sandbox: true,
  });
  let calls = 0;
  const execute = s.gateway.connectors.execute.bind(s.gateway.connectors);
  s.gateway.connectors.execute = async (action) => {
    calls++;
    return execute(action);
  };
  const http = s.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => http.once("listening", resolve));
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`;
  const send = async (
    body: unknown,
    headers: Record<string, string> = {},
    auth = token,
  ) => {
    const b = body as { method?: string; params?: { name?: string } };
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${auth}`,
        "MCP-Protocol-Version": modern,
        "Mcp-Method": b.method ?? "",
        "Mcp-Name": b.params?.name ?? "",
        ...headers,
      },
      body: JSON.stringify(body),
    });
    const raw = await response.text();
    const data =
      raw.startsWith("event:") || raw.startsWith(":")
        ? JSON.parse(
            raw
              .split("\n")
              .find((l) => l.startsWith("data: {"))!
              .slice(6),
          )
        : raw
          ? JSON.parse(raw)
          : null;
    return { status: response.status, data };
  };
  const call = (name = "database_read", args: object = {}) => ({
    jsonrpc: "2.0",
    id: randomUUID(),
    method: "tools/call",
    params: { name, arguments: args, _meta: { ...meta } },
  });
  return {
    ...s,
    agent,
    token,
    send,
    call,
    calls: () => calls,
    stop: async () => {
      await new Promise<void>((r) => http.close(() => r()));
      await s.close();
    },
  };
}

test("MCP 2026-07-28 is stateless: discovery and allowed read reach real OPA once", async () => {
  const s = await fixture();
  try {
    const listed = await s.send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: meta },
    });
    assert.equal(listed.status, 200);
    assert.deepEqual(
      listed.data.result.tools.map((t: { name: string }) => t.name).sort(),
      ["action_status", "database_read", "database_update"],
    );
    const r = await s.send(s.call());
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.data.result.content[0].text).status, "allowed");
    assert.equal(s.calls(), 1);
  } finally {
    await s.stop();
  }
});
test("MCP explicit 2025-11-25 compatibility initializes and queues write without dispatch", async () => {
  const s = await fixture();
  try {
    const init = await s.send(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: legacy,
          capabilities: {},
          clientInfo: { name: "synthetic-client", version: "1" },
        },
      },
      { "MCP-Protocol-Version": legacy },
    );
    assert.equal(init.data.result.protocolVersion, legacy);
    const body = s.call("database_update", { id: 1, status: "paused" });
    delete (body.params as { _meta?: unknown })._meta;
    const r = await s.send(body, { "MCP-Protocol-Version": legacy });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.data.result.content[0].text).status, "pending");
    assert.equal(s.calls(), 0);
  } finally {
    await s.stop();
  }
});
test("MCP rejects invalid bearer before discovery", async () => {
  const s = await fixture();
  try {
    assert.equal((await s.send(s.call(), {}, "forged")).status, 401);
    assert.equal(s.calls(), 0);
  } finally {
    await s.stop();
  }
});
for (const [name, headers] of Object.entries<Record<string, string>>({
  unsupported: { "MCP-Protocol-Version": "1900-01-01" },
  missingVersion: { "MCP-Protocol-Version": "" },
  missingMethod: { "Mcp-Method": "" },
  methodMismatch: { "Mcp-Method": "tools/list" },
  nameMismatch: { "Mcp-Name": "github_create_issue" },
  versionMismatch: { "MCP-Protocol-Version": legacy },
})) {
  test(`MCP rejects ${name} without dispatch`, async () => {
    const s = await fixture();
    try {
      const r = await s.send(s.call(), headers);
      assert.ok(r.status >= 400, JSON.stringify(r));
      assert.equal(s.calls(), 0);
    } finally {
      await s.stop();
    }
  });
}
test("MCP unknown/schema-mismatched/identity-spoofed calls never dispatch", async () => {
  const s = await fixture();
  try {
    for (const body of [
      s.call("not_registered"),
      s.call("database_read", { sql: "DELETE FROM customers" }),
      s.call("database_read", { tenant: "other", agentId: randomUUID() }),
      { ...s.call(), tenant: "other" },
      s.call("database_read", { grant: { actions: ["*"] } }),
    ]) {
      const r = await s.send(body);
      assert.ok(
        r.status >= 400 || r.data.error || r.data.result?.isError,
        JSON.stringify(r),
      );
    }
    assert.equal(s.calls(), 0);
  } finally {
    await s.stop();
  }
});
test("MCP malformed, deep and oversized envelopes fail before the tool boundary", async () => {
  const s = await fixture();
  try {
    let nested: unknown = {};
    for (let n = 0; n < 15; n++) nested = { x: nested };
    assert.ok((await s.send({ not: "jsonrpc" })).status >= 400);
    assert.ok(
      (await s.send(s.call("database_read", { nested }))).status >= 400,
    );
    assert.equal(
      (await s.send(s.call("database_read", { text: "a".repeat(40000) })))
        .status,
      413,
    );
    assert.equal(s.calls(), 0);
  } finally {
    await s.stop();
  }
});
