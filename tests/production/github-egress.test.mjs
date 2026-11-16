import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubEgress } from '../../infra/product/github-egress.mjs';
test('fixed GitHub egress rejects alternate hosts/repos/mint scope before outbound dispatch and never follows redirects', async () => {
  let calls = 0;
  const server = createGitHubEgress({ repository: 'example/disposable', repositoryId: 789, installationId: 456 }, async (url, options) => {
    calls++; assert.equal(new URL(url).origin, 'https://api.github.com'); assert.equal(options.redirect, 'error');
    return Response.json({ observed: true });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body) => fetch(base + path, { method, headers: { authorization: 'Bearer synthetic', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await request('/repos/example/disposable')).status, 200);
    for (const path of ['/repos/other/repo', '//attacker.invalid', '/repos/example/disposable/issues', '/repos/example/disposable/actions/secrets', '/repos/example/disposable/git/refs/heads/main'])
      assert.equal((await request(path)).status, 403);
    assert.equal((await request('/app/installations/456/access_tokens', 'POST', { repository_ids: [999], permissions: { contents: 'write', pull_requests: 'write' } })).status, 403);
    assert.equal(calls, 1);
    assert.equal((await request('/app/installations/456/access_tokens', 'POST', { repository_ids: [789], permissions: { contents: 'write', pull_requests: 'write' } })).status, 200);
    assert.equal(calls, 2);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
