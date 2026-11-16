import { createServer } from 'node:https';
import { request as upstreamRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const hop = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
export function createHttpsIngress({ origin, cert, key, backend = 'http://dashboard:3000' }) {
  const publicUrl = new URL(origin), target = new URL(backend);
  if (publicUrl.protocol !== 'https:' || publicUrl.origin !== origin || publicUrl.username || publicUrl.password)
    throw Error('A canonical HTTPS public origin is required');
  if (target.protocol !== 'http:' || !['dashboard', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/' || target.search || target.hash || target.username || target.password)
    throw Error('Only the private dashboard destination is supported');
  const server = createServer({ cert, key, minVersion: 'TLSv1.2', maxHeaderSize: 16384 }, async (req, res) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const fail = status => { res.writeHead(status, { 'Content-Type': 'text/plain', 'Connection': 'close' }); res.end('Request rejected'); };
    if (req.headers.host !== publicUrl.host) return fail(421);
    if (!req.url?.startsWith('/') || req.url.startsWith('//') || /[\\\r\n]/.test(req.url)) return fail(400);
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return fail(405);
    if (req.headers['content-length'] && (!/^\d+$/.test(req.headers['content-length']) || Number(req.headers['content-length']) > 32768)) return fail(413);
    const chunks = []; let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 32768) return fail(413);
        chunks.push(chunk);
      }
    } catch { if (!res.headersSent) fail(400); return; }
    const nominated = new Set(String(req.headers.connection ?? '').toLowerCase().split(',').map(x => x.trim()));
    const headers = {};
    for (const [name, value] of Object.entries(req.headers))
      if (!hop.has(name) && !nominated.has(name) && !name.startsWith('x-forwarded-') && !['forwarded', 'authorization', 'host', 'content-length'].includes(name)) headers[name] = value;
    headers.host = publicUrl.host; headers['content-length'] = String(size);
    const upstream = upstreamRequest({ hostname: target.hostname, port: target.port || 80, path: req.url, method: req.method, headers }, response => {
      const excluded = new Set(String(response.headers.connection ?? '').toLowerCase().split(',').map(x => x.trim()));
      for (const [name, value] of Object.entries(response.headers)) if (value !== undefined && !hop.has(name) && !excluded.has(name)) res.setHeader(name, value);
      res.setHeader('Strict-Transport-Security', 'max-age=31536000'); res.statusCode = response.statusCode ?? 502;
      response.on('error', () => res.destroy()); response.pipe(res);
    });
    upstream.setTimeout(30000, () => upstream.destroy());
    upstream.on('error', () => { if (res.headersSent) res.destroy(); else fail(502); });
    res.on('close', () => upstream.destroy()); upstream.end(Buffer.concat(chunks));
  });
  server.maxConnections = 128; server.headersTimeout = 10000; server.requestTimeout = 15000; server.keepAliveTimeout = 5000;
  server.on('connect', (_req, socket) => socket.destroy()); server.on('upgrade', (_req, socket) => socket.destroy());
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createHttpsIngress({ origin: process.env.AGENTBRAKE_PUBLIC_ORIGIN,
    cert: await readFile('/run/secrets/tls-cert.pem'), key: await readFile('/run/secrets/tls-key.pem') });
  server.listen(3000, '0.0.0.0');
  process.on('SIGTERM', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
}
