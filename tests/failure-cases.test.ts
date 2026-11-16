import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";

const make = () => {
  const system = createApp({
    databasePath: ":memory:",
    adminKey: "a-local-test-key-long-enough-for-setup",
  });
  const { agent } = system.store.createAgent({
    name: "Safety test",
    tools: ["database_read", "database_update", "github_create_issue"],
    resources: ["customers", "agentbrake/sandbox"],
    sandbox: true,
  });
  const action = (tool: string, args: object) =>
    system.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool,
      arguments: args,
    });
  return { ...system, agent, action };
};
test("a queued approval cannot survive a change to its destination binding key", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agentbrake-binding-"));
  const databasePath = join(directory, "state.db");
  const adminKey = "a-local-test-key-long-enough-for-setup";
  const first = createApp({
    databasePath,
    adminKey,
  });
  const { agent } = first.store.createAgent({
    name: "Bound identity",
    tools: ["database_update"],
    resources: ["customers"],
    sandbox: true,
  });
  const pending = await first.gateway.submit(agent.id, {
    requestId: randomUUID(),
    tool: "database_update",
    arguments: { id: 1, status: "paused" },
  });
  await first.close();
  const second = createApp({
    databasePath,
    adminKey: adminKey + "-rotated",
  });
  try {
    const outcome = await second.gateway.approve(pending.id, true);
    assert.equal(outcome.status, "blocked");
    assert.equal(outcome.rule, "destination-changed");
  } finally {
    await second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("expired approval never updates the destination record", async () => {
  const s = make();
  try {
    const pending = await s.action("database_update", {
      id: 1,
      status: "paused",
    });
    pending.expiresAt = "2000-01-01T00:00:00.000Z";
    s.store.saveAction(pending);
    assert.equal(
      (await s.gateway.approve(pending.id, true)).rule,
      "approval-expired",
    );
    assert.equal(
      s.store.db.prepare("SELECT status FROM customers WHERE id=1").get()!
        .status,
      "active",
    );
  } finally {
    await s.close();
  }
});
test("audit storage failure prevents dispatch and cannot turn into cached success", async () => {
  const s = make();
  try {
    s.store.db.exec(
      "CREATE TRIGGER audit_unavailable BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'disk unavailable'); END;",
    );
    const input = {
      requestId: randomUUID(),
      tool: "database_read",
      arguments: {},
    };
    await assert.rejects(s.gateway.submit(s.agent.id, input));
    assert.notEqual(
      (await s.gateway.submit(s.agent.id, input)).status,
      "allowed",
    );
    assert.equal(s.store.agent(s.agent.id)!.tainted, false);
  } finally {
    await s.close();
  }
});
test("audit is append-only and exported entries verify", async () => {
  const s = make();
  try {
    await s.action("database_read", {});
    assert.equal(s.store.verifyAudit(), true);
    assert.throws(() => s.store.db.exec("DELETE FROM audit"));
    assert.throws(() => s.store.db.exec("UPDATE audit SET hash='changed'"));
  } finally {
    await s.close();
  }
});
test("an approved sandbox issue is created exactly once", async () => {
  const s = make();
  try {
    const pending = await s.action("github_create_issue", {
      repo: "agentbrake/sandbox",
      title: "Release check",
      body: "Review this release",
    });
    assert.equal(
      s.store.db.prepare("SELECT COUNT(*) AS count FROM sandbox_issues").get()!
        .count,
      0,
    );
    assert.equal((await s.gateway.approve(pending.id, true)).status, "allowed");
    await assert.rejects(s.gateway.approve(pending.id, true));
    assert.equal(
      s.store.db.prepare("SELECT COUNT(*) AS count FROM sandbox_issues").get()!
        .count,
      1,
    );
  } finally {
    await s.close();
  }
});
