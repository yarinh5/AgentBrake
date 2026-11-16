import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../../server/app.js";
import { OpaEvaluator } from "../../server/policy/opa-client.js";
import type { PolicyInput } from "../../server/policy/contracts.js";
import { issueReview } from "../../server/security/approval.js";

function setup(options: Record<string, unknown> = {}) {
  const s = createApp({
    databasePath: ":memory:",
    adminKey: "synthetic-review-regression-admin-key",
    ...options,
  });
  const { agent, token } = s.store.createAgent({
    name: "Review regression",
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
  const send = (tool = "database_read", args: Record<string, unknown> = {}) =>
    s.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool,
      arguments: args,
    });
  return { ...s, agent, token, send, calls: () => calls };
}

test("cached results are withdrawn from REST and MCP status after policy changes", async () => {
  const s = setup();
  const http = s.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => http.once("listening", r));
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  try {
    const action = await s.send();
    assert.equal(action.status, "allowed");
    s.store.setPolicies({ ...s.store.settings().policies, reads: "deny" });
    const rest = await fetch(url + `/api/actions/${action.id}`, {
      headers: { Authorization: `Bearer ${s.token}` },
    });
    assert.equal(rest.status, 403);
    assert.ok(!(await rest.text()).includes("rows"));
    const rpc = await fetch(url + "/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s.token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "action_status",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "action_status",
          arguments: { id: action.id },
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    const body = await rpc.json();
    assert.ok(body.error || body.result?.isError);
    assert.ok(!JSON.stringify(body).includes("rows"));
    assert.equal(s.calls(), 1);
  } finally {
    await new Promise<void>((r) => http.close(() => r()));
    await s.close();
  }
});

test("status recovery remains available when execution quota is consumed", async () => {
  const s = setup();
  try {
    const a = s.store.agent(s.agent.id)!;
    a.grant!.max_calls = 1;
    s.store.saveAgent(a);
    const action = await s.send();
    assert.equal(action.status, "allowed");
    assert.equal(
      (await s.gateway.actionForAgent(a.id, action.id)).status,
      "allowed",
    );
    assert.equal(s.calls(), 1);
  } finally {
    await s.close();
  }
});

test("approval expiry during awaited real PDP evaluation blocks before dispatch", async () => {
  let hold = false,
    ready!: () => void,
    release!: () => void;
  const entered = new Promise<void>((r) => (ready = r)),
    blocked = new Promise<void>((r) => (release = r)),
    opa = new OpaEvaluator();
  const s = setup({
    policy: {
      evaluate: async (input: PolicyInput) => {
        const answer = await opa.evaluate(input);
        if (hold) {
          ready();
          await blocked;
        }
        return answer;
      },
    },
  });
  try {
    const pending = await s.send("database_update", {
      id: 1,
      status: "paused",
    });
    assert.equal(pending.status, "pending");
    const deadline = Date.now() + 250;
    // Agent responses intentionally omit protected review/preview fields. Adjust
    // the stored fixture, not the public response, to simulate a short TTL.
    const stored = s.store.action(pending.id)!;
    stored.expiresAt = new Date(deadline).toISOString();
    stored.review = issueReview(stored);
    s.store.saveAction(stored);
    hold = true;
    const approval = s.gateway.approve(pending.id, true, {
      actor: {
        id: "reviewer",
        name: "Review fixture",
        tenant: "local",
        role: "approver",
      },
      team: true,
      proof: stored.review,
    });
    await entered;
    await new Promise((r) =>
      setTimeout(r, Math.max(1, deadline - Date.now() + 10)),
    );
    release();
    const result = await approval;
    assert.equal(result.status, "blocked");
    assert.equal(result.rule, "approval-expired");
    assert.equal(s.calls(), 0);
    assert.equal(
      s.store.db.prepare("SELECT version FROM customers WHERE id=1").get()!
        .version,
      0,
    );
  } finally {
    release();
    await s.close();
  }
});

test("credential-shaped unknown tool names never appear in REST records or audit exports", async () => {
  const s = setup();
  const http = s.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => http.once("listening", r));
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`,
    sentinel = "sk-" + "SYNTHETICFIXTURE".repeat(3);
  try {
    const action = await fetch(url + "/api/actions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: randomUUID(),
        tool: sentinel,
        arguments: {},
      }),
    });
    const body = await action.json();
    assert.equal(body.status, "blocked");
    assert.ok(!JSON.stringify(body).includes(sentinel));
    assert.ok(!JSON.stringify(s.store.actions()).includes(sentinel));
    assert.ok(!JSON.stringify(s.store.auditTrail()).includes(sentinel));
    const login = await fetch(url + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "synthetic-review-regression-admin-key" }),
    });
    const exported = await fetch(url + "/api/audit/export", {
      headers: { Cookie: login.headers.get("set-cookie")!.split(";")[0] },
    });
    assert.equal(exported.status, 200);
    assert.ok(!(await exported.text()).includes(sentinel));
    assert.equal(s.calls(), 0);
  } finally {
    await new Promise<void>((r) => http.close(() => r()));
    await s.close();
  }
});
test("credential-shaped unknown tool names are not echoed in MCP errors", async () => {
  const s = setup();
  const http = s.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => http.once("listening", r));
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`,
    sentinel = "sk-" + "SYNTHETICFIXTURE".repeat(3);
  try {
    const rpc = await fetch(url + "/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s.token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": sentinel,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: sentinel,
          arguments: {},
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    const body = await rpc.json();
    assert.ok(body.error || body.result?.isError);
    assert.ok(!JSON.stringify(body).includes(sentinel));
    assert.ok(!JSON.stringify(s.store.auditTrail()).includes(sentinel));
    assert.equal(s.calls(), 0);
  } finally {
    await new Promise<void>((r) => http.close(() => r()));
    await s.close();
  }
});
