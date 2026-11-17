import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../../server/app.js";
async function fixture() {
  const s = createApp({
    databasePath: ":memory:",
    adminKey: "preview-test-binding-key-0000000000000",
  });
  const { agent } = s.store.createAgent({
    name: "Preview fixture",
    tools: ["database_update"],
    resources: ["customers"],
    sandbox: true,
  });
  const action = await s.gateway.submit(agent.id, {
    requestId: randomUUID(),
    tool: "database_update",
    arguments: { id: 1, status: "paused" },
  });
  return { s, agent, action };
}
test("approval shows minimal actual before/after state without disclosing review data to the agent", async () => {
  const { s, agent, action } = await fixture();
  try {
    assert.equal(action.status, "pending");
    assert.equal(action.preview, undefined);
    assert.equal(action.review, undefined);
    const review = await s.gateway.review(action.id);
    assert.deepEqual(review.action.preview, {
      kind: "database-update",
      summary: "Change one fixture customer status",
      details: {
        template: "customer-status-v1",
        before: { id: 1, status: "active", version: 0 },
        after: { id: 1, status: "paused", version: 1 },
        maximumRows: 1,
      },
    });
    assert.equal(
      (await s.gateway.actionForAgent(agent.id, action.id)).preview,
      undefined,
    );
    assert.equal(
      s.store.db.prepare("SELECT version FROM customers WHERE id=1").get()!
        .version,
      0,
    );
  } finally {
    await s.close();
  }
});
test("changed target since review is blocked before mutation dispatch", async () => {
  const { s, action } = await fixture();
  try {
    s.store.db
      .prepare("UPDATE customers SET version=version+1 WHERE id=1")
      .run();
    let calls = 0;
    const execute = s.gateway.connectors.execute.bind(s.gateway.connectors);
    s.gateway.connectors.execute = async (a) => {
      calls++;
      return execute(a);
    };
    const result = await s.gateway.approve(action.id, true);
    assert.equal(result.status, "blocked");
    assert.equal(result.rule, "preview-changed");
    assert.equal(calls, 0);
    assert.equal(
      s.store.db.prepare("SELECT status FROM customers WHERE id=1").get()!
        .status,
      "active",
    );
  } finally {
    await s.close();
  }
});
test("concurrent idempotent submissions never expose human review data to the agent", async () => {
  const { s, agent } = await fixture();
  try {
    const request = {
      requestId: randomUUID(),
      tool: "database_update",
      arguments: { id: 2, status: "paused" },
    };
    const results = await Promise.all([
      s.gateway.submit(agent.id, request),
      s.gateway.submit(agent.id, request),
    ]);
    for (const action of results) {
      assert.equal(action.preview, undefined);
      assert.equal(action.review, undefined);
    }
  } finally {
    await s.close();
  }
});
test("target compare-and-set rejects a race after final preview with no overwrite", async () => {
  const { s, action } = await fixture();
  try {
    const execute = s.gateway.connectors.execute.bind(s.gateway.connectors);
    s.gateway.connectors.execute = async (a) => {
      s.store.db
        .prepare("UPDATE customers SET version=version+1 WHERE id=1")
        .run();
      return execute(a);
    };
    const result = await s.gateway.approve(action.id, true);
    assert.equal(result.status, "failed");
    assert.equal(result.executionOutcome, "not-applied");
    assert.equal(result.rule, "target-changed");
    assert.deepEqual(
      {
        ...s.store.db
          .prepare("SELECT status,version FROM customers WHERE id=1")
          .get(),
      },
      { status: "active", version: 1 },
    );
  } finally {
    await s.close();
  }
});
