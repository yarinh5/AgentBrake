import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../../server/app.js";
test("policy revision changing between initial approval check and PDP snapshot requires fresh review", async () => {
  const s = createApp({
    databasePath: ":memory:",
    adminKey: "stage2-race-fixture-admin-key",
  });
  try {
    const { agent } = s.store.createAgent({
      name: "race fixture",
      tools: ["database_update"],
      resources: ["customers"],
      sandbox: true,
    });
    const pending = await s.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool: "database_update",
      arguments: { id: 1, status: "paused" },
    });
    assert.equal(pending.status, "pending");
    const settings = s.store.settings.bind(s.store),
      original = s.gateway.connectors.execute.bind(s.gateway.connectors);
    let entered!: () => void,
      release!: () => void,
      calls = 0;
    const ready = new Promise<void>((r) => (entered = r)),
      hold = new Promise<void>((r) => (release = r));
    s.gateway.connectors.execute = async (action) => {
      calls++;
      return original(action);
    };
    (s.store as unknown as { settings: () => unknown }).settings = async () => {
      const value = settings();
      entered();
      await hold;
      s.store.settings = settings;
      return value;
    };
    const approval = s.gateway.approve(pending.id, true);
    await ready;
    s.store.setPolicies({ ...settings().policies });
    release();
    assert.equal((await approval).status, "blocked");
    assert.equal(calls, 0);
    assert.equal(
      s.store.db.prepare("SELECT version FROM customers WHERE id=1").get()!
        .version,
      0,
    );
  } finally {
    await s.close();
  }
});
test("a delayed rejection cannot overwrite a concurrently executed approval", async () => {
  const s = createApp({
    databasePath: ":memory:",
    adminKey: "stage2-race-fixture-admin-key",
  });
  try {
    const { agent } = s.store.createAgent({
      name: "race fixture",
      tools: ["database_update"],
      resources: ["customers"],
      sandbox: true,
    });
    const pending = await s.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool: "database_update",
      arguments: { id: 1, status: "paused" },
    });
    const settings = s.store.settings.bind(s.store);
    let first = true,
      entered!: () => void,
      release!: () => void;
    const ready = new Promise<void>((r) => (entered = r)),
      hold = new Promise<void>((r) => (release = r));
    (s.store as unknown as { settings: () => unknown }).settings = () => {
      const value = settings();
      if (!first) return value;
      first = false;
      entered();
      return hold.then(() => {
        s.store.settings = settings;
        return value;
      });
    };
    const rejection = s.gateway.approve(pending.id, false);
    await ready;
    assert.equal((await s.gateway.approve(pending.id, true)).status, "allowed");
    release();
    await assert.rejects(rejection, (e: any) => e.status === 409);
    assert.equal(s.store.action(pending.id)!.status, "allowed");
    assert.equal(
      s.store.db.prepare("SELECT version FROM customers WHERE id=1").get()!
        .version,
      1,
    );
  } finally {
    await s.close();
  }
});
