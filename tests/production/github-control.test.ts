import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';
import { config } from './github-fixture.js';
test('operator can issue and narrow an explicitly configured App sandbox grant but cannot expand its target', async () => {
  const s = createApp({ databasePath: ':memory:', adminKey: 'app-control-test-key-0000000000000', connections: { githubApp: config } });
  const listener = s.app.listen(0, '127.0.0.1'); await new Promise<void>(r => listener.once('listening', r));
  const base = `http://127.0.0.1:${(listener.address() as { port: number }).port}`;
  try {
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'app-control-test-key-0000000000000' }) });
    const headers = { 'Content-Type': 'application/json', cookie: login.headers.get('set-cookie')!.split(';')[0] };
    const identity = { name: 'GitHub sandbox', tools: ['github_read_file'], resources: [config.repository], sandbox: false };
    const create = await fetch(base + '/api/agents', { method: 'POST', headers, body: JSON.stringify(identity) });
    assert.equal(create.status, 201); const { agent } = await create.json();
    const task = { actions: ['github_read_file'], resources: [config.repository], environments: ['sandbox'], expiresInSeconds: 120, maxCalls: 10, maxRows: 1 };
    const grant = (value: unknown) => fetch(base + `/api/agents/${agent.id}/grant`, { method: 'POST', headers, body: JSON.stringify(value) });
    assert.equal((await grant(task)).status, 201);
    assert.equal((await grant({ ...task, resources: ['another/repo'] })).status, 400);
    assert.equal((await grant({ ...task, environments: ['production'] })).status, 400);
    const forbidden = await fetch(base + '/api/agents', { method: 'POST', headers, body: JSON.stringify({ ...identity, tools: ['database_read'], resources: ['customers'] }) });
    assert.equal(forbidden.status, 400);
    const workspace = await (await fetch(base + '/api/workspace', { headers })).json();
    assert.equal(workspace.connections.github, 'github-app-sandbox'); assert.equal(workspace.connections.repository, config.repository);
    assert.ok(!JSON.stringify(workspace).includes('PRIVATE KEY'));
  } finally { listener.closeAllConnections(); await new Promise<void>(r => listener.close(() => r())); await s.close(); }
});
