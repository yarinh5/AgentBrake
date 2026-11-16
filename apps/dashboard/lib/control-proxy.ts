const MAX_BODY = 32 * 1024;
const id = "[a-zA-Z0-9_-]{1,100}";
const routes: [RegExp, string[]][] = [
  [/^setup$/, ["GET", "POST"]],
  [/^profile$/, ["GET", "PATCH"]],
  [/^team$/, ["GET"]],
  [/^(?:invitations\/accept|password\/(?:reset|change)|team\/invitations)$/, ["POST"]],
  [new RegExp(`^team/invitations/${id}$`), ["DELETE"]],
  [new RegExp(`^team/${id}$`), ["PATCH"]],
  [new RegExp(`^team/${id}/recovery$`), ["POST"]],
  [/^(?:health|session|workspace|activity|policies\/history|audit\/export)$/, ["GET"]],
  [/^events$/, ["GET"]],
  [/^(?:login|logout|control|demo|agents)$/, ["POST"]],
  [/^policies$/, ["PUT"]],
  [new RegExp(`^agents/${id}$`), ["PATCH"]],
  [new RegExp(`^agents/${id}/grant(?:/revoke)?$`), ["POST"]],
  [new RegExp(`^approvals/${id}$`), ["GET", "POST"]],
  [new RegExp(`^evidence/${id}(?:/export)?$`), ["GET"]],
];
const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
export async function controlProxy(request: Request, path: string[], configured = process.env.AGENTBRAKE_CONTROL_URL ?? "http://127.0.0.1:4314", transport: typeof fetch = fetch, publicOrigin = process.env.AGENTBRAKE_PUBLIC_ORIGIN) {
  const browser = new URL(request.url);
  const host = request.headers.get("host") ?? "";
  let dashboardOrigin: string;
  if (publicOrigin !== undefined) {
    let configuredOrigin: URL;
    try {
      configuredOrigin = new URL(publicOrigin);
      if (configuredOrigin.protocol !== 'https:' || configuredOrigin.origin !== publicOrigin || configuredOrigin.username || configuredOrigin.password) throw Error();
    } catch { return fail(503, 'HTTPS dashboard origin configuration is invalid'); }
    if (host !== configuredOrigin.host) return fail(403, 'Dashboard requires its configured HTTPS host');
    dashboardOrigin = configuredOrigin.origin;
  } else {
    if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/.test(host) || browser.protocol !== "http:") return fail(403, "Dashboard requires a trusted loopback HTTP host");
    dashboardOrigin = `http://${host}`;
  }
  // Next reconstructs Request.url using its listening hostname (localhost or
  // 0.0.0.0), which can differ from the browser's loopback Host. Validate the
  // actual Host first and derive the browser origin from that trusted header.
  const origin = request.headers.get("origin");
  if ((origin && origin !== dashboardOrigin) || (request.method !== "GET" && origin !== dashboardOrigin)) return fail(403, "Dashboard origin verification failed");
  const pathname = path.join("/");
  if (path.some(segment => !/^[a-zA-Z0-9_-]+$/.test(segment)) || pathname.length > 220) return fail(404, "Unsupported dashboard API route");
  const route = routes.find(([pattern]) => pattern.test(pathname));
  if (!route) return fail(404, "Unsupported dashboard API route");
  if (!route[1].includes(request.method)) return fail(405, "Unsupported dashboard API method");
  // This server-only destination is never read from browser input.
  let backend: URL;
  try {
    backend = new URL(configured);
    if (backend.protocol !== "http:" || !["127.0.0.1", "localhost", "control-api"].includes(backend.hostname) || backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash) throw Error();
  } catch { return fail(503, "Local control API configuration is invalid"); }
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) return fail(413, "Request exceeds the 32 KiB limit");
  let body: string | undefined;
  if (request.method !== "GET") {
    if (!request.headers.get("content-type")?.match(/^application\/json(?:\s*;|$)/i)) return fail(415, "JSON body required");
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      if (reader) while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_BODY) { await reader.cancel(); return fail(413, "Request exceeds the 32 KiB limit"); }
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      JSON.parse(body);
    } catch { return fail(400, "Malformed JSON request"); }
    finally { reader?.releaseLock(); }
  }
  const headers = new Headers({ "Accept": "application/json", "Host": backend.host, "Origin": backend.origin });
  for (const name of ["cookie", "x-ab-csrf"]) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const target = new URL(`/api/${pathname}`, backend); target.search = browser.search;
  try {
    const response = await transport(target, { method: request.method, headers, body, redirect: "error", cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]) });
    const outgoing = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-type", "content-disposition", "x-correlation-id"]) { const value = response.headers.get(name); if (value) outgoing.set(name, value); }
    for (const cookie of response.headers.getSetCookie()) {
      if (publicOrigin && !/;\s*Secure(?:;|$)/i.test(cookie)) { await response.body?.cancel(); return fail(502, 'HTTPS session configuration is invalid'); }
      outgoing.append("Set-Cookie", cookie);
    }
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch { return fail(502, "Local control API unavailable. Inspect recorded state before repeating a mutation."); }
}
