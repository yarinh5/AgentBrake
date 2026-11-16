import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { createApp } from "../server/app.js";

const directory = mkdtempSync(join(tmpdir(), "agentbrake-test-"));
const system = createApp({
  databasePath: join(directory, "state.db"),
  adminKey: "test-administrator-key-with-32-characters",
});
const server = system.app.listen(0, "127.0.0.1");
let base = "",
  cookie = "",
  token = "",
  agentId = "";
async function call(
  path: string,
  body?: unknown,
  auth = "admin",
  method?: string,
) {
  const response = await fetch(base + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(auth === "admin"
        ? { Cookie: cookie }
        : auth
          ? { Authorization: `Bearer ${auth}` }
          : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json(), response };
}
const action = (tool: string, args: object = {}) => ({
  requestId: randomUUID(),
  tool,
  arguments: args,
});
before(async () => {
  if (!server.listening)
    await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await system.close();
  rmSync(directory, { recursive: true, force: true });
});

test("administrator login is required to inspect the workspace", async () => {
  assert.equal((await call("/api/workspace", undefined, "")).status, 401);
  assert.equal((await call("/api/login", { key: "wrong" }, "")).status, 401);
  const login = await call(
    "/api/login",
    { key: "test-administrator-key-with-32-characters" },
    "",
  );
  assert.equal(login.status, 200);
  cookie = login.response.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await call("/api/workspace")).status, 200);
});
test("create a scoped agent; its token cannot administer the workspace", async () => {
  const created = await call("/api/agents", {
    name: "Test developer",
    tools: [
      "database_read",
      "database_update",
      "github_read_file",
      "github_create_issue",
    ],
    resources: ["customers", "agentbrake/sandbox"],
  });
  assert.equal(created.status, 201);
  token = created.body.token;
  agentId = created.body.agent.id;
  assert.equal((await call("/api/workspace", undefined, token)).status, 401);
  assert.equal(
    (await call("/api/actions", action("database_read"), "")).status,
    401,
  );
});
test("allowed reads execute against real isolated SQLite records", async () => {
  const read = await call(
    "/api/actions",
    action("database_read", { limit: 5 }),
    token,
  );
  assert.equal(read.body.status, "allowed");
  assert.equal(read.body.result.rows[0].name, "Acme Studio");
});
test("destructive and unknown tools never delete records", async () => {
  for (const tool of ["database_delete", "shell_exec", "database_query"]) {
    const result = await call(
      "/api/actions",
      action(tool, { sql: "DROP TABLE customers" }),
      token,
    );
    assert.equal(result.body.status, "blocked");
  }
  const read = await call("/api/actions", action("database_read"), token);
  assert.equal(read.body.result.rows.length, 4);
});
test("writes wait for human approval and an approval executes the stored action once", async () => {
  const request = action("database_update", { id: 1, status: "paused" });
  const pending = await call("/api/actions", request, token);
  assert.equal(pending.body.status, "pending");
  const before = await call("/api/actions", action("database_read"), token);
  assert.equal(before.body.result.rows[0].status, "active");
  const [first, second] = await Promise.all([
    call(`/api/approvals/${pending.body.id}`, { decision: "approve" }),
    call(`/api/approvals/${pending.body.id}`, { decision: "approve" }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  const retry = await call("/api/actions", request, token);
  assert.equal(retry.body.status, "allowed");
  assert.equal(retry.body.result.version, 1);
  const after = await call("/api/actions", action("database_read"), token);
  assert.equal(after.body.result.rows[0].status, "paused");
  assert.equal(after.body.result.rows[0].version, 1);
});
test("reusing a request ID with changed arguments is rejected", async () => {
  const request = action("database_update", { id: 2, status: "paused" });
  await call("/api/actions", request, token);
  const changed = await call(
    "/api/actions",
    { ...request, arguments: { id: 3, status: "paused" } },
    token,
  );
  assert.equal(changed.status, 409);
});
test("an agent cannot approve its own request", async () => {
  const pending = await call(
    "/api/actions",
    action("database_update", { id: 3, status: "paused" }),
    token,
  );
  assert.equal(
    (
      await call(
        `/api/approvals/${pending.body.id}`,
        { decision: "approve" },
        token,
      )
    ).status,
    401,
  );
});
test("revocation is rechecked when an administrator approves", async () => {
  const pending = await call(
    "/api/actions",
    action("database_update", { id: 4, status: "paused" }),
    token,
  );
  await call(`/api/agents/${agentId}`, { status: "paused" }, "admin", "PATCH");
  const approved = await call(`/api/approvals/${pending.body.id}`, {
    decision: "approve",
  });
  assert.equal(approved.body.status, "blocked");
  assert.equal(
    (await call("/api/actions", action("database_read"), token)).body.status,
    "blocked",
  );
  await call(`/api/agents/${agentId}`, { status: "active" }, "admin", "PATCH");
  const read = await call("/api/actions", action("database_read"), token);
  assert.equal(read.body.result.rows[3].status, "active");
});
test("policy changes supersede queued approvals", async () => {
  const pending = await call(
    "/api/actions",
    action("database_update", { id: 4, status: "paused" }),
    token,
  );
  await call(
    "/api/policies",
    { databaseWrites: "deny", githubWrites: "approval", reads: "allow" },
    "admin",
    "PUT",
  );
  assert.equal(
    (await call(`/api/approvals/${pending.body.id}`, { decision: "approve" }))
      .body.status,
    "blocked",
  );
  await call(
    "/api/policies",
    { databaseWrites: "approval", githubWrites: "approval", reads: "allow" },
    "admin",
    "PUT",
  );
});
test("global emergency stop blocks new calls and queued approvals", async () => {
  const pending = await call(
    "/api/actions",
    action("database_update", { id: 4, status: "paused" }),
    token,
  );
  await call("/api/control", { paused: true });
  assert.equal(
    (await call("/api/actions", action("database_read"), token)).body.status,
    "blocked",
  );
  assert.equal(
    (await call(`/api/approvals/${pending.body.id}`, { decision: "approve" }))
      .body.status,
    "blocked",
  );
  await call("/api/control", { paused: false });
});
test("resource scopes, secret file paths and malformed structured arguments are denied", async () => {
  for (const args of [
    { repo: "other/repo", path: "README.md" },
    { repo: "agentbrake/sandbox", path: ".env" },
    { repo: "agentbrake/sandbox", path: "../secret" },
  ]) {
    assert.equal(
      (await call("/api/actions", action("github_read_file", args), token)).body
        .status,
      "blocked",
    );
  }
  assert.equal(
    (
      await call(
        "/api/actions",
        action("database_read", { sql: "SELECT * FROM secrets" }),
        token,
      )
    ).body.status,
    "blocked",
  );
});
test("reading protected data taints the agent and blocks subsequent outbound writes", async () => {
  const issue = await call(
    "/api/actions",
    action("github_create_issue", {
      repo: "agentbrake/sandbox",
      title: "Export",
      body: "customer data",
    }),
    token,
  );
  assert.equal(issue.body.status, "blocked");
  assert.equal(issue.body.rule, "data-boundary");
});
test("secrets are blocked without persisting the raw credential in events or pending data", async () => {
  const secret = "ghp_" + "a".repeat(36);
  const denied = await call(
    "/api/actions",
    action("github_create_issue", {
      repo: "agentbrake/sandbox",
      title: "token",
      body: secret,
    }),
    token,
  );
  assert.equal(denied.body.status, "blocked");
  assert.equal(
    JSON.stringify((await call("/api/workspace")).body).includes(secret),
    false,
  );
});
test("cross-origin browser mutations and DNS-rebinding hosts are rejected", async () => {
  const origin = await fetch(base + "/api/control", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "https://evil.example",
      "Content-Type": "application/json",
    },
    body: '{"paused":true}',
  });
  assert.equal(origin.status, 403);
  // fetch normalizes Host; use an actual HTTP request to exercise DNS rebinding.
  const status = await new Promise<number>((resolve) => {
    const request = httpRequest(
      base + "/api/workspace",
      { headers: { Cookie: cookie, Host: "evil.example" } },
      (response) => {
        response.resume();
        resolve(response.statusCode!);
      },
    );
    request.end();
  });
  assert.equal(status, 403);
});
