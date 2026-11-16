import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { databasePreview } from "../../server/adapters/preview.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "agentbrake-restart-"));
  const admin = "local-restart-binding-0000000000000000",
    token = "local-target-credential-000000000000000";
  let row = { id: 1, status: "active", version: 0 },
    executions = 0,
    loseResponse = false,
    committed: () => void = () => {};
  const target = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer " + token) {
      res.writeHead(401).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/preview") {
      res.end(JSON.stringify(databasePreview(row, body.arguments.status)));
      return;
    }
    if (req.url !== "/execute" || body.precondition?.version !== row.version) {
      res.writeHead(409).end();
      return;
    }
    executions++;
    row = { ...row, status: body.arguments.status, version: row.version + 1 };
    committed();
    if (!loseResponse) res.end(JSON.stringify(row)); // Real committed write with deliberately lost HTTP response.
  });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  let child: ChildProcess | undefined,
    base = "",
    cookie = "";
  const request = async (path: string, body?: unknown, bearer?: string) => {
    const res = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bearer
          ? { Authorization: "Bearer " + bearer }
          : { Cookie: cookie }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  const start = async () => {
    child = fork(join(process.cwd(), "tests/fixtures/restart-gateway.ts"), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        OPA_URL: process.env.OPA_URL,
        OPA_TOKEN: process.env.OPA_TOKEN,
        AGENTBRAKE_RESTART_TEST: "1",
        FIXTURE_DATABASE: join(dir, "control.sqlite"),
        FIXTURE_ADMIN: admin,
        FIXTURE_TOKEN: token,
        FIXTURE_TARGET:
          "http://127.0.0.1:" + (target.address() as { port: number }).port,
      },
    });
    child.stderr?.resume();
    const active = child;
    const message = await new Promise<{ port: number }>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("Gateway startup timed out")),
        10000,
      );
      active.once("message", (m) => {
        clearTimeout(timeout);
        resolve(m as { port: number });
      });
      active.once("exit", (code) => {
        clearTimeout(timeout);
        reject(Error("Gateway exited " + code));
      });
    });
    base = "http://127.0.0.1:" + message.port;
    const login = await request("/api/login", { key: admin });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
  };
  const stop = async (crash = false) => {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, "exit");
    if (crash) child.kill("SIGKILL");
    else child.send("close");
    await exited;
  };
  try {
    await start();
  } catch (error) {
    await stop(true);
    target.closeAllConnections();
    target.close();
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  const pending = async () => {
    const created = await request("/api/agents", {
      name: "Restart fixture",
      tools: ["database_update"],
      resources: ["customers"],
      sandbox: true,
    });
    assert.equal(created.status, 201);
    const input = {
      requestId: randomUUID(),
      tool: "database_update",
      arguments: { id: 1, status: "paused" },
    };
    const action = await request("/api/actions", input, created.body.token);
    assert.equal(action.body.status, "pending");
    const review = await request("/api/approvals/" + action.body.id);
    assert.equal(review.status, 200);
    return {
      action: action.body,
      input,
      token: created.body.token,
      proof: review.body.proof,
    };
  };
  return {
    request,
    pending,
    start,
    stop,
    state: () => ({ row, executions }),
    lose: () => {
      loseResponse = true;
      return new Promise<void>((r) => {
        committed = r;
      });
    },
    close: async () => {
      await stop(true);
      target.closeAllConnections();
      await new Promise<void>((r) => target.close(() => r()));
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test("actual HTTP response loss after mutation yields UNKNOWN and same request never dispatches again", async () => {
  const f = await fixture();
  try {
    const p = await f.pending();
    const committed = f.lose();
    const approve = f.request("/api/approvals/" + p.action.id, {
      decision: "approve",
      proof: p.proof,
    });
    await committed;
    const result = await approve;
    assert.equal(result.body.status, "unknown");
    assert.deepEqual(f.state(), {
      row: { id: 1, status: "paused", version: 1 },
      executions: 1,
    });
    assert.equal(
      (await f.request("/api/actions", p.input, p.token)).body.status,
      "unknown",
    );
    assert.equal(
      (
        await f.request("/api/approvals/" + p.action.id, {
          decision: "approve",
          proof: p.proof,
        })
      ).status,
      409,
    );
    assert.equal(f.state().executions, 1);
  } finally {
    await f.close();
  }
});
test("pending review survives a real process restart with unchanged proof and executes exactly once", async () => {
  const f = await fixture();
  try {
    const p = await f.pending();
    await f.stop();
    await f.start();
    const review = await f.request("/api/approvals/" + p.action.id);
    assert.deepEqual(review.body.proof, p.proof);
    assert.equal(f.state().executions, 0);
    assert.equal(
      (
        await f.request("/api/approvals/" + p.action.id, {
          decision: "approve",
          proof: p.proof,
        })
      ).body.status,
      "allowed",
    );
    assert.equal(
      (await f.request("/api/actions", p.input, p.token)).body.status,
      "allowed",
    );
    assert.equal(f.state().executions, 1);
  } finally {
    await f.close();
  }
});
test("process crash after target commit recovers as UNKNOWN without replaying the write", async () => {
  const f = await fixture();
  try {
    const p = await f.pending();
    const committed = f.lose();
    const inflight = f
      .request("/api/approvals/" + p.action.id, {
        decision: "approve",
        proof: p.proof,
      })
      .catch(() => undefined);
    await committed;
    await f.stop(true);
    await inflight;
    await f.start();
    const recovered = await f.request(
      "/api/actions/" + p.action.id,
      undefined,
      p.token,
    );
    assert.equal(recovered.body.status, "unknown");
    assert.equal(
      (await f.request("/api/actions", p.input, p.token)).body.status,
      "unknown",
    );
    assert.deepEqual(f.state(), {
      row: { id: 1, status: "paused", version: 1 },
      executions: 1,
    });
  } finally {
    await f.close();
  }
});
