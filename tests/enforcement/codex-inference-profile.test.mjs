import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { codexInferenceProfile } from '../../scripts/codex-inference-profile.mjs';
import { composeEnvironment } from '../../scripts/compose-environment.mjs';

test('inference selection preserves the CPU default and rejects unknown profiles', () => {
  assert.deepEqual(codexInferenceProfile(), { name: 'cpu-32k', context: 32768, compact: 24000, gpu: false, memoryBytes: 12 * 1024 ** 3 });
  assert.throws(() => codexInferenceProfile('gpu'), /Unknown Codex inference profile/);
  assert.throws(() => codexInferenceProfile(''), /Unknown Codex inference profile/);
});

for (const name of ['cpu-32k', 'gpu-8k']) test(`${name} renders a confined model without granting GPU access to the agent`, () => {
  const profile = codexInferenceProfile(name);
  const result = spawnSync('docker', ['compose', '-f', 'infra/local/compose.yaml', '-f', 'infra/local/codex.compose.yaml',
    ...(profile.gpu ? ['-f', 'infra/local/codex-gpu.compose.yaml'] : []), '--profile', 'codex-verification', 'config', '--format', 'json'], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: composeEnvironment({ ...process.env, COMPOSE_PROJECT_NAME: 'agentbrake-inference-contract', RUN_ID: 'synthetic-profile',
      RUN_DIR: resolve('.agentbrake-local'), NODE_IMAGE: 'node:22', POSTGRES_IMAGE: 'postgres:18', OPA_IMAGE: 'openpolicyagent/opa:1',
      OLLAMA_IMAGE: 'ollama/ollama:synthetic', CODEX_VERSION: '0.169.0', MODEL_DIR: resolve('.tools/ollama-models'),
      CODEX_CPU_LIMIT: '1', CODEX_INFERENCE_PROFILE: name, CODEX_CONTEXT_LENGTH: String(profile.context) }),
  });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout), model = config.services['local-model'], agent = config.services['codex-agent'];
  assert.equal(model.environment.OLLAMA_CONTEXT_LENGTH, String(profile.context));
  assert.equal(agent.environment.AGENTBRAKE_CODEX_PROFILE, name);
  assert.equal(Number(model.mem_limit), profile.memoryBytes);
  assert.equal(Boolean(model.gpus?.length), profile.gpu);
  assert.equal(agent.gpus, undefined);
  assert.equal(agent.devices, undefined);
  assert.equal(agent.cpus, 1);
  assert.deepEqual(Object.keys(model.networks), ['inference']);
  assert.equal(config.networks.inference.internal, true);
  for (const service of [model, agent]) {
    assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
    assert.equal(service.ports, undefined);
    assert.equal(service.volumes.length, 1);
    assert.equal(service.volumes[0].read_only, true);
  }
  if (profile.gpu) {
    assert.equal(profile.context, 8192);
    assert.equal(profile.compact, 6500);
    assert.equal(Number(model.memswap_limit), profile.memoryBytes);
    assert.equal(model.cpus, 4);
    assert.equal(model.environment.CUDA_VISIBLE_DEVICES, '0');
    assert.equal(model.environment.OLLAMA_GPU_OVERHEAD, '2147483648');
  } else assert.equal(model.environment.CUDA_VISIBLE_DEVICES, '-1');
});
