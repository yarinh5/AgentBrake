import test from 'node:test';
import assert from 'node:assert/strict';
import { controlProxy } from '../../apps/dashboard/lib/control-proxy.js';
import { createApp } from '../../server/app.js';
const origin = 'https://brake.example.test';
function request(host = 'brake.example.test', browserOrigin = origin) {
  return new Request('http://0.0.0.0:3000/api/login', { method: 'POST', headers: { host, origin: browserOrigin,
    'content-type': 'application/json', 'x-forwarded-host': 'brake.example.test', 'x-forwarded-proto': 'https' }, body: '{}' });
}
test('HTTPS dashboard uses a pinned origin; forwarding headers cannot substitute for Host or Origin', async () => {
  let calls = 0; const transport: typeof fetch = async (_url, options) => {
    calls++; const h = new Headers(options?.headers);
    assert.equal(h.get('origin'), 'http://control-api:4314'); assert.equal(h.get('x-forwarded-host'), null);
    return Response.json({ ok: true });
  };
  assert.equal((await controlProxy(request(), ['login'], 'http://control-api:4314', transport, origin)).status, 200);
  for (const input of [request('attacker.test'), request('brake.example.test', 'http://brake.example.test'), request('brake.example.test', 'https://attacker.test')])
    assert.equal((await controlProxy(input, ['login'], 'http://control-api:4314', transport, origin)).status, 403);
  assert.equal(calls, 1);
  for (const invalid of ['http://brake.example.test', origin + '/extra', 'https://user:pass@brake.example.test', origin + '?x=y'])
    assert.equal((await controlProxy(request(), ['login'], 'http://control-api:4314', transport, invalid)).status, 503);
});
test('HTTPS mode refuses to forward a non-Secure session cookie', async () => {
  const insecure: typeof fetch = async () => new Response('{}', { headers: { 'set-cookie': 'ab_session=value; HttpOnly; SameSite=Strict; Path=/api' } });
  assert.equal((await controlProxy(request(), ['login'], 'http://control-api:4314', insecure, origin)).status, 502);
  const secure: typeof fetch = async () => new Response('{}', { headers: { 'set-cookie': 'ab_session=value; HttpOnly; Secure; SameSite=Strict; Path=/api' } });
  const result = await controlProxy(request(), ['login'], 'http://control-api:4314', secure, origin);
  assert.equal(result.status, 200); assert.match(result.headers.get('set-cookie')!, /; Secure/);
});
test('private control API issues and clears Secure cookies when HTTPS entrypoint is configured', async () => {
  const system = createApp({ databasePath: ':memory:', adminKey: 'secure-cookie-test-key-00000000000', secureCookies: true });
  const server = system.app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`;
  try {
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'secure-cookie-test-key-00000000000' }) });
    assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie')!; assert.match(cookie, /; Secure/);
    const logout = await fetch(base + '/api/logout', { method: 'POST', headers: { cookie: cookie.split(';')[0], 'content-type': 'application/json' }, body: '{}' });
    assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie')!, /; Secure/);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await system.close(); }
});
