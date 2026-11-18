import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { composeEnvironment } from '../../scripts/compose-environment.mjs';

// Real Compose expansion, without contacting an engine or building images.
// Concurrent exporters of the same tag fail on a clean containerd image store.
for (const [name, files, runtimeOwner] of [
  ['isolation', ['infra/local/compose.yaml'], 'gateway'],
  ['product', ['infra/product/compose.yaml'], 'control-api'],
  ['minimal product', ['infra/product/compose.yaml', 'infra/product/minimal.compose.yaml'], 'control-api'],
]) test(`${name} preserves image ownership and final database readiness`, () => {
  const result = spawnSync('docker', ['compose', ...files.flatMap(f => ['-f', f]), '--profile', '*', 'config', '--format', 'json'], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: composeEnvironment({ ...process.env, COMPOSE_PROJECT_NAME: 'agentbrake-build-contract',
      INSTALLATION_ID: 'synthetic-build-contract', INSTALL_DIR: resolve('.agentbrake-local'),
      RUN_ID: 'synthetic-build-contract', RUN_DIR: resolve('.agentbrake-local'),
      DASHBOARD_PORT: '4399', NODE_IMAGE: 'node:22', POSTGRES_IMAGE: 'postgres:18',
      POSTGRES_BASE_IMAGE: 'postgres:18', OPA_IMAGE: 'openpolicyagent/opa:1' }),
  });
  assert.equal(result.status, 0, result.stderr);
  const services = JSON.parse(result.stdout).services;
  const builders = new Map();
  for (const [service, config] of Object.entries(services)) if (config.build) {
    assert.ok(!builders.has(config.image), `${config.image} is built by both ${builders.get(config.image)} and ${service}`);
    builders.set(config.image, service);
  }
  assert.equal(builders.get('agentbrake-build-contract-runtime'), runtimeOwner);
  for (const config of Object.values(services)) if (config.image === 'agentbrake-build-contract-runtime') {
    assert.equal(config.pull_policy, 'never', 'Private local build tags must not be fetched from a registry');
  }
  // The temporary initdb server accepts Unix sockets before initialization ends.
  // TCP becomes available only after the final server starts.
  for (const service of ['control-db', 'target-db']) {
    const command = services[service].healthcheck.test;
    assert.ok(command.includes('-h'), `${service} must not accept temporary Unix-socket readiness`);
    assert.equal(command[command.indexOf('-h') + 1], '127.0.0.1');
  }
});

test('Codex verification renders a one-CPU limit on a one-CPU test host', () => {
  const result = spawnSync('docker', ['compose', '-f', 'infra/local/compose.yaml',
    '-f', 'infra/local/codex.compose.yaml', '--profile', 'codex-verification', 'config', '--format', 'json'], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: composeEnvironment({ ...process.env, COMPOSE_PROJECT_NAME: 'agentbrake-cpu-contract',
      RUN_ID: 'synthetic-cpu-contract', RUN_DIR: resolve('.agentbrake-local'),
      NODE_IMAGE: 'node:22', POSTGRES_IMAGE: 'postgres:18', OPA_IMAGE: 'openpolicyagent/opa:1',
      OLLAMA_IMAGE: 'ollama/ollama:synthetic', CODEX_VERSION: '0.169.0',
      MODEL_DIR: resolve('.tools/ollama-models'), CODEX_CPU_LIMIT: '1' }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).services['codex-agent'].cpus, 1);
});
