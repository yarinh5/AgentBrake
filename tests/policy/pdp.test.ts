import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { createApp } from "../../server/app.js";
import { OpaEvaluator, policyHash } from "../../server/policy/opa-client.js";

const cases: Record<
  string,
  (req: IncomingMessage, res: ServerResponse) => void
> = {
  timeout: (_q, r) => {
    setTimeout(() => r.end("{}"), 150).unref();
  },
  error: (_q, r) => {
    r.writeHead(500, { "Content-Type": "application/json" });
    r.end("{}");
  },
  missing: (_q, r) => {
    r.writeHead(200, { "Content-Type": "application/json" });
    r.end("{}");
  },
  malformed: (_q, r) => {
    r.writeHead(200, { "Content-Type": "application/json" });
    r.end("not json");
  },
  oversized: (_q, r) => {
    r.writeHead(200, { "Content-Type": "application/json" });
    r.end("a".repeat(17000));
  },
  redirect: (_q, r) => {
    r.writeHead(302, { Location: "http://127.0.0.1:1/never" });
    r.end();
  },
  html: (_q, r) => {
    r.writeHead(200, { "Content-Type": "text/html" });
    r.end("<html>ALLOW</html>");
  },
};
for (const changed of [
  "effect",
  "decision_id",
  "policy_hash",
  "policy_version",
])
  cases["forged-" + changed] = (q, r) => {
    let raw = "";
    q.on("data", (c) => (raw += c));
    q.on("end", () => {
      const input = JSON.parse(raw).input;
      const decision: Record<string, unknown> = {
        effect: "ALLOW",
        reason_code: "scoped-read",
        decision_id: input.decision_id,
        policy_version: "stage1.v1",
        policy_hash: policyHash(),
      };
      decision[changed] =
        changed === "policy_hash"
          ? "0".repeat(64)
          : changed === "decision_id"
            ? randomUUID()
            : "bogus";
      r.writeHead(200, { "Content-Type": "application/json" });
      r.end(JSON.stringify({ result: decision }));
    });
  };
for (const [name, handler] of Object.entries(cases))
  test(`PDP ${name} response denies with zero upstream calls and unchanged target`, async () => {
    const http = createServer(handler);
    http.listen(0, "127.0.0.1");
    await new Promise<void>((r) => http.once("listening", r));
    const s = createApp({
      databasePath: ":memory:",
      adminKey: "synthetic-fault-injection-test-admin-key",
      policy: new OpaEvaluator({
        url: `http://127.0.0.1:${(http.address() as { port: number }).port}`,
        token: "synthetic-only",
        timeoutMs: 60,
      }),
    });
    const { agent } = s.store.createAgent({
      name: "PDP fault",
      tools: ["database_read"],
      resources: ["customers"],
      sandbox: true,
    });
    let calls = 0;
    s.gateway.connectors.execute = async () => {
      calls++;
      return {};
    };
    try {
      const before = s.store.db.prepare("SELECT * FROM customers").all();
      const result = await s.gateway.submit(agent.id, {
        requestId: randomUUID(),
        tool: "database_read",
        arguments: {},
      });
      assert.equal(result.status, "blocked");
      assert.equal(result.policyEffect, "DENY");
      assert.equal(calls, 0);
      assert.deepEqual(
        s.store.db.prepare("SELECT * FROM customers").all(),
        before,
      );
    } finally {
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
      await s.close();
    }
  });
test("real OPA exposes only authenticated decision and health APIs, never management/data", async () => {
  const url = process.env.OPA_URL!;
  const token = process.env.OPA_TOKEN!;
  for (const [path, method, credential] of [
    ["/v1/data", "GET", ""],
    ["/v1/data/agentbrake/decision", "POST", "wrong"],
    ["/v1/policies", "GET", token],
    ["/v1/policies/injected", "PUT", token],
    ["/v1/data/agentbrake_auth", "GET", token],
    ["/v1/data/agentbrake", "PUT", token],
    ["/v1/data/agentbrake/decision?explain=full", "POST", token],
  ]) {
    const response = await fetch(url + path, {
      method,
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
      },
      ...(["POST", "PUT"].includes(method) ? { body: "{}" } : {}),
    });
    assert.ok(
      [401, 403].includes(response.status),
      `${method} ${path}: ${response.status}`,
    );
    assert.ok(!(await response.text()).includes(token));
  }
});
