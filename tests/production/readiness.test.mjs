import test from 'node:test';
import assert from 'node:assert/strict';
import { assessProduction } from '../../scripts/production-readiness.mjs';
test('production readiness cannot promote local or stale evidence to live/security/deployment acceptance', () => {
  const sourceHash = 'a'.repeat(64);
  const missing = assessProduction({ sourceHash });
  assert.equal(missing.result, 'BLOCKED'); assert.ok(missing.gates.every(g => g.status !== 'PASS'));
  const local = assessProduction({ sourceHash,
    localRelease: { sourceHash, result: 'LOCAL_MVP_VERIFIED_EXTERNAL_GATES_OPEN' },
    candidate: { sourceHash, result: 'PASS_LOCAL_CANDIDATE', cleanup: { result: 'PASS' } },
    images: { sourceHash: 'b'.repeat(64), result: 'PASS_IMAGE_SCAN' } });
  assert.equal(local.result, 'BLOCKED');
  assert.equal(local.gates.find(g => g.id === 'local-release').status, 'PASS');
  assert.equal(local.gates.find(g => g.id === 'https-candidate').status, 'PASS');
  assert.equal(local.gates.find(g => g.id === 'container-vulnerabilities').status, 'STALE_OR_FAILED');
  for (const id of ['live-github', 'clean-host', 'human-security-review', 'deployment-authorization', 'operations-owner'])
    assert.equal(local.gates.find(g => g.id === id).status, 'NOT_OBTAINED');
});
