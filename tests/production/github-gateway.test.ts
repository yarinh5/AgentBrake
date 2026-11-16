import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../../server/store.js';
import { Connectors } from '../../server/connectors.js';
import { Gateway } from '../../server/gateway.js';
import { config, fakeGitHub } from './github-fixture.js';
function setup() {
  const f = fakeGitHub(), store = new Store(':memory:');
  const connectors = new Connectors(store, { githubApp: config }, 'test-binding-key-000000000000000', f.transport);
  const gateway = new Gateway(store, connectors, () => {});
  const { agent } = store.createAgent({ name: 'Dedicated App sandbox', sandbox: false, ownerId: 'owner',
    tools: ['github_list_repo', 'github_read_file', 'github_create_branch', 'github_open_pull_request'], resources: [config.repository] });
  return { ...f, store, gateway, agent };
}
const submit = (s: ReturnType<typeof setup>, tool: string, args: Record<string, unknown>) => s.gateway.submit(s.agent.id, { requestId: randomUUID(), tool, arguments: args });
const branchArgs = { repo: config.repository, branch: 'agentbrake/reviewed', baseSha: 'a'.repeat(40) };
async function approve(s: ReturnType<typeof setup>, id: string) {
  const view = await s.gateway.review(id);
  return s.gateway.approve(id, true, { actor: { id: 'independent-reviewer', name: 'Reviewer', tenant: 'local', role: 'approver' }, proof: view.action.review, team: true });
}
test('real Gateway/OPA denies outside scope before any App HTTP; explicit App read succeeds', async () => {
  const s = setup(); try {
    const denied = await submit(s, 'github_read_file', { repo: 'other/repo', path: 'README.md' });
    assert.equal(denied.status, 'blocked'); assert.equal(s.calls.length, 0);
    const allowed = await submit(s, 'github_read_file', { repo: config.repository, path: 'README.md' });
    assert.equal(allowed.status, 'allowed'); assert.equal((allowed.result as any).content, 'before');
    assert.equal(allowed.sandbox, false); assert.equal(s.mutations().length, 0);
  } finally { s.store.close(); }
});
test('pending has zero mutation; independent approval dispatches once; duplicate approval fails', async () => {
  const s = setup(); try {
    const pending = await submit(s, 'github_create_branch', branchArgs);
    assert.equal(pending.status, 'pending'); assert.equal(s.mutations().length, 0);
    assert.equal((await approve(s, pending.id)).status, 'allowed');
    await assert.rejects(approve(s, pending.id)); assert.equal(s.mutations().length, 1);
    assert.equal(s.state.main, branchArgs.baseSha);
  } finally { s.store.close(); }
});
test('changed repository identity after preview blocks with zero dispatch', async () => {
  const s = setup(); try {
    const pending = await submit(s, 'github_create_branch', branchArgs); assert.equal(pending.status, 'pending');
    s.state.ownerId++;
    assert.equal((await approve(s, pending.id)).status, 'blocked'); assert.equal(s.mutations().length, 0);
  } finally { s.store.close(); }
});
test('lost PR response records UNKNOWN and request replay never retries side effects', async () => {
  const s = setup(); try {
    s.state.branch = branchArgs.baseSha; s.state.failPR = true;
    const request = { requestId: randomUUID(), tool: 'github_open_pull_request', arguments: { ...branchArgs, title: 'Review', changes: [{ path: 'README.md', content: 'after' }] } };
    const pending = await s.gateway.submit(s.agent.id, request); assert.equal(pending.status, 'pending');
    const unknown = await approve(s, pending.id); assert.equal(unknown.status, 'unknown');
    const count = s.mutations().length;
    assert.equal((await s.gateway.submit(s.agent.id, request)).status, 'unknown'); assert.equal(s.mutations().length, count);
    assert.equal(s.state.branch, 'd'.repeat(40)); assert.equal(s.store.verifyAudit(), true);
  } finally { s.store.close(); }
});
test('local demo identity remains a fixture even when the App is configured', async () => {
  const s = setup(); try {
    const { agent } = s.store.createAgent({ name: 'Fixture', sandbox: true, tools: ['github_read_file'], resources: ['agentbrake/sandbox'] });
    const result = await s.gateway.submit(agent.id, { requestId: randomUUID(), tool: 'github_read_file', arguments: { repo: 'agentbrake/sandbox', path: 'README.md' } });
    assert.equal(result.status, 'allowed'); assert.equal(result.sandbox, true); assert.equal(s.calls.length, 0);
  } finally { s.store.close(); }
});
