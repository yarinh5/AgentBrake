import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../../server/app.js";

const operators = [
  {
    id: "owner",
    name: "Fixture owner",
    tenant: "local",
    role: "administrator",
    key: "fixture-owner-key-00000000000000000000000",
  },
  {
    id: "reviewer",
    name: "Fixture reviewer",
    tenant: "local",
    role: "approver",
    key: "fixture-reviewer-key-00000000000000000000",
  },
  {
    id: "reader",
    name: "Fixture reader",
    tenant: "local",
    role: "viewer",
    key: "fixture-reader-key-0000000000000000000000",
  },
  {
    id: "foreign",
    name: "Other tenant",
    tenant: "other",
    role: "administrator",
    key: "fixture-foreign-key-000000000000000000000",
  },
] as const;
async function fixture() {
  const system = createApp({
    databasePath: ":memory:",
    adminKey: "fixture-team-binding-key-0000000000000000",
    operators: [...operators],
  });
  const server = system.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const request = async (
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) => {
    const response = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: await response.json(),
      headers: response.headers,
    };
  };
  const login = async (id: string) => {
    const r = await request(
      "/api/login",
      {},
      { key: operators.find((o) => o.id === id)!.key },
    );
    assert.equal(r.status, 200);
    return {
      Cookie: r.headers.get("set-cookie")!.split(";")[0],
      "X-AB-CSRF": r.body.csrfToken as string,
    };
  };
  try {
    const owner = await login("owner"),
      reviewer = await login("reviewer"),
      reader = await login("reader");
    const made = await request("/api/agents", owner, {
      name: "Bound task",
      tools: ["database_update"],
      resources: ["customers"],
      sandbox: true,
    });
    assert.equal(made.status, 201);
    const pending = await request(
      "/api/actions",
      { Authorization: "Bearer " + made.body.token },
      {
        requestId: randomUUID(),
        tool: "database_update",
        arguments: { id: 1, status: "paused" },
      },
    );
    assert.equal(pending.body.status, "pending");
    const before = system.store.db
      .prepare("SELECT * FROM customers WHERE id=1")
      .get();
    let calls = 0;
    const execute = system.gateway.connectors.execute.bind(
      system.gateway.connectors,
    );
    system.gateway.connectors.execute = async (action) => {
      calls++;
      return execute(action);
    };
    return {
      system,
      request,
      owner,
      reviewer,
      reader,
      agent: made.body,
      pending: pending.body,
      before,
      calls: () => calls,
      close: async () => {
        server.close();
        await system.close();
      },
    };
  } catch (error) {
    server.close();
    await system.close();
    throw error;
  }
}
test("team review binds the task owner and requires a separate authorized human; one execution under replay/race", async () => {
  const f = await fixture();
  try {
    assert.equal(f.agent.agent.grant.human_owner, "owner");
    const review = await f.request(
      "/api/approvals/" + f.pending.id,
      f.reviewer,
    );
    assert.equal(review.status, 200);
    const body = { decision: "approve", proof: review.body.proof };
    assert.equal(
      (await f.request("/api/approvals/" + f.pending.id, f.owner, body)).status,
      403,
    );
    assert.equal(
      (await f.request("/api/approvals/" + f.pending.id, f.reader, body))
        .status,
      403,
    );
    assert.equal(
      (
        await f.request(
          "/api/approvals/" + f.pending.id,
          { Authorization: "Bearer " + f.agent.token },
          body,
        )
      ).status,
      401,
    );
    assert.equal(f.calls(), 0);
    assert.deepEqual(
      f.system.store.db.prepare("SELECT * FROM customers WHERE id=1").get(),
      f.before,
    );
    const results = await Promise.all([
      f.request("/api/approvals/" + f.pending.id, f.reviewer, body),
      f.request("/api/approvals/" + f.pending.id, f.reviewer, body),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(f.calls(), 1);
    assert.equal(
      f.system.store.action(f.pending.id)!.approvalReceipt!.actorId,
      "reviewer",
    );
    assert.equal(
      (await f.request("/api/approvals/" + f.pending.id, f.reviewer, body))
        .status,
      409,
    );
  } finally {
    await f.close();
  }
});
test("team control rejects missing CSRF, missing/swapped review proof and action edits after review", async () => {
  const f = await fixture();
  try {
    const path = "/api/approvals/" + f.pending.id,
      review = await f.request(path, f.reviewer);
    assert.equal(
      (
        await f.request(
          path,
          { Cookie: f.reviewer.Cookie },
          { decision: "approve", proof: review.body.proof },
        )
      ).status,
      403,
    );
    assert.equal(
      (await f.request(path, f.reviewer, { decision: "approve" })).status,
      400,
    );
    assert.equal(
      (
        await f.request(path, f.reviewer, {
          decision: "approve",
          proof: { ...review.body.proof, nonce: randomUUID() },
        })
      ).status,
      409,
    );
    const changed = f.system.store.action(f.pending.id)!;
    changed.arguments = { id: 2, status: "paused" };
    f.system.store.saveAction(changed);
    assert.equal(
      (
        await f.request(path, f.reviewer, {
          decision: "approve",
          proof: review.body.proof,
        })
      ).status,
      409,
    );
    assert.equal(f.calls(), 0);
    assert.deepEqual(
      f.system.store.db.prepare("SELECT * FROM customers WHERE id=1").get(),
      f.before,
    );
  } finally {
    await f.close();
  }
});
test("team roles and tenant checks protect control/audit; logout revokes the session", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.request("/api/login", {}, { key: operators[3].key })).status,
      403,
    );
    assert.equal(
      (
        await f.request("/api/audit/export", {
          "X-AB-Tenant": "other",
          ...f.reader,
        })
      ).status,
      403,
    );
    assert.equal((await f.request("/api/audit/export", f.reader)).status, 200);
    assert.equal(
      (await f.request("/api/control", f.reader, { paused: true })).status,
      403,
    );
    assert.equal(
      (
        await f.request("/api/agents", f.reviewer, {
          name: "Forbidden",
          tools: ["database_read"],
          resources: ["customers"],
          sandbox: true,
        })
      ).status,
      403,
    );
    assert.equal((await f.request("/api/logout", f.reviewer, {})).status, 200);
    assert.equal(
      (await f.request("/api/audit/export", f.reviewer)).status,
      401,
    );
  } finally {
    await f.close();
  }
});

test("human rejection audit retains the authenticated reviewer receipt without dispatch", async () => {
  const f = await fixture();
  try {
    const path = "/api/approvals/" + f.pending.id;
    const review = await f.request(path, f.reviewer);
    const rejected = await f.request(path, f.reviewer, {
      decision: "reject",
      proof: review.body.proof,
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, "blocked");
    assert.equal(f.calls(), 0);
    const event = f.system.store
      .auditTrail()
      .map((r) => JSON.parse(r.data))
      .find(
        (e) =>
          e.type === "approval.blocked" && e.details.actionId === f.pending.id,
      );
    assert.deepEqual(event.details.actor, {
      actorId: "reviewer",
      tenant: "local",
    });
    assert.deepEqual(
      f.system.store.db.prepare("SELECT * FROM customers WHERE id=1").get(),
      f.before,
    );
  } finally {
    await f.close();
  }
});
