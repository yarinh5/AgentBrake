import test from 'node:test';
import assert from 'node:assert/strict';
import { config, fakeGitHub } from './github-fixture.js';
import { TargetChangedError } from '../../server/contracts.js';
const base = 'a'.repeat(40), tree = 'b'.repeat(40), commit = 'd'.repeat(40);
const feature = 'agentbrake/reviewed';
const action = (tool: string, args: Record<string, unknown> = {}) => ({ tool, arguments: args, sandbox: false });
const proposal = { repo: config.repository, baseSha: base, branch: feature, changes: [{ path: 'README.md', content: 'after' }] };

test('App JWT and installation authority are scoped; safe file read returns only bounded data', async () => {
  const f = fakeGitHub(); const result = await f.adapter.execute(action('github_read_file', { repo: config.repository, path: 'README.md' }));
  assert.equal((result as any).content, 'before'); assert.equal((result as any).repositoryId, 789);
  assert.equal(f.mutations().length, 0); assert.ok(!JSON.stringify(result).includes('credential'));
  await f.adapter.execute(action('github_list_repo')); assert.equal(f.calls.filter(c => c.path.includes('/access_tokens')).length, 1);
});
test('unknown tool, secret path, outside repo, main branch and duplicate change paths never mint a credential', async () => {
  for (const a of [action('github_delete_repo'), action('github_read_file', { repo: config.repository, path: '.env' }),
    action('github_read_file', { repo: 'other/repo', path: 'README.md' }), action('github_create_branch', { ...proposal, branch: 'main' }),
    action('github_open_pull_request', { ...proposal, title: 'x', changes: [proposal.changes[0], proposal.changes[0]] })]) {
    const f = fakeGitHub(); await assert.rejects(f.adapter.execute(a)); assert.equal(f.calls.length, 0);
  }
});
test('wrong immutable identity, broader token permissions/repositories, redirects and oversized responses fail closed', async () => {
  for (const change of [(s: any) => s.repoId++, (s: any) => s.ownerId++, (s: any) => s.permissions.administration = 'write',
    (s: any) => s.repositories.push(999), (s: any) => s.redirect = true, (s: any) => s.oversized = true]) {
    const f = fakeGitHub(); change(f.state); await assert.rejects(f.adapter.execute(action('github_list_repo'))); assert.equal(f.mutations().length, 0);
  }
});
test('human preview pins real identity and before/after content; protected main required for mutation', async () => {
  const f = fakeGitHub(); f.state.branch = base;
  const preview = await f.adapter.preview(action('github_open_pull_request', { ...proposal, title: 'Reviewed' }));
  assert.equal(preview.details.repositoryId, 789); assert.deepEqual(preview.details.changes, [{ path: 'README.md', before: 'before', after: 'after' }]);
  assert.equal(f.mutations().length, 0);
  f.state.protected = false; await assert.rejects(f.adapter.execute({ ...action('github_open_pull_request', { ...proposal, title: 'Reviewed' }), preview }));
  assert.equal(f.mutations().length, 0);
});
test('branch and draft PR use exact approved commit, paths and non-force ref update', async () => {
  const f = fakeGitHub(); const branchAction = action('github_create_branch', { repo: config.repository, baseSha: base, branch: feature });
  await f.adapter.execute({ ...branchAction, preview: await f.adapter.preview(branchAction) });
  const prAction = action('github_open_pull_request', { ...proposal, title: 'Reviewed', body: '' });
  const result = await f.adapter.execute({ ...prAction, preview: await f.adapter.preview(prAction) });
  assert.equal((result as any).pullRequest.number, 1); assert.equal(f.state.main, base); assert.equal(f.state.branch, commit);
  const write = f.calls.find(c => c.method === 'POST' && c.path.endsWith('/git/trees'))!;
  assert.deepEqual(write.body, { base_tree: tree, tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: 'after' }] });
});
test('missing/swapped/stale preview cannot mutate; partial PR failure is never a zero-effect TargetChanged error', async () => {
  const f = fakeGitHub(); f.state.branch = base;
  const a = action('github_open_pull_request', { ...proposal, title: 'Reviewed' });
  await assert.rejects(f.adapter.execute(a)); assert.equal(f.mutations().length, 0);
  const preview = await f.adapter.preview(a); f.state.main = 'f'.repeat(40);
  await assert.rejects(f.adapter.execute({ ...a, preview })); assert.equal(f.mutations().length, 0);
  f.state.main = base; f.state.failPR = true;
  await assert.rejects(f.adapter.execute({ ...a, preview }), e => e instanceof Error && !(e instanceof TargetChangedError) && !e.message.includes('credential'));
  assert.equal(f.state.branch, commit); assert.equal(f.mutations().filter(c => c.path.endsWith('/pulls')).length, 1);
});
test('sandbox containing workflow automation refuses branch/PR mutations before side effects', async () => {
  for (const tool of ['github_create_branch', 'github_open_pull_request']) {
    const f = fakeGitHub(); f.state.workflow = true;
    if (tool === 'github_open_pull_request') f.state.branch = base;
    const a = tool === 'github_create_branch' ? action(tool, { repo: config.repository, baseSha: base, branch: feature }) : action(tool, { ...proposal, title: 'Review' });
    await assert.rejects(f.adapter.preview(a)); assert.equal(f.mutations().length, 0);
  }
});
test('invalid, expired, near-expiry and excessive-lifetime tokens never authorize repository access', async () => {
  for (const expiry of ['invalid-date', new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 30000).toISOString(), new Date(Date.now() + 7200000).toISOString()]) {
    const f = fakeGitHub(); f.state.expiry = expiry;
    await assert.rejects(f.adapter.execute(action('github_list_repo')));
    assert.equal(f.calls.filter(c => c.path.startsWith('/repos/')).length, 0);
  }
});
test('cached token is refreshed at its safety cutoff; failed refresh never uses the stale credential', async () => {
  const realNow = Date.now, start = realNow(); let current = start;
  Date.now = () => current;
  try {
    const f = fakeGitHub();
    await f.adapter.execute(action('github_list_repo'));
    current = start + 3539000; await f.adapter.execute(action('github_list_repo'));
    assert.equal(f.calls.filter(c => c.path.includes('/access_tokens')).length, 1);
    current = start + 3540000; await f.adapter.execute(action('github_list_repo'));
    assert.equal(f.calls.filter(c => c.path.includes('/access_tokens')).length, 2);
    const reads = f.calls.filter(c => c.path.startsWith('/repos/')).length;
    current += 3540000; f.state.failMint = true;
    await assert.rejects(f.adapter.execute(action('github_list_repo')));
    assert.equal(f.calls.filter(c => c.path.startsWith('/repos/')).length, reads);
  } finally { Date.now = realNow; }
});
