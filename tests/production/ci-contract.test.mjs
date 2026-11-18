import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sourceManifest } from '../../scripts/source-manifest.mjs';
import { packageFilePaths } from '../../scripts/package-inventory.mjs';

test('CI is a credential-free failing gate for policy/regression/build/security/isolation, included in release source', async () => {
  // JSON is a YAML subset; parsing it avoids adding a workflow-parser dependency.
  const text = await readFile('.github/workflows/security-validation.yml', 'utf8');
  const w = JSON.parse(text);
  assert.deepEqual(Object.keys(w.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  assert.deepEqual(w.permissions, { contents: 'read' });
  assert.equal(/secrets\.|pull_request_target|self-hosted|continue-on-error|id-token|write-all/.test(text), false);
  const commands = [];
  for (const job of Object.values(w.jobs)) {
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 40);
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
      if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
      if (step.run) { assert.equal(step.if, undefined); assert.equal(/\|\|\s*true/.test(step.run), false); commands.push(step.run); }
    }
  }
  for (const required of ['npm run verify:stage1', 'npm run verify:security', 'npm run verify:benchmark', 'npm run verify:enterprise']) assert.ok(commands.includes(required));
  const isolationCommands = w.jobs.isolation.steps.map(step => step.run).filter(Boolean);
  const browserSetup = isolationCommands.indexOf('npx playwright install --with-deps chromium');
  assert.ok(browserSetup >= 0 && browserSetup < isolationCommands.indexOf('npm run verify:enterprise'), 'Prepare Chromium in the isolation job before installed Enterprise browser checks');
  const isolationArtifacts = w.jobs.isolation.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(isolationArtifacts.if, 'always()');
  const artifactPaths = isolationArtifacts.with.path.split('\n');
  for (const path of ['docs/evidence/*/isolation-summary.json', 'docs/evidence/*/enterprise-summary.json', 'docs/evidence/*/source-manifest.json']) assert.ok(artifactPaths.includes(path), `Missing CI acceptance evidence: ${path}`);
  const source = await sourceManifest();
  assert.ok(source.files.some(f => f.path === '.github/workflows/security-validation.yml'));
  assert.ok(packageFilePaths(source).includes('.github/workflows/security-validation.yml'));
  for (const doc of ['ENFORCEMENT_BOUNDARIES', 'GITHUB_SANDBOX_VALIDATION', 'CLEAN_LINUX_VALIDATION', 'ENTERPRISE_GAP_ANALYSIS', 'PILOT_READINESS', 'CI_VALIDATION']) {
    assert.ok(packageFilePaths(source).includes(`docs/${doc}.md`));
  }
});
