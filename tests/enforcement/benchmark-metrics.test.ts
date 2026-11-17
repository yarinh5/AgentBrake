import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Small shared ESM fixture module is intentionally not a TS library.
import * as corpus from "../milestone-b/corpus.mjs";
const { metrics, legitimate, classifyBlocked, classifyAction } = corpus;
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
