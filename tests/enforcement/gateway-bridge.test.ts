import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createApp } from "../../server/app.js";
import {
  createGatewayBridge,
  RemoteGateway,
} from "../../server/gateway-bridge.js";
test("separate control/agent surfaces and authenticated bridge preserve team proof and single execution", async () => {
  const key = "local-private-bridge-credential-000000000000000000";
  const s = createApp({
    databasePath: ":memory:",
    adminKey: "gateway-binding-key-0000000000000000000",
    surface: "gateway",
  });
  const server = s.app.listen(0, "127.0.0.1"),
    bridge = createGatewayBridge(s.gateway, key).listen(0, "127.0.0.1");
  await Promise.all([once(server, "listening"), once(bridge, "listening")]);
  const base =
      "http://127.0.0.1:" + (server.address() as { port: number }).port,
    url = "http://127.0.0.1:" + (bridge.address() as { port: number }).port;
  const client = new RemoteGateway(url, key);
  const operators = [
    {
      id: "owner",
      name: "Owner",
      tenant: "local",
      role: "administrator" as const,
      key: "local-owner-login-000000000000000000000",
    },
  ];
  const control = createApp({
    databasePath: ":memory:",
    adminKey: "control-session-binding-0000000000000000",
    operators,
    surface: "control",
    gateway: client,
  });
  const controlServer = control.app.listen(0, "127.0.0.1");
  await once(controlServer, "listening");
  const controlUrl =
    "http://127.0.0.1:" + (controlServer.address() as { port: number }).port;
  const post = (path: string, body: unknown, token?: string) =>
    fetch(url + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (
        await fetch(base + "/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "gateway-binding-key-0000000000000000000",
          }),
        })
      ).status,
      404,
    );
    assert.equal((await fetch(controlUrl + "/api/actions")).status, 404);
    assert.equal(
      (await fetch(controlUrl + "/mcp", { method: "POST" })).status,
      404,
    );
    assert.equal((await post("/review", { id: randomUUID() })).status, 401);
    assert.equal(
      (await post("/review", { id: randomUUID() }, "bad-key")).status,
      401,
    );
    const { agent } = s.store.createAgent({
      name: "Bridge task",
      tools: ["database_update"],
      resources: ["customers"],
      sandbox: true,
      ownerId: "owner",
    });
    const pending = await client.submit(agent.id, {
      requestId: randomUUID(),
      tool: "database_update",
      arguments: { id: 1, status: "paused" },
    });
    const review = await client.review(pending.id);
    const reviewer = {
      actor: {
        id: "reviewer",
        name: "Reviewer",
        tenant: "local",
        role: "approver" as const,
      },
      team: true,
      proof: review.proof,
    };
    assert.equal(
      (
        await post(
          "/approve",
          {
            id: pending.id,
            approve: true,
            reviewer: { ...reviewer, team: false },
          },
          key,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          "/approve",
          {
            id: pending.id,
            approve: true,
            reviewer: {
              ...reviewer,
              actor: { ...reviewer.actor, tenant: "other" },
            },
          },
          key,
        )
      ).status,
      400,
    );
    await assert.rejects(
      client.approve(pending.id, true, {
        ...reviewer,
        actor: { ...reviewer.actor, id: "owner" },
      }),
      (error) => (error as { status: number }).status === 403,
    );
    assert.equal(
      s.store.db.prepare("SELECT version FROM customers WHERE id=1").get()!
        .version,
      0,
    );
    assert.equal(
      (await client.approve(pending.id, true, reviewer)).status,
      "allowed",
    );
    await assert.rejects(
      client.approve(pending.id, true, reviewer),
      (error) => (error as { status: number }).status === 409,
    );
    assert.equal(
      s.store.db.prepare("SELECT version FROM customers WHERE id=1").get()!
        .version,
      1,
    );
    assert.throws(() => new RemoteGateway("https://example.com", key));
  } finally {
    for (const http of [server, bridge, controlServer]) {
      http.closeAllConnections();
      http.close();
    }
    await control.close();
    await s.close();
  }
});
