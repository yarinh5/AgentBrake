import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const secret = async (name) =>
  (await readFile("/run/secrets/" + name, "utf8")).trim();
const adminKey = await secret("admin-key"),
  observer = await secret("observer-token");
const base = "http://gateway:4313",
  cases = [];
async function request(path, body, headers = {}, method = "POST") {
  const r = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  return { status: r.status, body: await r.json(), headers: r.headers };
}
const login = await request("/api/login", { key: adminKey });
assert.equal(login.status, 200);
const admin = { Cookie: login.headers.get("set-cookie").split(";")[0] };
const snapshot = async () => {
  const r = await fetch("http://mock-target:8080/snapshot", {
    headers: { Authorization: "Bearer " + observer },
  });
  assert.equal(r.status, 200);
  return r.json();
};
const create = async (tools, resources) => {
  const r = await request(
    "/api/agents",
    { name: "Controlled workflow fixture", tools, resources, sandbox: true },
    admin,
  );
  assert.equal(r.status, 201);
  return r.body;
};
const action = async (agent, tool, args = {}) => {
  const r = await request(
    "/mcp",
    {
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: {
        name: tool,
        arguments: { requestId: randomUUID(), ...args },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
    {
      Authorization: "Bearer " + agent.token,
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": tool,
    },
  );
  assert.equal(r.status, 200);
  assert.ok(r.body.result?.content?.[0]?.text, JSON.stringify(r.body));
  return JSON.parse(r.body.result.content[0].text);
};
const restAction = async (agent, tool, args = {}) => {
  const r = await request(
    "/api/actions",
    { requestId: randomUUID(), tool, arguments: args },
    { Authorization: "Bearer " + agent.token },
  );
  assert.equal(r.status, 200);
  return r.body;
};
const approve = (id) =>
  request("/api/approvals/" + id, { decision: "approve" }, admin);
const record = (name, entry, extra = {}) =>
  cases.push({
    case: name,
    status: entry.status,
    correlationId: entry.correlationId,
    actionId: entry.id,
    ...extra,
  });
const gitAgent = await create(
  [
    "github_list_repo",
    "github_list_branches",
    "github_read_file",
    "github_propose_change",
    "github_create_branch",
    "github_open_pull_request",
  ],
  ["agentbrake/sandbox"],
);
const repo = "agentbrake/sandbox";
const metadata = await action(gitAgent, "github_list_repo");
assert.equal(metadata.status, "allowed");
assert.equal(metadata.result.repository.id, "fixture-repo-1");
record("trusted-local-repository", metadata);
const initial = await snapshot(),
  baseSha = initial.git.mainSha,
  branch = "agentbrake/workflow-proof";
const changes = [
  { path: "docs/change.md", content: "# Approved local fixture\n" },
];
const missingBranch = await action(gitAgent, "github_open_pull_request", {
  repo, baseSha, branch, changes, title: "Missing branch must not be reviewable", body: "",
});
assert.equal(missingBranch.status, "blocked");
assert.equal(missingBranch.rule, "preview-unavailable");
assert.deepEqual(await snapshot(), initial);
assert.equal((await approve(missingBranch.id)).status, 409);
assert.deepEqual(await snapshot(), initial);
record("missing-feature-branch-no-dispatch-no-approval", missingBranch, { executionCalls: 0 });
const proposal = await action(gitAgent, "github_propose_change", {
  repo,
  baseSha,
  branch,
  changes,
});
assert.equal(proposal.status, "allowed");
assert.deepEqual((await snapshot()).git, initial.git);
record("canonical-preview-no-mutation", proposal, {
  fingerprint: proposal.result.proposalFingerprint,
});
let before = await snapshot();
for (const path of [".github/workflows/ci.yml", ".env", "src/../secrets.ts"]) {
  const denied = await restAction(gitAgent, "github_open_pull_request", {
    repo,
    baseSha,
    branch,
    title: "Forbidden fixture",
    changes: [{ path, content: "fixture" }],
  });
  assert.equal(denied.status, "blocked");
  record("forbidden-path-" + path, denied);
}
assert.deepEqual(await snapshot(), before);
const pending = await action(gitAgent, "github_create_branch", {
  repo,
  baseSha,
  branch,
});
assert.equal(pending.status, "pending");
assert.deepEqual(await snapshot(), before);
assert.equal(
  (
    await request(
      "/api/approvals/" + pending.id,
      { decision: "approve" },
      { Authorization: "Bearer " + gitAgent.token },
    )
  ).status,
  401,
);
const branchResult = await approve(pending.id);
assert.equal(branchResult.status, 200);
assert.equal(branchResult.body.status, "allowed");
assert.equal((await snapshot()).calls, before.calls + 1);
assert.equal((await approve(pending.id)).status, 409);
record("approved-feature-branch-once", branchResult.body);
before = await snapshot();
const pr = await action(gitAgent, "github_open_pull_request", {
  repo,
  baseSha,
  branch,
  title: "Approved fixture change",
  changes,
});
assert.equal(pr.status, "pending");
assert.deepEqual(await snapshot(), before);
const approvals = await Promise.all([approve(pr.id), approve(pr.id)]);
assert.deepEqual(approvals.map((x) => x.status).sort(), [200, 409]);
const completed = approvals.find((x) => x.status === 200).body;
assert.equal(completed.status, "allowed");
const afterPr = await snapshot();
assert.equal(afterPr.calls, before.calls + 1);
assert.equal(afterPr.git.mainSha, baseSha);
assert.equal(afterPr.git.pullRequests.length, 1);
assert.notEqual(afterPr.git.pullRequests[0].headSha, baseSha);
record("approved-pr-concurrent-consume-once", completed, {
  mainUnchanged: true,
});
const stale = await action(gitAgent, "github_create_branch", {
  repo,
  baseSha,
  branch: "agentbrake/stale-policy",
});
assert.equal(
  (
    await request(
      "/api/policies",
      { reads: "allow", databaseWrites: "approval", githubWrites: "approval" },
      admin,
      "PUT",
    )
  ).status,
  200,
);
before = await snapshot();
const staleResult = await approve(stale.id);
assert.equal(staleResult.body.status, "blocked");
assert.deepEqual(await snapshot(), before);
record("policy-revision-withdraws-approval", staleResult.body);
const revoke = await action(gitAgent, "github_create_branch", {
  repo,
  baseSha,
  branch: "agentbrake/revoked-task",
});
assert.equal(
  (
    await request(
      "/api/agents/" + gitAgent.agent.id + "/grant/revoke",
      {},
      admin,
    )
  ).status,
  200,
);
before = await snapshot();
const revoked = await approve(revoke.id);
assert.equal(revoked.body.status, "blocked");
assert.deepEqual(await snapshot(), before);
record("revoked-task-no-dispatch", revoked.body);
const dbAgent = await create(
  [
    "database_read",
    "database_update",
    "database_schema",
    "github_create_branch",
  ],
  ["customers", repo],
);
const schema = await action(dbAgent, "database_schema");
assert.equal(schema.status, "allowed");
record("allowlisted-schema", schema);
const read = await action(dbAgent, "database_read", { limit: 2 });
assert.equal(read.status, "allowed");
assert.equal(read.result.rows.length, 2);
record("bounded-postgres-read", read);
before = await snapshot();
const destructive = await restAction(dbAgent, "database_sql", {
  sql: "DROP TABLE public.agentbrake_customers",
});
assert.equal(destructive.status, "blocked");
const tainted = await action(dbAgent, "github_create_branch", {
  repo,
  baseSha,
  branch: "agentbrake/tainted",
});
assert.equal(tainted.status, "blocked");
assert.deepEqual(await snapshot(), before);
record("raw-sql-no-dispatch", destructive);
record("tainted-git-write-no-dispatch", tainted);
const write = await action(dbAgent, "database_update", {
  id: 2,
  status: "paused",
});
assert.equal(write.status, "pending");
assert.deepEqual(await snapshot(), before);
const updated = await approve(write.id);
assert.equal(updated.body.status, "allowed");
const afterWrite = await snapshot();
assert.equal(afterWrite.calls, before.calls + 1);
const row = afterWrite.customers.rows.find((r) => r.id === 2),
  old = before.customers.rows.find((r) => r.id === 2);
assert.equal(row.status, "paused");
assert.equal(row.version, old.version + 1);
assert.deepEqual(
  afterWrite.customers.rows.filter((r) => r.id !== 2),
  before.customers.rows.filter((r) => r.id !== 2),
);
assert.deepEqual(afterWrite.schema, before.schema);
assert.equal((await approve(write.id)).status, 409);
record("approved-one-row-write", updated.body, { changedRows: 1 });
const audit = await request("/api/audit/export", undefined, admin, "GET");
assert.equal(audit.status, 200);
assert.equal(audit.body.valid, true);
const exported = JSON.stringify(audit.body);
for (const value of [adminKey, observer, gitAgent.token, dbAgent.token])
  assert.ok(!exported.includes(value));
console.log(
  JSON.stringify({
    result: "PASS",
    cases,
    proof: {
      before: initial,
      after: afterWrite,
      auditValid: true,
      auditEntries: audit.body.entries.length,
    },
    scope:
      "Local MCP/REST gateway, separate PostgreSQL control/target and actual local Git with mock PR. No GitHub App or actual Codex client.",
  }),
);
