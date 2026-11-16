import assert from "node:assert/strict";
import { createApp } from "../../server/app.js";
import type { ControlStore } from "../../server/control-store.js";

const operators = [
  {
    id: "audit-alice",
    name: "Alice",
    tenant: "local",
    role: "administrator",
    key: "fixture-audit-alice-key-000000000000000",
  },
  {
    id: "audit-bob",
    name: "Bob",
    tenant: "local",
    role: "operator",
    key: "fixture-audit-bob-key-00000000000000000",
  },
  {
    id: "audit-viewer",
    name: "Viewer",
    tenant: "local",
    role: "viewer",
    key: "fixture-audit-viewer-key-0000000000000",
  },
] as const;
const mutations = new Set([
  "agent.created",
  "agent.paused",
  "agent.active",
  "grant.issued",
  "grant.revoked",
  "control.changed",
  "policy.changed",
]);
export async function assertControlAudit(store: ControlStore) {
  const system = createApp({
    store,
    databasePath: ":memory:",
    adminKey: "fixture-audit-binding-key-000000000000",
    operators: [...operators],
  });
  let dispatches = 0;
  system.gateway.connectors.execute = async () => {
    dispatches++;
    throw Error("Control mutations must not dispatch");
  };
  const server = system.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const secrets: string[] = operators.map((o) => o.key);
  const correlations: string[] = [];
  const request = async (
    path: string,
    headers: Record<string, string>,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) => {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    if (r.ok && method !== "GET" && path !== "/api/login")
      correlations.push(r.headers.get("x-correlation-id")!);
    return {
      status: r.status,
      text,
      headers: r.headers,
      body: r.headers.get("content-type")?.includes("application/json")
        ? JSON.parse(text)
        : undefined,
    };
  };
  const login = async (index: number) => {
    const r = await request("/api/login", {}, { key: operators[index].key });
    assert.equal(r.status, 200);
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    secrets.push(cookie.slice("ab_session=".length), r.body.csrfToken);
    return { Cookie: cookie, "X-AB-CSRF": r.body.csrfToken as string };
  };
  const before = (await store.auditTrail()).length;
  try {
    const alice = await login(0),
      bob = await login(1),
      viewer = await login(2);
    const made = await request("/api/agents", alice, {
      name: "Human audit fixture",
      tools: ["database_read"],
      resources: ["customers"],
      sandbox: true,
    });
    assert.equal(made.status, 201);
    secrets.push(made.body.token);
    const id = made.body.agent.id,
      path = "/api/agents/" + id;
    const events = async () =>
      (await store.auditTrail())
        .slice(before)
        .map((r) => JSON.parse(r.data))
        .filter((e) => mutations.has(e.type));
    const snapshot = async () => ({
      settings: await store.settings(),
      agents: await store.agents(),
      events: await events(),
    });
    const initial = await snapshot();
    for (const [url, auth, body, method, expected] of [
      ["/api/control", { Cookie: alice.Cookie }, { paused: true }, "POST", 403],
      [
        "/api/policies",
        bob,
        { reads: "deny", databaseWrites: "deny", githubWrites: "deny" },
        "PUT",
        403,
      ],
      [path, viewer, { status: "paused" }, "PATCH", 403],
      [path + "/grant/revoke", { Cookie: bob.Cookie }, {}, "POST", 403],
      [
        path,
        alice,
        { status: "paused", actorId: "forged-human" },
        "PATCH",
        400,
      ],
    ] as const) {
      assert.equal((await request(url, auth, body, method)).status, expected);
      assert.deepEqual(await snapshot(), initial);
    }
    assert.equal(
      (await request(path, bob, { status: "paused" }, "PATCH")).status,
      200,
    );
    assert.equal(
      (await request(path, alice, { status: "active" }, "PATCH")).status,
      200,
    );
    assert.equal(
      (
        await request(path + "/grant", alice, {
          actions: ["database_read"],
          resources: ["customers"],
          environments: ["sandbox"],
          expiresInSeconds: 120,
          maxCalls: 5,
          maxRows: 2,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await request(
          path + "/grant/revoke",
          {
            ...bob,
            "X-AB-Actor": "forged-human",
            "X-AB-Actor-ID": "audit-alice",
            "X-Correlation-ID": "forged-correlation",
          },
          {},
        )
      ).status,
      200,
    );
    for (const paused of [true, false])
      assert.equal(
        (await request("/api/control", alice, { paused })).status,
        200,
      );
    assert.equal(
      (
        await request(
          "/api/policies",
          alice,
          {
            reads: "deny",
            databaseWrites: "approval",
            githubWrites: "approval",
          },
          "PUT",
        )
      ).status,
      200,
    );
    const audit = await events();
    assert.deepEqual(
      audit.map((e) => [e.type, e.details.actor]),
      [
        ["agent.created", { actorId: "audit-alice", tenant: "local" }],
        ["agent.paused", { actorId: "audit-bob", tenant: "local" }],
        ["agent.active", { actorId: "audit-alice", tenant: "local" }],
        ["grant.issued", { actorId: "audit-alice", tenant: "local" }],
        ["grant.revoked", { actorId: "audit-bob", tenant: "local" }],
        ["control.changed", { actorId: "audit-alice", tenant: "local" }],
        ["control.changed", { actorId: "audit-alice", tenant: "local" }],
        ["policy.changed", { actorId: "audit-alice", tenant: "local" }],
      ],
    );
    assert.deepEqual(
      audit.map((e) => e.details.correlationId),
      correlations,
    );
    assert.ok(correlations.every((id) => /^[a-f0-9-]{36}$/.test(id)));
    assert.equal((await store.agent(id))!.grant!.human_owner, "audit-alice");
    for (const format of ["json", "csv"]) {
      const exported = await request(
        "/api/audit/export?format=" + format,
        viewer,
      );
      assert.equal(exported.status, 200);
      for (const actor of ["audit-alice", "audit-bob"])
        assert.ok(exported.text.includes(actor));
      assert.ok(exported.text.includes("tenant"));
      assert.ok(!exported.text.includes("forged-human"));
      for (const secret of secrets)
        assert.ok(
          !exported.text.includes(secret),
          "Export must exclude fixture credential/session/CSRF",
        );
      if (format === "json") {
        assert.equal(exported.body.valid, true);
        const relevant = exported.body.entries
          .slice(before)
          .filter((r: any) => mutations.has(r.data.type));
        assert.deepEqual(
          relevant.map((r: any) => r.data.details.actor),
          audit.map((e) => e.details.actor),
        );
      }
    }
    assert.equal(dispatches, 0);
    return { id, audit };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r, reject) =>
      server.close((error) => (error ? reject(error) : r())),
    );
    await system.close();
  }
}
