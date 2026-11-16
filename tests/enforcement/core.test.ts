import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../../server/app.js";
import { OpaEvaluator } from "../../server/policy/opa-client.js";
import type { TaskGrant } from "../../server/policy/contracts.js";
import type {
  PolicyEvaluator,
  PolicyInput,
} from "../../server/policy/contracts.js";

export function fixture(options: Record<string, unknown> = {}) {
  const system = createApp({
    databasePath: ":memory:",
    adminKey: "ephemeral-stage-one-admin-key-never-exported",
    ...options,
  });
  const { agent, token } = system.store.createAgent({
    name: "Stage one fixture",
    tools: [
      "database_read",
      "database_update",
      "github_read_file",
      "github_create_issue",
    ],
    resources: ["customers", "agentbrake/sandbox"],
    sandbox: true,
  });
  let calls = 0;
  const execute = system.gateway.connectors.execute.bind(
    system.gateway.connectors,
  );
  system.gateway.connectors.execute = async (record) => {
    calls++;
    return execute(record);
  };
  const state = () =>
    system.store.db.prepare("SELECT * FROM customers ORDER BY id").all();
  const send = (tool = "database_read", args: Record<string, unknown> = {}) =>
    system.gateway.submit(agent.id, {
      requestId: randomUUID(),
      tool,
      arguments: args,
    });
  const grant: TaskGrant = {
    id: randomUUID(),
    agent_id: agent.id,
    tenant: "local",
    human_owner: "local-administrator",
    actions: agent.tools,
    resources: agent.resources,
    environments: ["sandbox"],
    expires_at_ms: Date.now() + 60000,
    revoked: false,
    policy_version: "stage2.v1",
    max_calls: 100,
    used_calls: 0,
    max_rows: 100,
  };
  const changeGrant = (fields: Partial<TaskGrant>) => {
    const current = system.store.agent(agent.id)!;
    system.store.saveAgent({
      ...current,
      grant: { ...grant, ...fields },
    } as typeof current);
  };
  return {
    ...system,
    agent,
    token,
    state,
    send,
    changeGrant,
    calls: () => calls,
  };
}

test("real OPA allows a scoped read and upstream observes exactly one invocation", async () => {
  const s = fixture();
  try {
    const result = await s.send();
    assert.equal(result.status, "allowed");
    assert.equal(s.calls(), 1);
    assert.equal((result.result as { rows: unknown[] }).rows.length, 4);
  } finally {
    await s.close();
  }
});
test("expired grant is denied before the upstream boundary; target is unchanged", async () => {
  const s = fixture();
  try {
    const before = s.state();
    s.changeGrant({ expires_at_ms: Date.now() - 1 });
    const result = await s.send();
    assert.equal(result.status, "blocked");
    assert.equal(s.calls(), 0);
    assert.deepEqual(s.state(), before);
  } finally {
    await s.close();
  }
});
test("revoked grant is denied even when the agent itself is active", async () => {
  const s = fixture();
  try {
    s.changeGrant({ revoked: true });
    assert.equal((await s.send()).status, "blocked");
    assert.equal(s.calls(), 0);
  } finally {
    await s.close();
  }
});
test("unavailable OPA never falls back to legacy allow", async () => {
  const s = fixture({
    policy: new OpaEvaluator({
      url: "http://127.0.0.1:1",
      token: "synthetic-pdp-token",
    }),
  });
  try {
    const before = s.state();
    assert.equal((await s.send()).status, "blocked");
    assert.equal(s.calls(), 0);
    assert.deepEqual(s.state(), before);
  } finally {
    await s.close();
  }
});
test("PDP decision cannot override missing grant or caller-supplied identity", async () => {
  const s = fixture();
  try {
    const agent = s.store.agent(s.agent.id)!;
    delete (agent as unknown as Record<string, unknown>).grant;
    s.store.saveAgent(agent);
    assert.equal((await s.send()).status, "blocked");
    await assert.rejects(
      s.gateway.submit(s.agent.id, {
        requestId: randomUUID(),
        tool: "database_read",
        arguments: {},
        agent_id: s.agent.id,
        tenant: "local",
      }),
    );
    assert.equal(s.calls(), 0);
  } finally {
    await s.close();
  }
});
test("unknown, traversal, destructive, and obfuscated SQL never call upstream", async () => {
  const s = fixture();
  try {
    const before = s.state();
    for (const [tool, args] of [
      ["database_delete", {}],
      ["postgres_drop_table", {}],
      ["github_force_push", {}],
      ["github_read_file", { repo: "other/repo", path: "README.md" }],
      ["github_read_file", { repo: "agentbrake/sandbox", path: "../.env" }],
      ["database_read", { sql: "SEL/**/ECT 1; DROP TABLE customers" }],
    ] as [string, Record<string, unknown>][])
      assert.equal((await s.send(tool, args)).status, "blocked");
    assert.equal(s.calls(), 0);
    assert.deepEqual(s.state(), before);
  } finally {
    await s.close();
  }
});
test("approval-required writes produce no upstream call before review", async () => {
  const s = fixture();
  try {
    const before = s.state();
    assert.equal(
      (await s.send("database_update", { id: 1, status: "paused" })).status,
      "pending",
    );
    assert.equal(s.calls(), 0);
    assert.deepEqual(s.state(), before);
  } finally {
    await s.close();
  }
});

