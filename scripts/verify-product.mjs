import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  initializeProduct,
  productConfig,
  prepareProduct,
  composeProduct,
  dockerProduct,
} from "./product.mjs";
import { sourceManifest } from "./source-manifest.mjs";
const runId = randomUUID(),
  existing = process.argv
    .find((v) => v.startsWith("--installation="))
    ?.split("=")[1];
if (existing && !/^verify-/.test(existing))
  throw Error("Verifier accepts only disposable verify-* installations");
const config = existing
  ? await productConfig(existing)
  : await initializeProduct("verify-" + runId.slice(0, 8), 4326);
const directory = join("docs/evidence", runId);
await mkdir(directory, { recursive: true });
const manifest = await sourceManifest();
await writeFile(
  join(directory, "source-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
const operators = JSON.parse(
  await readFile(join(config.dir, "operators.json"), "utf8"),
);
const knownSecrets = operators.map((o) => o.key);
for (const name of [
  "session-key",
  "binding-key",
  "bridge-key",
  "opa-token",
  "target-token",
  "observer-token",
  "control-password",
  "control-owner-password",
  "postgres-bootstrap",
  "target-read-password",
  "target-write-password",
])
  knownSecrets.push((await readFile(join(config.dir, name), "utf8")).trim());
const report = {
  runId,
  sourceHash: manifest.sourceHash,
  startedAt: new Date().toISOString(),
  installation: { name: config.name, id: config.id, port: config.port },
  result: "NOT_RUN",
  cases: [],
  scope:
    "Local persistent product install; synthetic PostgreSQL/Git, isolated test client. No real GitHub or hosted model. Native process-loss tests are separate evidence.",
};
const save = async (name, value) => {
  let data = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  for (const secret of knownSecrets)
    data = data.replaceAll(secret, "[REDACTED]");
  await writeFile(join(directory, name), data);
};
const step = async (name, fn) => {
  const result = await fn();
  report.cases.push({ name, result: "PASS", observed: result });
  console.log("PASS " + name);
  return result;
};
const compose = async (label, args, options = {}) => {
  try {
    const output = await composeProduct(config, args, {
      capture: true,
      ...options,
    });
    await save(label + ".log", output);
    return output;
  } catch (error) {
    await save(
      label + ".log",
      (error.output ?? "") + "\n" + (error.errorOutput ?? ""),
    );
    throw error;
  }
};
const base = "http://127.0.0.1:" + config.port;
const request = async (
  path,
  session,
  body,
  method = body === undefined ? "GET" : "POST",
) => {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      ...(session ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  return {
    status: response.status,
    body: await response.json(),
    headers: response.headers,
  };
};
const login = async (role) => {
  const r = await request("/api/login", null, {
    key: operators.find((o) => o.role === role).key,
  });
  assert.equal(r.status, 200);
  return {
    Cookie: r.headers.get("set-cookie").split(";")[0],
    "X-AB-CSRF": r.body.csrfToken,
  };
};
const agentCall = async (token, body, path = "/api/actions") =>
  JSON.parse(
    await composeProduct(
      config,
      ["exec", "-T", "agent", "node", "infra/product/agent-probe.mjs"],
      {
        capture: true,
        input: JSON.stringify({ kind: "request", path, token, body }),
      },
    ),
  );
const submit = async (token, tool, args) => {
  const response = await agentCall(token, {
    requestId: randomUUID(),
    tool,
    arguments: args,
  });
  await save(
    "action-" + (response.body.id ?? randomUUID()) + ".json",
    response,
  );
  return response;
};
const snapshot = async () =>
  JSON.parse(
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
let up = false;
try {
  await prepareProduct(config);
  up = true;
  await compose(
    "install",
    [
      "--profile",
      "agent",
      "up",
      "-d",
      "--build",
      "--wait",
      "--wait-timeout",
      "180",
    ],
    { timeoutMs: 300000 },
  );
  let admin = await login("administrator"),
    reviewer = await login("approver"),
    viewer = await login("viewer"),
    operator = await login("operator");
  await step(
    "separate process topology, internal networks, credentials and loopback publication",
    async () => {
      const ids = (
        await composeProduct(config, ["ps", "-q"], { capture: true })
      )
        .trim()
        .split(/\s+/);
      const containers = JSON.parse(
        await dockerProduct(config, ["inspect", ...ids], { capture: true }),
      );
      const byService = Object.fromEntries(
        containers.map((c) => [
          c.Config.Labels["com.docker.compose.service"],
          c,
        ]),
      );
      assert.ok(
        byService.dashboard && byService["control-api"] && byService.gateway,
      );
      for (const c of containers)
        for (const ports of Object.values(c.NetworkSettings.Ports ?? {}))
          for (const port of ports ?? [])
            assert.equal(port.HostIp, "127.0.0.1");
      const networks = [
        ...new Set(
          containers.flatMap((c) => Object.keys(c.NetworkSettings.Networks)),
        ),
      ];
      for (const net of JSON.parse(
        await dockerProduct(config, ["network", "inspect", ...networks], {
          capture: true,
        }),
      )) {
        if (net.Name.endsWith("_loopback-ingress")) {
          assert.deepEqual(
            Object.values(net.Containers).map((c) => c.Name),
            [byService.ingress.Name.slice(1)],
          );
        } else assert.equal(net.Internal, true);
      }
      assert.ok(
        byService.ingress.NetworkSettings.Ports["3000/tcp"].some(
          (p) => p.HostIp === "127.0.0.1" && p.HostPort === String(config.port),
        ),
      );
      for (const name of ["dashboard", "control-api", "agent"]) {
        const mounts = byService[name].Mounts.map((m) => m.Destination);
        assert.ok(
          !mounts.some((p) =>
            /target-token|opa-token|target-write-password|binding-key/.test(p),
          ),
        );
      }
      const probes = [];
      for (const [service, port] of [
        ["control-api", 4314],
        ["control-db", 5432],
        ["mock-target", 8080],
        ["target-db", 5432],
        ["opa", 8181],
      ]) {
        probes.push({ host: service, port });
        for (const net of Object.values(
          byService[service].NetworkSettings.Networks,
        ))
          probes.push({ host: net.IPAddress, port });
      }
      for (const net of Object.values(
        byService.gateway.NetworkSettings.Networks,
      ))
        probes.push({ host: net.IPAddress, port: 4315 });
      const isolated = JSON.parse(
        await composeProduct(
          config,
          ["exec", "-T", "agent", "node", "infra/product/agent-probe.mjs"],
          {
            capture: true,
            input: JSON.stringify({ kind: "isolation", probes }),
          },
        ),
      );
      assert.ok(isolated.probes.every((p) => !p.reachable));
      assert.deepEqual(isolated.secrets, []);
      assert.equal((await request("/api/actions", admin)).status, 404);
      assert.equal(
        (
          await agentCall(
            "not-a-real-token",
            { key: "not-a-real-key" },
            "/api/login",
          )
        ).status,
        404,
      );
      return {
        services: Object.keys(byService),
        internalNetworks: networks.length - 1,
        loopbackIngressNetworks: 1,
        deniedNetworkProbes: probes.length,
        agentSecrets: 0,
      };
    },
  );
  const made = await request("/api/agents", admin, {
    name: "Product acceptance task",
    tools: [
      "database_read",
      "database_update",
      "github_list_branches",
      "github_create_branch",
      "github_open_pull_request",
    ],
    resources: ["customers", "agentbrake/sandbox"],
    sandbox: true,
  });
  assert.equal(made.status, 201);
  const token = made.body.token,
    agent = made.body.agent;
  knownSecrets.push(token);
  await step(
    "permitted read succeeds and rejected SQL has zero upstream execution and unchanged target",
    async () => {
      const before = await snapshot();
      let r = await submit(token, "database_read", { limit: 1 });
      assert.equal(r.body.status, "allowed");
      assert.equal(r.body.result.rows.length, 1);
      const afterRead = await snapshot();
      assert.equal(afterRead.calls, before.calls + 1);
      r = await submit(token, "database_read", {
        limit: 1,
        sql: "DELETE FROM customers",
      });
      assert.equal(r.body.status, "blocked");
      assert.deepEqual(await snapshot(), afterRead);
      return { readCalls: 1, deniedCalls: 0, denialRule: r.body.rule };
    },
  );
  const pending = (
    await submit(token, "database_update", { id: 1, status: "paused" })
  ).body;
  assert.equal(pending.status, "pending");
  let review = (await request("/api/approvals/" + pending.id, reviewer)).body;
  await step(
    "preview, CSRF, role, no-self-review and exact fingerprint gate the real DB write",
    async () => {
      const before = await snapshot();
      assert.equal(review.action.preview.kind, "database-update");
      const body = { decision: "approve", proof: review.proof };
      assert.equal(
        (await request("/api/approvals/" + pending.id, admin, body)).status,
        403,
      );
      assert.equal(
        (await request("/api/approvals/" + pending.id, viewer, body)).status,
        403,
      );
      assert.equal(
        (
          await request(
            "/api/approvals/" + pending.id,
            { Cookie: reviewer.Cookie },
            body,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/api/approvals/" + pending.id, reviewer, {
            ...body,
            proof: { ...review.proof, nonce: randomUUID() },
          })
        ).status,
        409,
      );
      assert.deepEqual(await snapshot(), before);
      const results = await Promise.all([
        request("/api/approvals/" + pending.id, reviewer, body),
        request("/api/approvals/" + pending.id, reviewer, body),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const after = await snapshot();
      assert.equal(after.calls, before.calls + 1);
      assert.equal(
        after.customers.rows[0].version,
        before.customers.rows[0].version + 1,
      );
      return {
        deniedAttempts: 4,
        deniedCalls: 0,
        concurrentStatuses: [200, 409],
        mutations: 1,
      };
    },
  );
  await step(
    "PostgreSQL activity/history and honest evidence export",
    async () => {
      const page = await request(
        "/api/activity?agentId=" + agent.id + "&status=allowed&limit=1",
        viewer,
      );
      assert.equal(page.status, 200);
      assert.equal(page.body.items.length, 1);
      assert.equal(page.body.total, 2);
      const history = await request("/api/policies/history", viewer);
      assert.equal(history.status, 200);
      assert.ok(history.body.items.length > 0);
      const evidence = await request("/api/evidence/" + pending.id, viewer);
      assert.equal(evidence.status, 200);
      assert.equal(evidence.body.execution.observation, "adapter-reported");
      assert.equal(evidence.body.review.receipt.actorId, "approver");
      assert.equal(evidence.body.action.result, undefined);
      assert.equal(evidence.body.audit.valid, true);
      await save("sample-evidence.json", evidence.body);
      return {
        filteredTotal: page.body.total,
        actor: evidence.body.review.receipt.actorId,
        auditValid: true,
        observation: "adapter-reported",
      };
    },
  );
  // Git uses a separate non-tainted task, as required by the data boundary.
  let demo = await request("/api/demo", admin, { scenario: "pr-approval" });
  assert.equal(demo.status, 200);
  let branch = demo.body.actions.at(-1);
  assert.equal(branch.status, "pending");
  let proof = (await request("/api/approvals/" + branch.id, reviewer)).body
    .proof;
  assert.equal(
    (
      await request("/api/approvals/" + branch.id, reviewer, {
        decision: "approve",
        proof,
      })
    ).body.status,
    "allowed",
  );
  demo = await request("/api/demo", admin, { scenario: "pr-approval" });
  const pr = demo.body.actions.at(-1);
  assert.equal(pr.status, "pending");
  const prReview = (await request("/api/approvals/" + pr.id, reviewer)).body;
  assert.equal(prReview.action.preview.kind, "git-change");
  const waiting = (
    await submit(token, "database_update", { id: 2, status: "paused" })
  ).body;
  assert.equal(waiting.status, "pending");
  const waitingProof = (await request("/api/approvals/" + waiting.id, reviewer))
    .body.proof;
  const beforeRestart = await snapshot();
  const beforeRestartAudit = (await request("/api/audit/export", viewer)).body;
  assert.equal(beforeRestartAudit.valid, true);
  const creationAudit = beforeRestartAudit.entries.find(
    (row) =>
      row.data.type === "agent.created" &&
      row.data.details.agentId === agent.id,
  );
  assert.deepEqual(creationAudit.data.details.actor, {
    actorId: "administrator",
    tenant: "local",
  });
  assert.equal(
    creationAudit.data.details.correlationId,
    made.headers.get("x-correlation-id"),
  );
  await compose("stop-persistent", ["--profile", "agent", "down"]);
  await compose("restart-persistent", [
    "--profile",
    "agent",
    "up",
    "-d",
    "--wait",
    "--wait-timeout",
    "180",
  ]);
  admin = await login("administrator");
  reviewer = await login("approver");
  viewer = await login("viewer");
  operator = await login("operator");
  await step(
    "full installation restart preserves DB, Git branch, audit and pending review proofs",
    async () => {
      const after = await snapshot();
      const audit = (await request("/api/audit/export", viewer)).body;
      assert.equal(audit.valid, true);
      assert.deepEqual(audit.entries, beforeRestartAudit.entries);
      const csvResponse = await fetch(base + "/api/audit/export?format=csv", {
        headers: viewer,
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(csvResponse.status, 200);
      const csv = await csvResponse.text();
      assert.ok(
        csv.includes("administrator") &&
          csv.includes("tenant") &&
          csv.includes(creationAudit.data.details.correlationId),
      );
      assert.deepEqual(after.customers, beforeRestart.customers);
      assert.deepEqual(after.git, beforeRestart.git);
      assert.deepEqual(
        (await request("/api/approvals/" + waiting.id, reviewer)).body.proof,
        waitingProof,
      );
      assert.deepEqual(
        (await request("/api/approvals/" + pr.id, reviewer)).body.proof,
        prReview.proof,
      );
      const approved = await request("/api/approvals/" + pr.id, reviewer, {
        decision: "approve",
        proof: prReview.proof,
      });
      assert.equal(approved.body.status, "allowed");
      const state = await snapshot();
      assert.equal(state.git.mainSha, beforeRestart.git.mainSha);
      assert.equal(state.git.pullRequests.length, 1);
      assert.equal(
        (await request("/api/workspace", viewer)).body.auditValid,
        true,
      );
      return {
        pendingProofsPreserved: 2,
        mainUnchanged: true,
        mockPRs: 1,
        auditValid: true,
        trustedActorPreserved: true,
        csvActorPreserved: true,
      };
    },
  );
  await step(
    "policy change, task revoke and stop withdraw pending authority with no execution",
    async () => {
      let before = await snapshot();
      assert.equal(
        (
          await request(
            "/api/policies",
            admin,
            {
              reads: "allow",
              databaseWrites: "deny",
              githubWrites: "approval",
            },
            "PUT",
          )
        ).status,
        200,
      );
      let result = await request("/api/approvals/" + waiting.id, reviewer, {
        decision: "approve",
        proof: waitingProof,
      });
      assert.equal(result.body.status, "blocked");
      assert.deepEqual(await snapshot(), before);
      await request(
        "/api/policies",
        admin,
        {
          reads: "allow",
          databaseWrites: "approval",
          githubWrites: "approval",
        },
        "PUT",
      );
      assert.equal(
        (
          await request(
            "/api/agents/" + agent.id + "/grant/revoke",
            operator,
            {},
          )
        ).status,
        200,
      );
      result = await submit(token, "database_read", { limit: 1 });
      assert.equal(result.body.status, "blocked");
      assert.deepEqual(await snapshot(), before);
      await request("/api/control", admin, { paused: true });
      const stopped = await request("/api/demo", admin, {
        scenario: "safe-read",
      });
      assert.equal(stopped.body.actions[0].status, "blocked");
      assert.deepEqual(await snapshot(), before);
      await request("/api/control", admin, { paused: false });
      const audit = (await request("/api/audit/export", viewer)).body;
      const revoke = audit.entries.findLast(
        (row) =>
          row.data.type === "grant.revoked" &&
          row.data.details.agentId === agent.id,
      );
      assert.deepEqual(revoke.data.details.actor, {
        actorId: "operator",
        tenant: "local",
      });
      for (const row of audit.entries.filter((row) =>
        ["control.changed", "policy.changed"].includes(row.data.type),
      )) {
        assert.deepEqual(row.data.details.actor, {
          actorId: "administrator",
          tenant: "local",
        });
        assert.match(row.data.details.correlationId, /^[a-f0-9-]{36}$/);
      }
      return {
        policyDenial: true,
        revocationDenial: true,
        emergencyStopDenial: true,
        executionCalls: 0,
        crossOwnerRevoker: "operator",
      };
    },
  );
  await step(
    "PDP outage fails closed through the product Gateway",
    async () => {
      await compose("pdp-stop", ["stop", "opa"]);
      try {
        const before = await snapshot();
        const demo = await request("/api/demo", admin, {
          scenario: "safe-read",
        });
        assert.equal(demo.body.actions[0].status, "blocked");
        assert.deepEqual(await snapshot(), before);
        return {
          status: demo.body.actions[0].status,
          rule: demo.body.actions[0].rule,
          calls: 0,
        };
      } finally {
        await compose("pdp-start", ["start", "opa"]);
      }
    },
  );
  await compose("target-restart", ["restart", "mock-target"]);
  for (let i = 0; i < 30; i++) {
    try {
      const state = await snapshot();
      assert.equal(state.git.pullRequests.length, 1);
      report.cases.push({
        name: "persistent mock PR survives target process restart",
        result: "PASS",
        observed: { mockPRs: 1 },
      });
      break;
    } catch (error) {
      if (i === 29) throw error;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const finalManifest = await sourceManifest();
  report.sourceChangedDuringRun =
    manifest.sourceHash !== finalManifest.sourceHash;
  report.result = report.sourceChangedDuringRun
    ? "PASS_RUNTIME_SOURCE_CHANGED"
    : "PASS_LOCAL_PRODUCT";
} catch (error) {
  report.result = "FAIL";
  report.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (up) {
    try {
      await compose("cleanup", ["--profile", "agent", "down", "--volumes"]);
      const containers = (
        await dockerProduct(
          config,
          [
            "ps",
            "-aq",
            "--filter",
            "label=com.docker.compose.project=" + config.project,
          ],
          { capture: true },
        )
      ).trim();
      const volumes = (
        await dockerProduct(
          config,
          [
            "volume",
            "ls",
            "-q",
            "--filter",
            "label=com.agentbrake.product=" + config.id,
          ],
          { capture: true },
        )
      ).trim();
      const networks = (
        await dockerProduct(
          config,
          [
            "network",
            "ls",
            "-q",
            "--filter",
            "label=com.docker.compose.project=" + config.project,
          ],
          { capture: true },
        )
      ).trim();
      assert.equal(containers + volumes + networks, "");
      report.cleanup = {
        result: "PASS",
        containers: 0,
        volumes: 0,
        networks: 0,
      };
    } catch (error) {
      report.cleanup = { result: "FAIL", error: error.message };
      report.result = "FAIL";
      process.exitCode = 1;
    }
  }
  report.finishedAt = new Date().toISOString();
  await save("product-summary.json", report);
  await writeFile(
    "docs/evidence/latest-product.json",
    JSON.stringify({ runId, directory, result: report.result }, null, 2),
  );
  console.log(report.result + ": " + directory);
}
