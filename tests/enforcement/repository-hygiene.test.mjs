import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectChangedFile} from '../../scripts/verify-repository-hygiene.mjs';

test('repository hygiene rejects raw evidence, credentials and host paths', () => {
  assert.deepEqual(
    inspectChangedFile('docs/evidence/run-1/summary.json', Buffer.from('{}')),
    ['raw generated evidence must be a CI artifact'],
  );
  assert.deepEqual(
    inspectChangedFile('docs/enterprise-work/restore-evidence-run/source-manifest.json', Buffer.from('{}')),
    ['raw generated evidence must be a CI artifact'],
  );
  assert.ok(inspectChangedFile('docs/evidence/release.json', Buffer.from(String.raw`C:\Users\operator`)).includes('local or runner path in retained evidence'));
  assert.ok(inspectChangedFile('server/config.ts', Buffer.from('ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).includes('possible GitHub token'));
});

test('repository hygiene permits curated summaries and explicit synthetic fixtures', () => {
  assert.deepEqual(inspectChangedFile('docs/evidence/release.json', Buffer.from('{"result":"PASS"}')), []);
  assert.deepEqual(inspectChangedFile('tests/enforcement/credential-marker-cases.json', Buffer.from('ghp_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ')), []);
});
