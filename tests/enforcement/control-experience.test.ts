import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../../server/app.js";
async function fixture() {
  const s = createApp({
    databasePath: ":memory:",
    adminKey: "control-experience-key-0000000000000000",
  });
  const server = s.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "control-experience-key-0000000000000000" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const request = (
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) =>
    fetch(base + path, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    s,
    request,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await s.close();
    },
  };
}
test("activity filters/pagination and policy history return real persisted records with bounded input", async () => {
  const f = await fixture();
  try {
    const { agent } = f.s.store.createAgent({
      name: "Evidence fixture",
      tools: ["database_read", "database_update"],
      resources: ["customers"],
      sandbox: true,
    });
    await f.s.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool: "database_read",
      arguments: { limit: 1 },
    });
    await f.s.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool: "database_update",
      arguments: { id: 1, status: "paused" },
    });
    const response = await f.request(
      "/api/activity?status=pending&limit=1&agentId=" + agent.id,
    );
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.equal(page.total, 1);
    assert.equal(page.items[0].status, "pending");
    assert.equal(page.items[0].result, undefined);
    assert.equal((await f.request("/api/activity?limit=101")).status, 400);
    assert.equal((await f.request("/api/activity?from=garbage")).status, 400);
    assert.equal(
      (await (await f.request("/api/activity?offset=50")).json()).items.length,
      0,
    );
    assert.equal(
      (
        await f.request(
          "/api/policies",
          { reads: "deny", databaseWrites: "approval", githubWrites: "deny" },
          "PUT",
        )
      ).status,
      200,
    );
    const history = await f.request("/api/policies/history");
    assert.equal(history.status, 200);
    const versions = (await history.json()).items;
    assert.equal(versions[0].policies.reads, "deny");
    assert.equal(versions[1].policies.reads, "allow");
  } finally {
    await f.close();
  }
});
test("evidence separates adapter observation from UNKNOWN and exports redacted JSON/CSV without formula execution", async () => {
  const f = await fixture();
  try {
    const { agent } = f.s.store.createAgent({
      name: "Evidence fixture",
      tools: ["database_read", "database_update"],
      resources: ["customers"],
      sandbox: true,
    });
    const allowed = await f.s.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool: "database_read",
      arguments: { limit: 1 },
    });
    const pending = await f.s.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool: "database_update",
      arguments: { id: 1, status: "paused" },
    });
    let res = await f.request("/api/evidence/" + allowed.id);
    assert.equal(res.status, 200);
    const evidence = await res.json();
    assert.equal(evidence.action.result, undefined);
    assert.equal(evidence.execution.observation, "adapter-reported");
    assert.equal(evidence.execution.summary.rowCount, 1);
    assert.equal(evidence.audit.valid, true);
    const exported = await (await f.request("/api/evidence/" + allowed.id + "/export?format=csv")).text();
    for (const field of ["executionOutcome", "resultDisclosure", "resultRetained"]) assert.ok(exported.split("\n")[0].includes(field));
    assert.ok(exported.includes("released"));
    assert.equal(
      (await (await f.request("/api/evidence/" + pending.id)).json()).execution
        .observation,
      "not-dispatched",
    );
    const stored = f.s.store.action(pending.id)!;
    stored.status = "unknown";
    stored.reason = '=HYPERLINK("unsafe")';
    f.s.store.saveAction(stored);
    assert.equal(
      (await (await f.request("/api/evidence/" + pending.id)).json()).execution
        .observation,
      "unverified",
    );
    const credential = "ghp_" + "A".repeat(32);
    f.s.store.audit("fixture.sensitive", {
      actionId: allowed.id,
      token: credential,
      text: "api_key=" + credential,
    });
    res = await f.request(
      "/api/evidence/" + allowed.id + "/export?format=json",
    );
    assert.equal(res.status, 200);
    assert.ok(!(await res.text()).includes(credential));
    res = await f.request("/api/evidence/" + pending.id + "/export?format=csv");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /\x27=HYPERLINK/);
    const audit = await f.request("/api/audit/export?format=csv");
    assert.equal(audit.status, 200);
    assert.ok(!(await audit.text()).includes(credential));
    assert.equal(
      (await f.request("/api/evidence/" + allowed.id + "/export?format=xml"))
        .status,
      400,
    );
  } finally {
    await f.close();
  }
});
test("Demo Lab submits safe read and blocked SQL through the Gateway with real outcomes", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const execute = f.s.gateway.connectors.execute.bind(f.s.gateway.connectors);
    f.s.gateway.connectors.execute = async (a) => {
      calls++;
      return execute(a);
    };
    let r = await f.request("/api/demo", { scenario: "safe-read" });
    assert.equal(r.status, 200);
    const demo = await r.json();
    assert.equal(demo.actions[0].status, "allowed");
    const creation = f.s.store
      .auditTrail()
      .map((row) => JSON.parse(row.data))
      .find(
        (event) =>
          event.type === "agent.created" &&
          event.details.agentId === demo.actions[0].agentId,
      );
    assert.deepEqual(creation.details.actor, {
      actorId: "local-administrator",
      tenant: "local",
    });
    assert.equal(
      creation.details.correlationId,
      r.headers.get("x-correlation-id"),
    );
    assert.equal(calls, 1);
    r = await f.request("/api/demo", { scenario: "blocked-sql" });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).actions[0].status, "blocked");
    assert.equal(calls, 1);
    assert.equal(
      (await f.request("/api/demo", { scenario: "arbitrary" })).status,
      400,
    );
  } finally {
    await f.close();
  }
});
