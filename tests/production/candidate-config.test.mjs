import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { configureCandidate, loadCandidate } from '../../scripts/candidate-config.mjs';
test('candidate configuration pins a dedicated repository, writes no private key in metadata and cannot overwrite local/existing configuration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentbrake-candidate-'));
  try {
    const config = { name: 'candidate-test', id: randomUUID(), dir };
    await writeFile(join(dir, 'installation.json'), JSON.stringify({ name: config.name, id: config.id }));
    const keyFile = join(dir, 'input.pem');
    await writeFile(keyFile, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const input = { githubApp: { appId: 123, installationId: 456, repositoryId: 789, ownerId: 12,
      repository: 'example/disposable', defaultBranch: 'main', privateKeyFile: keyFile, disposableRepository: 'example/disposable' } };
    await assert.rejects(configureCandidate({ ...config, name: 'local' }, input));
    await assert.rejects(configureCandidate(config, { githubApp: { ...input.githubApp, disposableRepository: 'other/repo' } }));
    await configureCandidate(config, input);
    const loaded = await loadCandidate(config); assert.equal(loaded.github, true); assert.equal(loaded.httpsOrigin, undefined);
    const publicData = await readFile(join(dir, 'github-app.json'), 'utf8');
    assert.ok(!publicData.includes('PRIVATE KEY')); assert.ok(!publicData.includes('privateKeyFile'));
    assert.equal(JSON.parse(publicData).repositoryId, 789);
    await assert.rejects(configureCandidate(config, input));
    assert.deepEqual(await loadCandidate(config), loaded);
  } finally { await rm(dir, { recursive: true }); }
});
