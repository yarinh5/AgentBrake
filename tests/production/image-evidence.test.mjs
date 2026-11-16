import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyImageBinding } from '../../scripts/image-evidence.mjs';
test('image scan refuses a rebuilt tag that differs from the image exercised by the candidate', () => {
  const candidate = { runId: '12345678-1111-4111-8111-111111111111', images: [{ ContainerName: 'agentbrake-product-verify-candidate-12345678-gateway-1', ID: 'sha256:' + 'a'.repeat(64) }] };
  assert.equal(verifyImageBinding(candidate, 'runtime', 'sha256:' + 'a'.repeat(64)), true);
  assert.throws(() => verifyImageBinding(candidate, 'runtime', 'sha256:' + 'b'.repeat(64)));
  assert.throws(() => verifyImageBinding(candidate, 'dashboard', 'sha256:' + 'a'.repeat(64)));
});
