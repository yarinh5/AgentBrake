import test from 'node:test';
import assert from 'node:assert/strict';
import { assessProduction } from '../../scripts/production-readiness.mjs';
test('useful coding is a separate required gate; two-read or failed evidence cannot satisfy it', () => {
  const sourceHash='a'.repeat(64),release={sourceHash,result:'LOCAL_MVP_VERIFIED_EXTERNAL_GATES_OPEN'};
  const status=coding=>assessProduction({sourceHash,localRelease:{...release,baseline:{coding}}}).gates.find(g=>g.id==='useful-coding')?.status;
  assert.equal(status(undefined),'STALE_OR_FAILED');
  assert.equal(status({result:'FAIL'}),'STALE_OR_FAILED');
  assert.equal(status({result:'PASS_SCOPED_LOCAL_CODING'}),'PASS');
});
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
