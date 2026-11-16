import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request } from 'node:https';
import { connect } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHttpsIngress } from '../../infra/product/https-ingress.mjs';

test('actual TLS entrypoint pins host, drops credentials/forwarded headers and has no plaintext or arbitrary destination path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentbrake-tls-'));
  let upstreamCalls = 0;
  const backend = createServer((req, res) => {
    upstreamCalls++;
    assert.equal(req.headers.host, 'brake.example.test');
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers['x-forwarded-host'], undefined);
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ observed: req.url }));
  });
  await new Promise(r => backend.listen(0, '127.0.0.1', r));
  let server;
  try {
    const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=brake.example.test',
      '-addext', 'subjectAltName=DNS:brake.example.test', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore', windowsHide: true });
    const cert = await readFile(join(dir, 'cert.pem'));
    server = createHttpsIngress({ origin: 'https://brake.example.test', cert, key: await readFile(join(dir, 'key.pem')),
      backend: `http://127.0.0.1:${backend.address().port}` });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const call = (path, host = 'brake.example.test', method = 'GET', body) => new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, servername: 'brake.example.test', ca: cert, path, method,
        headers: { host, authorization: 'Bearer must-not-forward', 'x-forwarded-host': 'attacker.invalid', ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) } }, res => {
          let text = ''; res.on('data', c => text += c); res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
        }); req.on('error', reject); req.end(body);
    });
    const ok = await call('/api/health'); assert.equal(ok.status, 200); assert.equal(JSON.parse(ok.text).observed, '/api/health');
    assert.equal(ok.headers['strict-transport-security'], 'max-age=31536000');
    assert.equal((await call('/api/health', 'attacker.invalid')).status, 421);
    assert.equal((await call('http://attacker.invalid/api/health')).status, 400);
    assert.equal((await call('/api/login', 'brake.example.test', 'POST', 'x'.repeat(32769))).status, 413);
    assert.equal(upstreamCalls, 1);
    const plaintext = await new Promise(resolve => {
      const socket = connect(port, '127.0.0.1', () => socket.write('GET / HTTP/1.1\r\nHost: brake.example.test\r\n\r\n'));
      let output = ''; socket.on('data', c => output += c); socket.on('error', () => {}); socket.on('close', () => resolve(output)); socket.setTimeout(2000, () => socket.destroy());
    });
    assert.ok(!plaintext.includes('200')); assert.equal(upstreamCalls, 1);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    backend.closeAllConnections(); await new Promise(r => backend.close(r)); await rm(dir, { recursive: true });
  }
});
