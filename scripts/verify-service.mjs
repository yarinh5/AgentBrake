import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  initializeProduct,
  productConfig,
  composeProduct,
  dockerProduct,
} from "./product.mjs";
import {
  startProduct,
  backupProduct,
  restoreProduct,
  doctorProduct,
} from "./product-maintenance.mjs";
import { sourceManifest } from "./source-manifest.mjs";
import { serviceBrowserSmoke } from "./service-browser-smoke.mjs";
import { verifyBackupFailureResume } from "../tests/enforcement/service-backup-failure.mjs";
import { verifyVolumeCollisions } from "../tests/enforcement/service-volume-collision.mjs";
const runId = randomUUID(),
  directory = join("docs/evidence", runId),
  name = "verify-service-" + runId.slice(0, 8),
  restoreName = "verify-restore-" + runId.slice(0, 8);
await mkdir(directory, { recursive: true });
const manifest = await sourceManifest();
await writeFile(
  join(directory, "source-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
const report = {
  runId,
  sourceHash: manifest.sourceHash,
  startedAt: new Date().toISOString(),
  result: "NOT_RUN",
  cases: [],
  scope:
    "Local synthetic service maintenance; encrypted cold snapshot, new-installation restore and authority suspension.",
};
const config = await initializeProduct(name, 4330);
let recovered, backup;
const credential = {
  email: "owner-" + runId.slice(0, 8) + "@example.test",
  password: "Service!" + randomBytes(24).toString("hex"),
};
const reviewerPassword = "Reviewer!" + randomBytes(24).toString("hex");
const record = (name, observed) => {
  report.cases.push({ name, result: "PASS", observed });
  console.log("PASS " + name);
};
const request = async (
  config,
  path,
  session,
  body,
  method = body === undefined ? "GET" : "POST",
) => {
  const base = "http://127.0.0.1:" + config.port;
  const r = await fetch(base + path, {
    method,
    headers: { Origin: base, "Content-Type": "application/json", ...session },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, body: await r.json(), headers: r.headers };
};
const sessionOf = (r) => ({
  Cookie: r.headers.get("set-cookie").split(";")[0],
  "X-AB-CSRF": r.body.csrfToken,
});
const login = async (config) => {
  const r = await request(config, "/api/login", {}, credential);
  assert.equal(r.status, 200);
  return sessionOf(r);
};
const agentCall = async (config, token, body) =>
  JSON.parse(
    await composeProduct(
      config,
      ["exec", "-T", "agent", "node", "infra/product/agent-probe.mjs"],
      {
        capture: true,
        input: JSON.stringify({
          kind: "request",
          path: "/api/actions",
          token,
          body,
        }),
      },
    ),
  );
const snapshot = async (config) => {
  const value = JSON.parse(
    await composeProduct(
      config,
      [
        "exec",
        "-T",
        "mock-target",
        "node",
        "--input-type=module",
        "-e",
        "import {readFile} from 'node:fs/promises';const token=(await readFile('/run/secrets/observer-token','utf8')).trim();const r=await fetch('http://127.0.0.1:8080/snapshot',{headers:{Authorization:'Bearer '+token}});if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()));",
      ],
      { capture: true },
    ),
  );
  const { calls, ...state } = value;
  return state;
};
try {
  await startProduct(config);
  const operators = JSON.parse(
    await readFile(join(config.dir, "operators.json"), "utf8"),
  );
  const key = operators.find((o) => o.role === "administrator").key;
  const setup = await request(
    config,
    "/api/setup",
    {},
    { key, name: "Service owner", ...credential },
  );
  assert.equal(setup.status, 200);
  const session = sessionOf(setup);
  assert.equal((await request(config, "/api/login", {}, { key })).status, 401);
  const invitation = await request(config, "/api/team/invitations", session, {
    email: "reviewer-" + runId.slice(0, 8) + "@example.test",
    role: "approver",
  });
  assert.equal(invitation.status, 201);
  const joined = await request(
    config,
    "/api/invitations/accept",
    {},
    {
      token: invitation.body.token,
      name: "Independent reviewer",
      password: reviewerPassword,
    },
  );
  assert.equal(joined.status, 200);
  const reviewer = sessionOf(joined);
  assert.equal((await request(config, "/api/team", reviewer)).status, 403);
  const unusedInvite = await request(config, "/api/team/invitations", session, {
    email: "unused-" + runId.slice(0, 8) + "@example.test",
    role: "viewer",
  });
  assert.equal(unusedInvite.status, 201);
  const oldRecovery = await request(
    config,
    "/api/team/administrator/recovery",
    session,
    {},
  );
  assert.equal(oldRecovery.status, 200);
  record(
    "managed owner bootstrap and invited reviewer work through installed proxy",
    {
      legacyKeysDenied: true,
      reviewerRole: joined.body.actor.role,
      reviewerTeamAccessDenied: true,
    },
  );
  record(
    "installed browser account, team and settings workflow",
    await serviceBrowserSmoke({ port: config.port, credential, directory }),
  );
  const made = await request(config, "/api/agents", session, {
    name: "Restore acceptance task",
    tools: ["database_read", "database_update"],
    resources: ["customers"],
    sandbox: true,
  });
  assert.equal(made.status, 201);
  const token = made.body.token,
    agentId = made.body.agent.id;
  const allowed = await agentCall(config, token, {
    requestId: randomUUID(),
    tool: "database_read",
    arguments: { limit: 1 },
  });
  assert.equal(allowed.body.status, "allowed");
  const proposed = await agentCall(config, token, {
    requestId: randomUUID(),
    tool: "database_update",
    arguments: { id: 1, status: "paused" },
  });
  assert.equal(proposed.body.status, "pending");
  const review = await request(
    config,
    "/api/approvals/" + proposed.body.id,
    reviewer,
  );
  assert.equal(review.status, 200);
  const approved = await request(
    config,
    "/api/approvals/" + proposed.body.id,
    reviewer,
    { decision: "approve", proof: review.body.proof },
  );
  assert.equal(approved.status, 200);
  assert.equal(approved.body.status, "allowed");
  const pending = await agentCall(config, token, {
    requestId: randomUUID(),
    tool: "database_update",
    arguments: { id: 2, status: "paused" },
  });
  assert.equal(pending.body.status, "pending");
  const targetBefore = await snapshot(config),
    auditBefore = (await request(config, "/api/audit/export", session)).body;
  assert.equal(auditBefore.valid, true);
  backup = await backupProduct(config);
  assert.ok((await stat(backup.file)).size > 100);
  assert.equal((await doctorProduct(config)).http, "200");
  await login(config);
  const bytes = await readFile(backup.file);
  assert.equal(bytes.includes(Buffer.from(token)), false);
  record("encrypted consistent backup resumes original installation", {
    bytes: bytes.length,
    sourceResumed: true,
  });
  record(
    "oversized backup fails without publishing and resumes source",
    await verifyBackupFailureResume(config),
  );
  assert.deepEqual(await snapshot(config), targetBefore);
  const wrongKey = join(config.dir, "wrong-test-recovery-key");
  await writeFile(wrongKey, randomBytes(32), { mode: 0o600, flag: "wx" });
  await assert.rejects(
    restoreProduct(backup.file, wrongKey, restoreName, 4331),
    /authentication failed/,
  );
  await assert.rejects(stat(join(config.dir, "..", "product-" + restoreName)), {
    code: "ENOENT",
  });
  await assert.rejects(
    restoreProduct(backup.file, backup.keyFile, config.name, 4331),
    /new project|EEXIST/,
  );
  assert.deepEqual(await snapshot(config), targetBefore);
  record("wrong key and existing destination rejected without damage", {
    sourceTargetUnchanged: true,
    newDestinationAbsent: true,
  });
  record(
    "foreign exact-name volumes refused without content or metadata changes",
    {
      cases: await verifyVolumeCollisions(config, backup),
    },
  );
  const restored = await restoreProduct(
    backup.file,
    backup.keyFile,
    restoreName,
    4331,
  );
  recovered = await productConfig(restoreName);
  const restoredSession = await login(recovered),
    workspace = (await request(recovered, "/api/workspace", restoredSession))
      .body;
  assert.equal(workspace.paused, true);
  assert.ok(workspace.agents.length > 0);
  for (const a of workspace.agents) {
    assert.equal(a.status, "paused");
    if (a.grant) assert.equal(a.grant.revoked, true);
  }
  const restoredPending = workspace.actions.find(
    (a) => a.id === pending.body.id,
  );
  assert.equal(restoredPending.status, "blocked");
  assert.equal(restoredPending.rule, "recovery-suspension");
  const audit = (await request(recovered, "/api/audit/export", restoredSession))
    .body;
  assert.equal(audit.valid, true);
  assert.deepEqual(
    audit.entries.slice(0, auditBefore.entries.length),
    auditBefore.entries,
  );
  assert.deepEqual(await snapshot(recovered), targetBefore);
  const team = (await request(recovered, "/api/team", restoredSession)).body;
  assert.equal(team.members.length, 2);
  assert.equal(team.invitations.length, 0);
  assert.equal(
    (
      await request(
        recovered,
        "/api/invitations/accept",
        {},
        {
          token: unusedInvite.body.token,
          name: "Restored stale invitation",
          password: reviewerPassword,
        },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        recovered,
        "/api/password/reset",
        {},
        { token: oldRecovery.body.token, password: reviewerPassword },
      )
    ).status,
    400,
  );
  const denied = await agentCall(recovered, token, {
    requestId: randomUUID(),
    tool: "database_read",
    arguments: { limit: 1 },
  });
  assert.ok(
    [401, 403].includes(denied.status) || denied.body.status === "blocked",
  );
  assert.deepEqual(await snapshot(recovered), targetBefore);
  record("full restore preserves target and audit but suspends old authority", {
    agentId,
    oldTokenDenied: true,
    pendingBlocked: true,
    auditPrefixPreserved: true,
    paused: true,
    accountsPreserved: true,
    invitationAndRecoveryTokensInvalidated: true,
  });
  const current = await sourceManifest();
  report.result =
    current.sourceHash === manifest.sourceHash
      ? "PASS_LOCAL_SERVICE"
      : "PASS_RUNTIME_SOURCE_CHANGED";
} catch (error) {
  report.result = "FAIL";
  report.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (!recovered)
    recovered = await productConfig(restoreName).catch(() => undefined);
  const cleanup = [];
  for (const c of [recovered, config].filter(Boolean)) {
    try {
      await composeProduct(
        c,
        ["--profile", "agent", "down", "--volumes", "--remove-orphans"],
        { capture: true },
      );
      const containers = await dockerProduct(
        c,
        [
          "ps",
          "-a",
          "-q",
          "--filter",
          "label=com.docker.compose.project=" + c.project,
        ],
        { capture: true },
      );
      const volumes = await dockerProduct(
        c,
        [
          "volume",
          "ls",
          "-q",
          "--filter",
          "label=com.docker.compose.project=" + c.project,
        ],
        { capture: true },
      );
      const networks = await dockerProduct(
        c,
        [
          "network",
          "ls",
          "-q",
          "--filter",
          "label=com.docker.compose.project=" + c.project,
        ],
        { capture: true },
      );
      assert.equal((containers + volumes + networks).trim(), "");
      cleanup.push({
        project: c.project,
        result: "PASS",
        containers: 0,
        volumes: 0,
        networks: 0,
      });
    } catch {
      cleanup.push({ project: c.project, result: "FAIL" });
      report.result = "FAIL";
      process.exitCode = 1;
    }
  }
  report.cleanup = cleanup;
  report.finishedAt = new Date().toISOString();
  await writeFile(
    join(directory, "service-summary.json"),
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    "docs/evidence/latest-service.json",
    JSON.stringify({ runId, directory, result: report.result }, null, 2),
  );
  console.log(report.result + ": " + directory);
}
