import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../../server/app.js";
import { OpaEvaluator } from "../../server/policy/opa-client.js";
import type { PolicyInput } from "../../server/policy/contracts.js";

async function fixture(options: Record<string, unknown> = {}) {
  const s = createApp({
    databasePath: ":memory:",
    adminKey: "synthetic-rest-audit-administrator-key",
    ...options,
  });
  const { agent, token } = s.store.createAgent({
    name: "REST audit",
    tools: ["database_read"],
    resources: ["customers"],
    sandbox: true,
  });
  let calls = 0;
  const execute = s.gateway.connectors.execute.bind(s.gateway.connectors);
  s.gateway.connectors.execute = async (a) => {
    calls++;
    return execute(a);
  };
  const http = s.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => http.once("listening", r));
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const send = (raw: string, credential = token) =>
    fetch(url + "/api/actions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
        "X-Correlation-ID": "untrusted-correlation",
      },
      body: raw,
    });
  return {
    ...s,
    agent,
    token,
    send,
    calls: () => calls,
    stop: async () => {
      await new Promise<void>((r) => http.close(() => r()));
      await s.close();
    },
  };
}
for (const variant of ["json", "envelope", "depth", "size", "auth"] as const)
  test(`REST ${variant} rejection has one redacted correlated audit event and zero calls`, async () => {
    const s = await fixture();
    try {
      const sentinel = "sk-" + "SYNTHETIC-REST-FIXTURE".repeat(2);
      let raw = '{"secret":"' + sentinel + '",';
      let expected = 400;
      if (variant === "envelope") raw = JSON.stringify({ tenant: sentinel });
      if (variant === "depth") {
        let nested: unknown = { secret: sentinel };
        for (let i = 0; i < 16; i++) nested = { nested };
        raw = JSON.stringify({
          requestId: randomUUID(),
          tool: "database_read",
          arguments: { nested },
        });
      }
      if (variant === "size") {
        raw = JSON.stringify({ text: sentinel + "x".repeat(40000) });
        expected = 413;
      }
      if (variant === "auth") {
        raw = JSON.stringify({
          requestId: randomUUID(),
          tool: "database_read",
          arguments: {},
        });
        expected = 401;
      }
      const before = s.store.auditTrail().length,
        response = await s.send(
          raw,
          variant === "auth" ? "invalid-" + sentinel : s.token,
        );
      assert.equal(response.status, expected);
      const entries = s.store
        .auditTrail()
        .slice(before)
        .map((row) => JSON.parse(row.data as string));
      assert.equal(entries.length, 1);
      assert.equal(entries[0].type, "rest.rejected");
      const detail = entries[0].details;
      assert.equal(detail.status, expected);
      assert.match(detail.correlationId, /^[a-f0-9-]{36}$/);
      assert.equal(
        response.headers.get("x-correlation-id"),
        detail.correlationId,
      );
      assert.equal(detail.agentId, variant === "auth" ? undefined : s.agent.id);
      assert.ok(!JSON.stringify(entries).includes(sentinel));
      assert.ok(!JSON.stringify(entries).includes(s.token));
      assert.ok(!JSON.stringify(entries).includes("untrusted-correlation"));
      assert.equal(s.calls(), 0);
    } finally {
      await s.stop();
    }
  });
test("REST rate limit is audited once with no denied dispatch", async () => {
  const s = await fixture();
  try {
    for (let i = 0; i < 120; i++)
      await s.send(
        JSON.stringify({
          requestId: randomUUID(),
          tool: "not_registered",
          arguments: {},
        }),
      );
    const before = s.store.auditTrail().length;
    const response = await s.send(
      JSON.stringify({
        requestId: randomUUID(),
        tool: "database_read",
        arguments: {},
      }),
    );
    assert.equal(response.status, 429);
    const entries = s.store
      .auditTrail()
      .slice(before)
      .map((r) => JSON.parse(r.data as string));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, "rest.rejected");
    assert.equal(entries[0].details.agentId, s.agent.id);
    assert.equal(s.calls(), 0);
  } finally {
    await s.stop();
  }
});
test("REST rejection remains failed when the audit sink fails; no raw details escape", async () => {
  const s = await fixture();
  try {
    s.store.db.exec(
      "CREATE TRIGGER fail_rejection BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'sensitive-internal-diagnostic'); END;",
    );
    const response = await s.send("{bad json");
    assert.equal(response.status, 503);
    assert.ok(
      !(await response.text()).includes("sensitive-internal-diagnostic"),
    );
    assert.equal(s.calls(), 0);
  } finally {
    await s.stop();
  }
});

test("REST replay conflicts are audited without another invocation", async () => {
  const s = await fixture();
  try {
    const requestId = randomUUID();
    assert.equal(
      (
        await s.send(
          JSON.stringify({
            requestId,
            tool: "database_read",
            arguments: { limit: 1 },
          }),
        )
      ).status,
      200,
    );
    const before = s.store.auditTrail().length;
    const response = await s.send(
      JSON.stringify({
        requestId,
        tool: "database_read",
        arguments: { limit: 2 },
      }),
    );
    assert.equal(response.status, 409);
    const rows = s.store
      .auditTrail()
      .slice(before)
      .map((r) => JSON.parse(r.data as string));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "rest.rejected");
    assert.equal(rows[0].details.reason, "conflict");
    assert.equal(s.calls(), 1);
  } finally {
    await s.stop();
  }
});
test("REST concurrency refusal is audited while eight legitimate decisions are waiting", async () => {
  let entered = 0,
    ready!: () => void,
    release!: () => void;
  const reached = new Promise<void>((r) => (ready = r)),
    hold = new Promise<void>((r) => (release = r)),
    opa = new OpaEvaluator();
  const s = await fixture({
    policy: {
      evaluate: async (input: PolicyInput) => {
        if (++entered === 8) ready();
        await hold;
        return opa.evaluate(input);
      },
    },
  });
  try {
    const requests = Array.from({ length: 8 }, () =>
      s.send(
        JSON.stringify({
          requestId: randomUUID(),
          tool: "database_read",
          arguments: {},
        }),
      ),
    );
    await reached;
    const before = s.store.auditTrail().length;
    const response = await s.send(
      JSON.stringify({
        requestId: randomUUID(),
        tool: "database_read",
        arguments: {},
      }),
    );
    assert.equal(response.status, 429);
    const rows = s.store
      .auditTrail()
      .slice(before)
      .map((r) => JSON.parse(r.data as string));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "rest.rejected");
    assert.equal(s.calls(), 0);
    release();
    for (const result of await Promise.all(requests))
      assert.equal((await result.json()).status, "allowed");
    assert.equal(s.calls(), 8);
  } finally {
    release();
    await s.stop();
  }
});
