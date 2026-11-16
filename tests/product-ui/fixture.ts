import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../server/app.js";
import { OpaEvaluator } from "../../server/policy/opa-client.js";
import { databasePreview } from "../../server/adapters/preview.js";
import { GitFixtureAdapter } from "../../server/adapters/git-fixture.js";
import { keys, backend } from "./constants.js";
// @ts-expect-error The existing verified native OPA launcher is plain JavaScript.
import { startOpa } from "../../scripts/opa-runtime.mjs";

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "agentbrake-product-ui-"));
const targetToken = "isolated-ui-target-credential-0000000000";
let opa: Awaited<ReturnType<typeof startOpa>> | undefined;
let git: GitFixtureAdapter | undefined;
let system: ReturnType<typeof createApp> | undefined;
let target: Server | undefined, control: Server | undefined, dashboard: ChildProcess | undefined;
let closing = false;
async function close() {
  if (closing) return; closing = true;
  if (dashboard && dashboard.exitCode === null) { const exited = once(dashboard, "exit"); dashboard.kill(); await exited; }
  for (const server of [control, target]) if (server) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
  await system?.close(); await git?.close(); await opa?.stop();
  if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep)) throw Error("Unsafe fixture cleanup path");
  await rm(temporary, { recursive: true, force: true });
}
try {
  opa = await startOpa(); git = await GitFixtureAdapter.create(join(temporary, "repository.git"));
  const rows = [{ id: 1, status: "active", version: 0 }, { id: 2, status: "active", version: 0 }, { id: 3, status: "active", version: 0 }];
  const executions: Record<number, number> = {};
  const adapter = git;
  target = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${targetToken}`) { res.writeHead(401).end(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); res.setHeader("Content-Type", "application/json");
    try {
      if (body.tool.startsWith("github_")) { const operation = { ...body, sandbox: true }; res.end(JSON.stringify(req.url === "/preview" ? await adapter.preview(operation) : await adapter.execute(operation))); return; }
      const row = rows.find(value => value.id === body.arguments.id);
      if (req.url === "/preview") { res.end(JSON.stringify(databasePreview(row, body.arguments.status))); return; }
      if (body.tool === "database_read") { res.end(JSON.stringify({ rows: rows.slice(0, body.arguments.limit) })); return; }
      if (!row || body.precondition?.version !== row.version) { res.writeHead(409).end(); return; }
      row.status = body.arguments.status; row.version++; executions[row.id] = (executions[row.id] ?? 0) + 1;
      // Actual committed target mutation with an actual lost response: Gateway
      // transport times out and records UNKNOWN. No fabricated API status.
      if (row.id === 2) return;
      res.end(JSON.stringify(row));
    } catch { res.writeHead(400).end(JSON.stringify({ error: "Fixture operation failed" })); }
  });
  target.listen(0, "127.0.0.1"); await once(target, "listening");
  system = createApp({ databasePath: ":memory:", adminKey: keys.administrator, managedAccounts: process.argv.includes("--managed"),
    operators: Object.entries(keys).map(([role, key]) => ({ id: role, name: `Fixture ${role}`, tenant: "local", role: role as keyof typeof keys, key })),
    connections: { fixture: { url: `http://127.0.0.1:${(target.address() as { port: number }).port}`, token: targetToken } },
    policy: new OpaEvaluator({ url: opa.url, token: opa.token, timeoutMs: 1000 }),
  });
  // Read-only diagnostic endpoint exists only in this ephemeral test fixture.
  system.app.get("/__fixture", (_req, res) => res.json({ rows, executions }));
  // Explicit test-only clock boundary: expire only existing invitations, without
  // changing production time/KDF/session behavior or exposing persisted secrets.
  if (process.argv.includes("--managed")) system.app.post("/__fixture/expire-invitations", async (_req,res) => {
    await system!.store.changeIdentity(state => {
      for (const invitation of state.invitations) invitation.expiresAt = Date.now() - 1;
      return {result:undefined,audit:{type:"fixture.invitation-expired",details:{actorId:"fixture",targetId:"fixture",reason:"bounded-expiry-test"}}};
    });
    res.json({ok:true});
  });
  control = system.app.listen(44214, "127.0.0.1"); await once(control, "listening");
  await cp(join(root, "apps/dashboard/.next/static"), join(root, "apps/dashboard/.next/standalone/apps/dashboard/.next/static"), { recursive: true });
  dashboard = spawn(process.execPath, [join(root, "apps/dashboard/.next/standalone/apps/dashboard/server.js")], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
      NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", HOSTNAME: "127.0.0.1", PORT: "44215", AGENTBRAKE_CONTROL_URL: backend,
    },
  });
  dashboard.stdout?.pipe(process.stdout); dashboard.stderr?.pipe(process.stderr);
  dashboard.once("exit", () => { if (!closing) void close().finally(() => process.exit(1)); });
  process.once("SIGINT", () => void close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
  process.on("message", value => { if (value === "close") void close().finally(() => process.exit(0)); });
} catch (error) { await close(); throw error; }

