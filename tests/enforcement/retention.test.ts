import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../../server/app.js";
test("result retention removes old payloads without deleting audit, pending proof or permitting replay", async () => {
  const s = createApp({
    databasePath: ":memory:",
    adminKey: "retention-test-key-00000000000000000000",
  });
  try {
    const { agent } = s.store.createAgent({
      name: "Retention fixture",
      tools: ["database_read", "database_update"],
      resources: ["customers"],
      sandbox: true,
    });
    const input = {
      requestId: randomUUID(),
      tool: "database_read",
      arguments: { limit: 1 },
    };
    const result = await s.gateway.submit(agent.id, input);
    const pending = await s.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool: "database_update",
      arguments: { id: 1, status: "paused" },
    });
    const reviewed = s.store.action(pending.id)!;
    const stored = s.store.action(result.id)!;
    stored.createdAt = new Date(Date.now() - 48 * 3600000).toISOString();
    s.store.saveAction(stored);
    const audit = s.store.auditTrail();
    assert.equal(
      s.store.pruneResults(new Date(Date.now() - 24 * 3600000).toISOString()),
      1,
    );
    assert.equal(s.store.action(result.id)!.result, undefined);
    assert.equal(s.store.action(result.id)!.executionOutcome, "adapter-reported");
    assert.equal(s.store.action(result.id)!.resultDisclosure, "released", "retention does not rewrite the historical release policy");
    assert.ok(s.store.action(result.id)!.resultPurgedAt);
    assert.deepEqual(s.store.action(pending.id), reviewed);
    assert.deepEqual(s.store.auditTrail(), audit);
    assert.equal(s.store.verifyAudit(), true);
    let calls = 0;
    s.gateway.connectors.execute = async () => {
      calls++;
      throw Error("Must not replay");
    };
    assert.equal((await s.gateway.submit(agent.id, input)).status, "allowed");
    assert.equal(calls, 0);
    assert.equal(s.store.pruneResults(new Date().toISOString()), 0);
  } finally {
    await s.close();
  }
});
