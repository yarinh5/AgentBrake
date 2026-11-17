import test from 'node:test';
import assert from 'node:assert/strict';
import {failureDiagnostics} from '../../scripts/ci-failure-diagnostics.mjs';
test('CI diagnostics locate failures without emitting error payloads or credentials',()=>{
 const secret='synthetic-secret-do-not-emit';
 const d=failureDiagnostics('node-tests',`not ok 3 - ${secret}\n location: '/home/runner/tests/enforcement/accounts.test.ts:20:1'\n code: 'ENOENT'\n error: '${secret}'`);
 assert.equal(d.failedTests,1);assert.deepEqual(d.codes,['ENOENT']);assert.deepEqual(d.locations,['tests/enforcement/accounts.test.ts:20:1']);assert.ok(!JSON.stringify(d).includes(secret));
 const c=failureDiagnostics('container-logs',`EACCES permission denied /run/secrets/opa-token ${secret}`);
 assert.deepEqual(c.protectedFiles,['/run/secrets/opa-token']);assert.ok(c.categories.includes('permissionDenied'));assert.ok(!JSON.stringify(c).includes(secret));
 assert.equal(failureDiagnostics(secret,secret),null);
});
