import test from "node:test";
import assert from "node:assert/strict";
import { controlProxy } from "../../apps/dashboard/lib/control-proxy.js";
const origin = "http://127.0.0.1:44215";
function request(path: string, options: RequestInit = {}, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/" + path, { ...options, headers: { host: "127.0.0.1:44215", origin, "content-type": "application/json", ...headers } });
}

test("account routes allow exact methods and retain origin and route boundaries", async () => {
  const transport: typeof fetch = async () => Response.json({ ok: true });
  const allowed: [string, string[]][] = [
    ["setup", ["GET", "POST"]], ["profile", ["GET", "PATCH"]], ["team", ["GET"]],
    ["invitations/accept", ["POST"]], ["password/reset", ["POST"]], ["password/change", ["POST"]],
    ["team/invitations", ["POST"]], ["team/invitations/fixture-id", ["DELETE"]],
    ["team/fixture-id", ["PATCH"]], ["team/fixture-id/recovery", ["POST"]],
  ];
  for (const [path, methods] of allowed) {
    for (const method of methods) {
      const init = { method, ...(method !== "GET" ? { body: "{}" } : {}) };
      assert.equal((await controlProxy(request(path, init), path.split("/"), undefined, transport)).status, 200, `${method} ${path}`);
      assert.equal((await controlProxy(request(path, init, { origin: "http://attacker.invalid" }), path.split("/"), undefined, transport)).status, 403);
    }
    assert.equal((await controlProxy(request(path, { method: "PUT", body: "{}" }), path.split("/"), undefined, transport)).status, 405);
  }
  for (const path of ["team/members/x/delete", "team/invitations/x/accept", "password", "setup/x"]) {
    assert.equal((await controlProxy(request(path), path.split("/"), undefined, transport)).status, 404);
  }
});
test("dashboard proxy rejects untrusted origins, routes, destinations and oversized or malformed bodies before dispatch", async () => {
  let calls = 0; const transport: typeof fetch = async () => { calls++; return Response.json({ ok: true }); };
  const cases: [Request, string[], string, number][] = [
    [request("login", { method: "POST", body: "{}" }, { origin: "http://attacker.invalid" }), ["login"], "http://127.0.0.1:4314", 403],
    [request("workspace", {}, { host: "attacker.invalid" }), ["workspace"], "http://127.0.0.1:4314", 403],
    [request("mcp"), ["mcp"], "http://127.0.0.1:4314", 404],
    [request("workspace"), ["workspace"], "https://example.com", 503],
    [request("workspace", { method: "DELETE" }), ["workspace"], "http://127.0.0.1:4314", 405],
    [request("login", { method: "POST", body: "{}" }, { "content-length": "32769" }), ["login"], "http://127.0.0.1:4314", 413],
    [request("login", { method: "POST", body: JSON.stringify({ key: "x".repeat(32768) }) }), ["login"], "http://127.0.0.1:4314", 413],
    [request("login", { method: "POST", body: "{" }), ["login"], "http://127.0.0.1:4314", 400],
  ];
  for (const [input, path, target, expected] of cases) assert.equal((await controlProxy(input, path, target, transport)).status, expected);
  assert.equal(calls, 0);
});
test("dashboard proxy binds backend host/origin, preserves CSRF/cookie and streams the response without forwarding bearer credentials", async () => {
  let observed = false;
  const transport: typeof fetch = async (url, options) => {
    assert.equal(String(url), "http://control-api:4314/api/control");
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("host"), "control-api:4314"); assert.equal(headers.get("origin"), "http://control-api:4314");
    assert.equal(headers.get("cookie"), "ab_session=test-fixture"); assert.equal(headers.get("x-ab-csrf"), "fixture-csrf");
    assert.equal(headers.get("authorization"), null); assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store");
    assert.equal(options?.body, '{"paused":true}'); observed = true;
    return new Response("data: observed\n\n", { headers: { "content-type": "text/event-stream", "set-cookie": "ab_session=new; HttpOnly; Path=/api" } });
  };
  const result = await controlProxy(request("control", { method: "POST", body: '{"paused":true}' }, { cookie: "ab_session=test-fixture", "x-ab-csrf": "fixture-csrf", authorization: "Bearer must-not-leave-dashboard" }), ["control"], "http://control-api:4314", transport);
  assert.ok(observed); assert.equal(result.headers.get("content-type"), "text/event-stream"); assert.match(result.headers.get("set-cookie")!, /HttpOnly/); assert.equal(await result.text(), "data: observed\n\n");
});
test("dashboard validates browser origin against trusted Host when Next reconstructs an internal listening URL", async () => {
  const input = new Request("http://0.0.0.0:3000/api/login", { method: "POST", headers: { host: "127.0.0.1:44215", origin, "content-type": "application/json" }, body: "{}" });
  assert.equal((await controlProxy(input, ["login"], "http://127.0.0.1:4314", async () => Response.json({ ok: true }))).status, 200);
});

