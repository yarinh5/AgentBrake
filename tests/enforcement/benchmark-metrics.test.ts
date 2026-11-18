import test from "node:test";
import assert from "node:assert/strict";
import { toolSchemas } from '../../server/contracts.js';
// @ts-expect-error Small shared ESM fixture module is intentionally not a TS library.
import * as corpus from "../milestone-b/corpus.mjs";
const { metrics, legitimate, classifyBlocked, classifyAction } = corpus;
test('every expanded legitimate change uses a supported target path and payload', () => {
  for (const item of corpus.expandedLegitimate) {
    if (!item.path) continue;
    const parsed = toolSchemas.github_propose_change.safeParse({
      repo: 'agentbrake/sandbox', baseSha: 'a'.repeat(40),
      branch: 'agentbrake/expanded-gateway-' + item.id,
      changes: [{ path: item.path, content: item.content }],
    });
    assert.equal(parsed.success, true, item.id + ': ' + (parsed.success ? '' : parsed.error.message));
  }
});
test("post-execution withheld output is a usability block, not completion or prevented mutation", () => {
  assert.equal(classifyAction({ status: "allowed", resultDisclosure: "withheld" }), "withheld");
  assert.equal(classifyAction({ status: "allowed", resultDisclosure: "released" }), "completed");
  assert.equal(classifyAction({ status: "blocked", rule: "secret-protection" }), "policy");
  assert.equal(classifyAction({ status: "unknown", resultDisclosure: "unavailable" }), "operational");
  assert.equal(classifyAction({ status: "failed", executionOutcome: "not-applied" }), "operational");
});
test("benchmark denominators separate policy blocks, approvals, baseline and transport failures", () => {
  const result = metrics([
    {
      baselineSucceeded: true,
      completed: true,
      falseBlock: false,
      approvals: 2,
    },
    {
      baselineSucceeded: true,
      completed: false,
      falseBlock: true,
      approvals: 0,
    },
    {
      baselineSucceeded: true,
      completed: false,
      falseBlock: false,
      approvals: 0,
    },
    {
      baselineSucceeded: false,
      completed: false,
      falseBlock: false,
      approvals: 0,
    },
  ]);
  assert.deepEqual(result, {
    total: 4,
    baselineSucceeded: 3,
    completed: 1,
    falseBlocks: 1,
    nonPolicyFailures: 1,
    completionVsBaseline: 1 / 3,
    falseBlockRate: 1 / 3,
    approvalRequired: 2,
  });
  assert.equal(metrics([]).falseBlockRate, null);
  assert.equal(
    new Set(legitimate.map((x: any) => x.id)).size,
    legitimate.length,
  );
});
test("PDP and unknown operational refusals fail the benchmark rather than inflate policy false blocks", () => {
  assert.equal(classifyBlocked("secret-protection"), "policy");
  for (const rule of [
    "pdp-timeout",
    "pdp-unavailable",
    "pdp-error",
    "pdp-invalid-response",
    "pdp-invalid-configuration",
    "invalid-policy-input",
    "future-unknown-error",
  ])
    assert.equal(classifyBlocked(rule), "operational");
});

test("expanded reporting cannot hide failed baselines or pool away placeholder false blocks", () => {
  const observations = [
    { kind: 'read', baselineSucceeded: true, completed: true, falseBlock: false, approvals: 0, baselineMs: 4, gatewayMs: 10, actions: [{ authorizationMs: 2, requestMs: 8 }] },
    { kind: 'preview', baselineSucceeded: true, completed: false, falseBlock: true, approvals: 0, baselineMs: 6, gatewayMs: 20, actions: [{ authorizationMs: 3, requestMs: 18 }] },
    { kind: 'update', baselineSucceeded: false, completed: false, falseBlock: false, approvals: 1, baselineMs: 8, gatewayMs: 30, actions: [{ authorizationMs: 5, requestMs: 9, approvalMs: 16 }] },
  ];
  const r = corpus.measurementReport(observations);
  assert.equal(r.measurementResult, 'FAIL');
  assert.equal(r.usabilityTarget, 'NOT_MET');
  assert.equal(r.baselineFailures, 1);
  assert.equal(r.byKind.preview.falseBlockRate, 1);
  assert.equal(r.timing.gatewayTask.p50Ms, 20);
  assert.equal(r.timing.gatewayTask.p95Ms, 30);
  assert.equal(r.timing.automatedApprovalRoundTrip.p50Ms, 16);
  assert.equal(r.timing.automatedApprovalRoundTrip.count, 1);
  assert.equal(corpus.measurementReport([]).usabilityTarget, 'INSUFFICIENT_SAMPLE');
  const many = Array.from({ length: 200 }, (_, i) => ({ kind: 'read', baselineSucceeded: true, completed: i >= 4, falseBlock: i < 4, approvals: 0 }));
  assert.equal(corpus.measurementReport(many).usabilityTarget, 'NOT_MET', 'exactly 2% is not less than 2%');
  many[3].completed = true; many[3].falseBlock = false;
  assert.equal(corpus.measurementReport(many).usabilityTarget, 'MET_SYNTHETIC_ONLY');
  assert.equal(corpus.measurementReport(many).timing.gatewayTask.p95Ms, null, 'missing measurements are not zero latency');
});
