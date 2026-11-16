import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFixtureTarget } from "../../server/fixture-target.js";
import { createApp } from "../../server/app.js";

test("separate HTTP target observes real mediated read, zero blocked writes, and no credential forwarding", async () => {
  const targetToken = "synthetic-target-key-at-least-32-characters",
    observer = "synthetic-observer-key-at-least-32-characters";
  const target = createFixtureTarget(targetToken, observer);
  const http = target.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => http.once("listening", r));
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const s = createApp({
    databasePath: ":memory:",
    adminKey: "synthetic-remote-fixture-administrator-key",
    connections: { fixture: { url, token: targetToken } },
  });
  const { agent } = s.store.createAgent({
    name: "Remote fixture",
    tools: ["database_read", "database_update"],
    resources: ["customers"],
    sandbox: true,
  });
  const snapshot = async () =>
    await (
      await fetch(url + "/snapshot", {
        headers: { Authorization: `Bearer ${observer}` },
      })
    ).json();
  try {
    const before = await snapshot();
    const denied = await s.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool: "database_delete",
      arguments: {},
    });
    assert.equal(denied.status, "blocked");
    assert.deepEqual(await snapshot(), before);
    const allowed = await s.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool: "database_read",
      arguments: { limit: 2 },
    });
    assert.equal(allowed.status, "allowed");
    assert.equal((await snapshot()).calls, 1);
    assert.equal((allowed.result as { rows: unknown[] }).rows.length, 2);
    const unauthorized = await fetch(url + "/snapshot", {
      headers: { Authorization: `Bearer ${targetToken}` },
    });
    assert.equal(unauthorized.status, 401);
  } finally {
    await s.close();
    await new Promise<void>((r) => http.close(() => r()));
    await target.close();
  }
});
test("unavailable configured fixture cannot silently fall back to local data", async () => {
  const s = createApp({
    databasePath: ":memory:",
    adminKey: "synthetic-remote-fixture-administrator-key",
    connections: {
      fixture: {
        url: "http://127.0.0.1:1",
        token: "synthetic-target-key-at-least-32-characters",
      },
    },
  });
  try {
    const { agent } = s.store.createAgent({
      name: "No fallback",
      tools: ["database_read"],
      resources: ["customers"],
      sandbox: true,
    });
    const result = await s.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool: "database_read",
      arguments: {},
    });
    assert.equal(result.status, "failed");
    assert.equal(result.result, undefined);
  } finally {
    await s.close();
  }
});
