// The only externally connected GitHub component. No key mounts, arbitrary
// destinations, redirects or CONNECT support. Agent network is not attached.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function createGitHubEgress(config, transport = fetch) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(config.repository) ||
      !Number.isSafeInteger(config.repositoryId) || config.repositoryId < 1 || !Number.isSafeInteger(config.installationId) || config.installationId < 1) throw Error('Invalid GitHub egress scope');
  const prefix = '/repos/' + config.repository;
  const server = createServer({ maxHeaderSize: 16384 }, async (req, res) => {
    const fail = status => { if (!res.headersSent) { res.writeHead(status, { 'Content-Type': 'application/json', 'Connection': 'close' }); res.end('{"error":"GitHub egress request rejected"}'); } else res.destroy(); };
    const mint = req.method === 'POST' && req.url === `/app/installations/${config.installationId}/access_tokens`;
    const suffix = req.url?.startsWith(prefix) ? req.url.slice(prefix.length) : null;
    const read = req.method === 'GET' && suffix !== null && (
      suffix === '' || suffix === '/branches?per_page=100' || suffix === '/branches/main' ||
      /^\/git\/(commits|blobs)\/[a-f0-9]{40}$/.test(suffix) || /^\/git\/trees\/[a-f0-9]{40}\?recursive=1$/.test(suffix) ||
      /^\/git\/ref\/heads\/agentbrake\/[a-z0-9-]{1,48}$/.test(suffix) ||
      /^\/pulls\?state=all&head=[A-Za-z0-9-]+%3Aagentbrake%2F[a-z0-9-]{1,48}&base=main&per_page=100$/.test(suffix));
    const write = suffix !== null && ((req.method === 'POST' && ['/git/refs', '/git/trees', '/git/commits', '/pulls'].includes(suffix)) ||
      (req.method === 'PATCH' && /^\/git\/refs\/heads\/agentbrake\/[a-z0-9-]{1,48}$/.test(suffix)));
    if ((!mint && !read && !write) || !/^Bearer [^\r\n]{1,8192}$/.test(req.headers.authorization ?? '')) return fail(403);
    if (Number(req.headers['content-length'] ?? 0) > 32768) return fail(413);
    const chunks = []; let size = 0;
    try {
      for await (const chunk of req) { size += chunk.length; if (size > 32768) return fail(413); chunks.push(chunk); }
      const body = Buffer.concat(chunks).toString('utf8');
      if (read && size) return fail(403);
      if (!read) {
        const parsed = JSON.parse(body);
        if (mint && (Object.keys(parsed).sort().join(',') !== 'permissions,repository_ids' ||
          JSON.stringify(parsed.repository_ids) !== JSON.stringify([config.repositoryId]) ||
          Object.keys(parsed.permissions ?? {}).sort().join(',') !== 'contents,pull_requests' || parsed.permissions.contents !== 'write' || parsed.permissions.pull_requests !== 'write')) return fail(403);
        if (suffix === '/git/refs' && (!/^refs\/heads\/agentbrake\/[a-z0-9-]{1,48}$/.test(parsed.ref) || !/^[a-f0-9]{40}$/.test(parsed.sha))) return fail(403);
        if (req.method === 'PATCH' && parsed.force !== false) return fail(403);
        if (suffix === '/pulls' && (parsed.base !== 'main' || parsed.draft !== true || parsed.maintainer_can_modify !== false)) return fail(403);
      }
      const result = await transport(new URL(req.url, 'https://api.github.com'), { method: req.method,
        headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', Authorization: req.headers.authorization,
          'User-Agent': 'AgentBrake', 'X-GitHub-Api-Version': '2022-11-28' },
        ...(read ? {} : { body }), redirect: 'error', signal: AbortSignal.timeout(6000) });
      if (result.status >= 300 && result.status < 400) { await result.body?.cancel(); return fail(502); }
      const reader = result.body?.getReader(); if (!reader) return fail(502);
      const output = []; let length = 0;
      try { while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length;
        if (length > 128000) { await reader.cancel(); return fail(502); } output.push(next.value); } }
      finally { reader.releaseLock(); }
      // Success bodies go only to the private Gateway. Upstream error bodies may contain sensitive material.
      res.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(result.ok ? Buffer.concat(output) : '{"error":"GitHub request failed"}');
    } catch { fail(502); }
  });
  server.maxConnections = 64; server.headersTimeout = 10000; server.requestTimeout = 15000; server.keepAliveTimeout = 5000;
  server.on('connect', (_req, socket) => socket.destroy()); server.on('upgrade', (_req, socket) => socket.destroy());
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createGitHubEgress(JSON.parse(await readFile('/run/config/github-app.json', 'utf8')));
  server.listen(8080, '0.0.0.0'); process.on('SIGTERM', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
}
