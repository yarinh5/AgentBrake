import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../../server/app.js";
test("only administrator issues bounded structured task grants and revokes future dispatch", async () => {
  const s = createApp({
    databasePath: ":memory:",
    adminKey: "task-fixture-administrator-key-12345",
  });
  const listener = s.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => listener.once("listening", r));
  const base =
    "http://127.0.0.1:" + (listener.address() as { port: number }).port;
  try {
    const { agent, token } = s.store.createAgent({
      name: "task fixture",
      tools: ["database_read"],
      resources: ["customers"],
      sandbox: true,
    });
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "task-fixture-administrator-key-12345" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const task = {
      actions: ["database_read"],
      resources: ["customers"],
      environments: ["sandbox"],
      expiresInSeconds: 120,
      maxCalls: 1,
      maxRows: 2,
    };
    const issue = async (
      headers: Record<string, string>,
      payload: unknown = task,
    ) =>
      fetch(base + "/api/agents/" + agent.id + "/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(payload),
      });
    assert.equal(
      (await issue({ Authorization: "Bearer " + token })).status,
      401,
    );
    assert.equal(
      (
        await issue(
          { Cookie: cookie },
          { ...task, resources: ["real/customers"] },
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await issue(
          { Cookie: cookie },
          { ...task, environments: ["production"] },
        )
      ).status,
      400,
    );
    const created = await issue({ Cookie: cookie });
    assert.equal(created.status, 201);
    const grant = await created.json();
    assert.notEqual(grant.id, agent.grant!.id);
    assert.equal(grant.used_calls, 0);
    const denied = await s.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool: "database_read",
      arguments: { limit: 3 },
    });
    assert.equal(denied.status, "blocked");
    const read = await s.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool: "database_read",
      arguments: { limit: 2 },
    });
    assert.equal(read.status, "allowed");
    const quota = await s.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool: "database_read",
      arguments: { limit: 1 },
    });
    assert.equal(quota.status, "blocked");
    assert.equal((await issue({ Cookie: cookie })).status, 201);
    assert.equal(
      (
        await fetch(base + "/api/agents/" + agent.id + "/grant/revoke", {
          method: "POST",
          headers: { Cookie: cookie },
        })
      ).status,
      200,
    );
    const revoked = await s.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool: "database_read",
      arguments: { limit: 1 },
    });
    assert.equal(revoked.status, "blocked");
    assert.equal(s.store.verifyAudit(), true);
  } finally {
    listener.close();
    await s.close();
  }
});