test("simultaneous distinct reads both succeed within quota", async () => {
  const s = fixture();
  try {
    const results = await Promise.all([s.send(), s.send()]);
    assert.deepEqual(
      results.map((r) => r.status),
      ["allowed", "allowed"],
    );
    assert.equal(s.calls(), 2);
  } finally {
    await s.close();
  }
});

test("a real configured destination is denied before connector dispatch", async () => {
  const s = fixture({
    connections: {
      databaseUrl: "postgres://synthetic:synthetic@127.0.0.1:1/never-connect",
    },
  });
  try {
    const a = s.store.agent(s.agent.id)!;
    a.sandbox = false;
    s.store.saveAgent(a);
    assert.equal(
      (await s.send("database_update", { id: 1, status: "paused" })).rule,
      "live-integration-disabled",
    );
    assert.equal(s.calls(), 0);
  } finally {
    await s.close();
  }
});

test("policy revision changes invalidate pending human review", async () => {
  const s = fixture();
  try {
    const pending = await s.send("database_update", {
      id: 1,
      status: "paused",
    });
    s.store.setPolicies(s.store.settings().policies);
    assert.equal(
      (await s.gateway.approve(pending.id, true)).rule,
      "approval-context-changed",
    );
    assert.equal(s.calls(), 0);
  } finally {
    await s.close();
  }
});

test("concurrent identical request IDs execute once", async () => {
  const s = fixture();
  try {
    const input = {
      requestId: randomUUID(),
      tool: "database_read",
      arguments: {},
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => s.gateway.submit(s.agent.id, input)),
    );
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    assert.equal(s.calls(), 1);
  } finally {
    await s.close();
  }
});

test("quota is consumed at dispatch, including concurrent calls", async () => {
  const s = fixture();
  try {
    s.changeGrant({ max_calls: 1 });
    const results = await Promise.all([s.send(), s.send()]);
    assert.equal(results.filter((r) => r.status === "allowed").length, 1);
    assert.equal(s.calls(), 1);
  } finally {
    await s.close();
  }
});

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
for (const change of ["revoke", "expiry", "policy"] as const)
  test(`authority ${change} during real PDP evaluation cannot authorize a stale write`, async () => {
    const ready = latch(),
      release = latch();
    const opa = new OpaEvaluator();
    const policy: PolicyEvaluator = {
      evaluate: async (input: PolicyInput) => {
        const answer = await opa.evaluate(input);
        ready.resolve();
        await release.promise;
        return answer;
      },
    };
    const s = fixture({ policy });
    try {
      const pending = s.send("database_update", { id: 1, status: "paused" });
      await ready.promise;
      if (change === "policy") s.store.setPolicies(s.store.settings().policies);
      else
        s.changeGrant(
          change === "expiry"
            ? { expires_at_ms: Date.now() - 1 }
            : { revoked: true },
        );
      release.resolve();
      const result = await pending;
      assert.equal(result.status, "blocked");
      assert.equal(s.calls(), 0);
    } finally {
      release.resolve();
      await s.close();
    }
  });
test("row budget is enforced by real OPA", async () => {
  const s = fixture();
  try {
    s.changeGrant({ max_rows: 2 });
    const result = await s.send("database_read", { limit: 3 });
    assert.equal(result.policyEffect, "DENY");
    assert.equal(result.rule, "row-budget");
    assert.equal(s.calls(), 0);
  } finally {
    await s.close();
  }
});
test("eight in-flight decisions bound concurrency and the reservation is released", async () => {
  const ready = latch(),
    release = latch();
  let entered = 0;
  const opa = new OpaEvaluator();
  const s = fixture({
    policy: {
      evaluate: async (input: PolicyInput) => {
        if (++entered === 8) ready.resolve();
        await release.promise;
        return opa.evaluate(input);
      },
    },
  });
  try {
    const promises = Array.from({ length: 8 }, () => s.send());
    await ready.promise;
    await assert.rejects(s.send(), { status: 429 });
    assert.equal(s.calls(), 0);
    release.resolve();
    assert.ok(
      (await Promise.all(promises)).every((r) => r.status === "allowed"),
    );
    assert.equal((await s.send()).status, "allowed");
    assert.equal(s.calls(), 9);
  } finally {
    release.resolve();
    await s.close();
  }
});
test("per-agent rate limit rejects the 121st request without dispatch", async () => {
  const s = fixture();
  try {
    for (let i = 0; i < 120; i++)
      assert.equal((await s.send("unknown_tool")).status, "blocked");
    await assert.rejects(s.send(), { status: 429 });
    assert.equal(s.calls(), 0);
  } finally {
    await s.close();
  }
});
test("oversized and deep direct envelopes are bounded before authorization", async () => {
  const s = fixture();
  try {
    let nested: unknown = {};
    for (let i = 0; i < 16; i++) nested = { x: nested };
    await assert.rejects(s.send("database_read", { nested }), { status: 400 });
    await assert.rejects(s.send("database_read", { text: "x".repeat(40000) }), {
      status: 413,
    });
    assert.equal(s.calls(), 0);
  } finally {
    await s.close();
  }
});
