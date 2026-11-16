import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { LocalTelemetry } from "../../server/telemetry.js";
import { createApp } from "../../server/app.js";
test("real HTTP OpenTelemetry spans contain correlation/outcome but never request secrets or raw paths", async () => {
  const lines: string[] = [],
    telemetry = new LocalTelemetry("control", (line) => lines.push(line));
  const key = "telemetry-secret-login-0000000000000000000";
  const system = createApp({
    databasePath: ":memory:",
    adminKey: key,
    telemetry,
  });
  const server = system.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  try {
    const response = await fetch(
      base + "/api/login?secret=private-query-sentinel",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer private-header-sentinel",
        },
        body: JSON.stringify({ key }),
      },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("x-trace-id")!, /^[a-f0-9]{32}$/);
    await response.json();
    await telemetry.shutdown();
    assert.equal(lines.length, 1);
    const span = JSON.parse(lines[0]).resourceSpans[0].scopeSpans[0].spans[0];
    assert.equal(span.traceId, response.headers.get("x-trace-id"));
    assert.ok(
      span.attributes.some(
        (a: any) =>
          a.key === "agentbrake.correlation_id" &&
          a.value.stringValue === response.headers.get("x-correlation-id"),
      ),
    );
    for (const secret of [
      key,
      "private-query-sentinel",
      "private-header-sentinel",
    ])
      assert.ok(!lines.join("").includes(secret));
    assert.ok(
      span.attributes.some(
        (a: any) =>
          a.key === "http.route" && a.value.stringValue === "/api/login",
      ),
    );
  } finally {
    server.closeAllConnections();
    server.close();
    await system.close();
  }
});
