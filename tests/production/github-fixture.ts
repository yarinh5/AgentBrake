import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { GitHubAppAdapter, type GitHubAppConfig } from '../../server/adapters/github-app.js';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const config: GitHubAppConfig = {
  appId: 123, installationId: 456, repositoryId: 789, ownerId: 12,
  repository: 'example/disposable', defaultBranch: 'main',
  privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};
const base = 'a'.repeat(40), tree = 'b'.repeat(40), blob = 'c'.repeat(40), commit = 'd'.repeat(40);
const feature = 'agentbrake/reviewed';
export function fakeGitHub() {
  const calls: { method: string; path: string; body: any; authorization: string }[] = [];
  const state = { repoId: 789, ownerId: 12, protected: true, main: base, branch: undefined as string | undefined,
    prs: [] as any[], permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' } as Record<string, string>,
    repositories: [789], failPR: false, failRef: false, oversized: false, redirect: false, workflow: false,
    expiry: undefined as string | undefined, failMint: false };
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    const headers = new Headers(init?.headers);
    const method = init?.method ?? 'GET', path = url.pathname + url.search;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, authorization: headers.get('authorization') ?? '' });
    const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status,
      headers: { 'content-type': 'application/json', 'x-github-request-id': 'ABC:123' } });
    if (state.redirect) return new Response(null, { status: 302, headers: { location: 'https://attacker.invalid' } });
    if (state.oversized) return response({ value: 'x'.repeat(150000) });
    if (path === '/app/installations/456/access_tokens') {
      if (state.failMint) return response({}, 503);
      assert.equal(method, 'POST');
      const jwt = headers.get('authorization')!.slice(7).split('.');
      assert.equal(JSON.parse(Buffer.from(jwt[0], 'base64url').toString()).alg, 'RS256');
      assert.equal(verify('RSA-SHA256', Buffer.from(jwt.slice(0, 2).join('.')), keys.publicKey, Buffer.from(jwt[2], 'base64url')), true);
      const claims = JSON.parse(Buffer.from(jwt[1], 'base64url').toString());
      assert.equal(claims.iss, '123'); assert.ok(claims.exp - claims.iat <= 660);
      assert.deepEqual(body, { repository_ids: [789], permissions: { contents: 'write', pull_requests: 'write' } });
      return response({ token: 'synthetic-installation-credential', expires_at: state.expiry ?? new Date(Date.now() + 3600000).toISOString(),
        permissions: state.permissions, repositories: state.repositories.map(id => ({ id })) }, 201);
    }
    assert.equal(headers.get('authorization'), 'Bearer synthetic-installation-credential');
    const prefix = '/repos/example/disposable'; assert.ok(path.startsWith(prefix));
    const route = path.slice(prefix.length);
    if (route === '') return response({ id: state.repoId, full_name: 'example/disposable', owner: { id: state.ownerId },
      default_branch: 'main', archived: false, disabled: false });
    if (route === '/branches/main') return response({ name: 'main', protected: state.protected, commit: { sha: state.main } });
    if (route === '/branches?per_page=100') return response([{ name: 'main', commit: { sha: state.main } }]);
    if (route === `/git/commits/${base}`) return response({ sha: base, tree: { sha: tree } });
    if (route === `/git/trees/${tree}?recursive=1`) return response({ sha: tree, truncated: false, tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob }, ...(state.workflow ? [{ path: '.github/workflows/deploy.yml', mode: '100644', type: 'blob', sha: blob }] : [])] });
    if (route === `/git/blobs/${blob}`) return response({ sha: blob, encoding: 'base64', size: 6, content: Buffer.from('before').toString('base64') });
    if (route === `/git/ref/heads/${feature}`) return state.branch ? response({ ref: `refs/heads/${feature}`, object: { type: 'commit', sha: state.branch } }) : response({}, 404);
    if (route.startsWith('/pulls?')) return response(state.prs);
    if (route === '/git/refs' && method === 'POST') { assert.equal(state.branch, undefined); state.branch = body.sha; return response({ ref: body.ref, object: { sha: body.sha } }, 201); }
    if (route === '/git/trees' && method === 'POST') return response({ sha: 'e'.repeat(40) }, 201);
    if (route === '/git/commits' && method === 'POST') return response({ sha: commit }, 201);
    if (route === `/git/refs/heads/${feature}` && method === 'PATCH') {
      assert.equal(body.force, false); assert.equal(body.sha, commit);
      if (state.failRef) return response({}, 422);
      state.branch = commit; return response({ ref: `refs/heads/${feature}`, object: { sha: commit } });
    }
    if (route === '/pulls' && method === 'POST') {
      assert.equal(body.draft, true); assert.equal(body.maintainer_can_modify, false);
      if (state.failPR) throw Error('synthetic lost response with credential');
      state.prs.push({ number: 1 }); return response({ number: 1, state: 'open', draft: true, head: { sha: commit }, base: { ref: 'main' } }, 201);
    }
    throw Error(`Unexpected test route ${method} ${path}`);
  };
  return { calls, state, transport, adapter: new GitHubAppAdapter(config, transport), mutations: () => calls.filter(c => c.method !== 'GET' && !c.path.includes('/access_tokens')) };
}
