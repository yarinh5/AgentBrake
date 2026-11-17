import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';
import { actionEvidence } from '../../server/control-experience.js';
import { TargetChangedError } from '../../server/contracts.js';

const sensitive = 'ghp_' + 'Z'.repeat(32); // synthetic; never an upstream credential
function fixture() {
  const s = createApp({ databasePath: ':memory:', adminKey: 'outcome-fixture-admin-key-000000000000' });
  const { agent } = s.store.createAgent({ name: 'Outcome test', tools: ['database_read', 'database_update'], resources: ['customers'], sandbox: true });
  const execute = s.gateway.connectors.execute.bind(s.gateway.connectors);
  let calls = 0;
  s.gateway.connectors.execute = async a => { calls++; return execute(a); };
  return { ...s, agent, calls: () => calls, row: () => ({ ...s.store.db.prepare('SELECT status,version FROM customers WHERE id=1').get() }) };
}

for (const tool of ['database_read', 'database_update']) {
  test(`${tool}: withheld output does not erase actual execution or permit a replay`, async () => {
    const s = fixture();
    try {
      const execute = s.gateway.connectors.execute.bind(s.gateway.connectors);
      s.gateway.connectors.execute = async a => ({ ...(await execute(a) as object), note: sensitive });
      const request = { requestId: randomUUID(), tool, arguments: tool === 'database_read' ? { limit: 1 } : { id: 1, status: 'paused' } };
      let action = await s.gateway.submit(s.agent.id, request);
      if (tool === 'database_update') {
        assert.equal(action.status, 'pending'); assert.equal(s.calls(), 0);
        action = await s.gateway.approve(action.id, true);
      }
      assert.equal(s.calls(), 1);
      if (tool === 'database_update') assert.deepEqual(s.row(), { status: 'paused', version: 1 });
      assert.equal(action.status, 'allowed', 'already executed is not a prevented action');
      assert.equal(action.executionOutcome, 'adapter-reported');
      assert.equal(action.resultDisclosure, 'withheld');
      assert.equal(action.result, undefined);
      assert.match(action.reason, /Do not resubmit/);
      assert.equal(action.rule === 'secret-output', false, 'do not overwrite authorization rule with disclosure decision');
      const replay = await s.gateway.submit(s.agent.id, request);
      assert.equal(replay.id, action.id); assert.equal(replay.resultDisclosure, 'withheld'); assert.equal(s.calls(), 1);
      const evidence = await actionEvidence(s.store, action.id);
      assert.equal(evidence.execution.observation, 'adapter-reported');
      assert.equal(evidence.execution.outcome, 'adapter-reported');
      assert.equal(evidence.execution.resultDisclosure, 'withheld');
      assert.ok(!JSON.stringify([action, replay, evidence, s.store.action(action.id), s.store.auditTrail()]).includes(sensitive));
      assert.equal(s.store.verifyAudit(), true);
      if (tool === 'database_update') await assert.rejects(s.gateway.approve(action.id, true), /no longer awaiting/);
    } finally { await s.close(); }
  });
}

test('safe result, denial, post-dispatch rejection and uncertain mutation have distinct outcomes', async () => {
  const s = fixture();
  try {
    const safe = await s.gateway.submit(s.agent.id, { requestId: randomUUID(), tool: 'database_read', arguments: { limit: 1 } });
    assert.equal(safe.executionOutcome, 'adapter-reported'); assert.equal(safe.resultDisclosure, 'released');
    const denied = await s.gateway.submit(s.agent.id, { requestId: randomUUID(), tool: 'database_delete', arguments: {} });
    assert.equal(denied.status, 'blocked'); assert.equal(s.calls(), 1);
    assert.equal((await actionEvidence(s.store, denied.id)).execution.observation, 'not-dispatched');
    for (const changed of [true, false]) {
      const action = await s.gateway.submit(s.agent.id, { requestId: randomUUID(), tool: 'database_update', arguments: { id: 1, status: 'paused' } });
      s.gateway.connectors.execute = async () => { throw changed ? new TargetChangedError() : Error('response lost'); };
      const result = await s.gateway.approve(action.id, true);
      assert.equal(result.status, changed ? 'failed' : 'unknown');
      assert.equal(result.executionOutcome, changed ? 'not-applied' : 'unknown');
      assert.equal(result.resultDisclosure, 'unavailable');
      const e = await actionEvidence(s.store, result.id);
      assert.equal(e.execution.observation, changed ? 'adapter-reported' : 'unverified');
    }
  } finally { await s.close(); }
});

test('legacy blocked secret output remains uncertain, not rewritten as a proven success', async () => {
  const s = fixture();
  try {
    const a = await s.gateway.submit(s.agent.id, { requestId: randomUUID(), tool: 'database_read', arguments: { limit: 1 } });
    a.status = 'blocked'; a.rule = 'secret-output'; delete a.result;
    delete a.executionOutcome; delete a.resultDisclosure; s.store.saveAction(a);
    const e = await actionEvidence(s.store, a.id);
    assert.equal(e.execution.observation, 'unverified');
    assert.equal(e.execution.resultDisclosure, 'withheld');
    assert.equal(e.action.status, 'blocked');
  } finally { await s.close(); }
});
