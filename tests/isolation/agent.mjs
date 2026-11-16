import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import net from "node:net";
const phase = process.argv[2],
  targets = JSON.parse(process.argv[3] ?? "{}");
const credential = JSON.parse(
  await readFile("/run/agent-credential.json", "utf8"),
);
const base = "http://gateway:4313";
const cases = [];
const post = async (tool, args = {}, token = credential.token) => {
  const r = await fetch(base + "/api/actions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requestId: randomUUID(), tool, arguments: args }),
    signal: AbortSignal.timeout(5000),
  });
  return { http: r.status, body: await r.json() };
};
if (phase === "network") {
  for (const path of [
    "/var/run/docker.sock",
    "/run/docker.sock",
    "/run/secrets/admin-key",
    "/run/secrets/opa-token",
    "/run/secrets/target-token",
    "/run/secrets/bootstrap-password",
    "/run/secrets/control-password",
    "/run/secrets/target-read-password",
    "/run/secrets/target-write-password",
    "/run/secrets/control-owner-password",
    "/app/.env",
  ]) {
    const exists = await access(path).then(
      () => true,
      () => false,
    );
    assert.equal(exists, false, `Forbidden mount ${path}`);
  }
  assert.equal(process.getuid(), 1000);
  assert.ok(
    !Object.keys(process.env).some((k) =>
      /^(OPA_|DATABASE_URL|POSTGRES_|GITHUB_TOKEN|ADMIN_KEY)/.test(k),
    ),
  );
  const routes = await readFile("/proc/net/route", "utf8");
  assert.ok(
    !routes
      .split("\n")
      .some((line) => line.trim().split(/\s+/)[1] === "00000000"),
    "Agent has an external default route",
  );
  for (const [name, host, port] of [
    ["target-http", targets.target, 8080],
    ["target-postgres", targets.postgres, 5432],
    ["control-postgres", targets.control, 5432],
    ["opa", targets.opa, 8181],
    ["desktop-engine", "192.168.65.7", 2375],
    ["bridge-engine", targets.edgeGateway, 2375],
  ]) {
    assert.ok(host);
    const connected = await new Promise((resolve) => {
      const socket = net.connect({ host, port });
      socket.setTimeout(1500);
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
    assert.equal(connected, false, `Direct TCP reached ${name}`);
    cases.push({ case: name, tcpConnected: connected, result: "PASS" });
  }
  const commands = [
    [
      "curl",
      [
        "--silent",
        "--show-error",
        "--connect-timeout",
        "2",
        "--max-time",
        "3",
        `http://${targets.target}:8080/health`,
      ],
    ],
    [
      "psql",
      [
        "-h",
        targets.postgres,
        "-U",
        "agent_without_credentials",
        "-d",
        "agentbrake_target_fixture",
        "-c",
        "SELECT 1",
      ],
    ],
    ["git", ["ls-remote", `http://${targets.target}:8080/repository.git`]],
  ];
  for (const [command, args] of commands) {
    const r = spawnSync(command, args, {
      encoding: "utf8",
      timeout: 4000,
      env: {
        ...process.env,
        PGCONNECT_TIMEOUT: "2",
        GIT_TERMINAL_PROMPT: "0",
        HOME: "/tmp",
      },
    });
    assert.notEqual(r.status, 0, `${command} bypass succeeded`);
    assert.notEqual(
      r.error?.code,
      "ENOENT",
      `${command} must actually be installed`,
    );
    cases.push({
      case: "direct-" + command,
      exitCode: r.status,
      signal: r.signal ?? null,
      result: "PASS",
    });
  }
  const admin = await fetch(base + "/api/workspace", {
    headers: { Authorization: `Bearer ${credential.token}` },
  });
  assert.equal(admin.status, 401);
  cases.push({
    case: "agent-cannot-administer",
    http: admin.status,
    result: "PASS",
  });
} else if (phase === "allowed") {
  const r = await fetch(base + "/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": "database_read",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "database_read",
        arguments: { limit: 2 },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
  assert.equal(r.status, 200);
  const envelope = await r.json();
  const action = JSON.parse(envelope.result.content[0].text);
  assert.equal(action.status, "allowed");
  assert.equal(action.result.rows.length, 2);
  cases.push({
    case: "mediated-mcp-read",
    status: action.status,
    rows: 2,
    correlationId: action.correlationId,
    result: "PASS",
  });
} else if (phase === "denied") {
  for (const [name, tool, args, token] of [
    [
      "outside-repo",
      "github_read_file",
      { repo: "outside/repo", path: "README.md" },
      credential.token,
    ],
    [
      "destructive-sql",
      "database_delete",
      { sql: "DROP TABLE customers" },
      credential.token,
    ],
    ["expired-grant", "database_read", {}, credential.expiredToken],
    ["invalid-token", "database_read", {}, "invalid-synthetic-token"],
    ["unknown-tool", "not_registered", {}, credential.token],
  ]) {
    const r = await post(tool, args, token);
    assert.ok(r.http === 401 || r.body.status === "blocked");
    cases.push({
      case: name,
      http: r.http,
      status: r.body.status ?? "unauthenticated",
      correlationId: r.body.correlationId ?? null,
      result: "PASS",
    });
  }
} else if (phase === "pdp-down") {
  const r = await post("database_read");
  assert.equal(r.body.status, "blocked");
  assert.match(r.body.rule, /pdp-/);
  cases.push({
    case: "pdp-down",
    status: r.body.status,
    rule: r.body.rule,
    result: "PASS",
  });
} else throw new Error("Unknown probe phase");
console.log(JSON.stringify({ phase, cases }));
