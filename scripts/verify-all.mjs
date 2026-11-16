import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { sourceManifest } from "./source-manifest.mjs";
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const startedAt = new Date().toISOString();
const milestoneB = process.argv.includes("--milestone-b");
for (const script of [
  "scripts/verify-stage1.mjs",
  "scripts/verify-isolation.mjs",
]) {
  const code = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        script,
        ...(milestoneB && script.endsWith("verify-isolation.mjs")
          ? ["--milestone-b"]
          : []),
      ],
      {
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
  if (code !== 0) process.exit(code);
}
const nativePointer = await json("docs/evidence/latest.json"),
  isolationPointer = await json("docs/evidence/latest-isolation.json");
const native = await json(nativePointer.directory + "/summary.json"),
  isolation = await json(
    isolationPointer.directory + "/isolation-summary.json",
  );
const current = await sourceManifest();
if (
  native.result !== "PASS_SCOPED" ||
  isolation.result !== "PASS" ||
  (milestoneB &&
    (isolation.milestoneB !== "PASS_BOUNDED" ||
      isolation.cleanup?.result !== "PASS" ||
      isolation.credentialScan?.result !== "PASS")) ||
  native.sourceHash !== isolation.sourceHash ||
  native.sourceHash !== current.sourceHash
)
  throw Error("Verification/source mismatch");
const testCounts = async (path) => {
  const log = await readFile(path, "utf8"),
    counts = {};
  for (const name of ["tests", "pass", "fail", "skipped"])
    counts[name] = Number(
      log.match(new RegExp("^# " + name + " (\\d+)$", "m"))?.[1] ?? NaN,
    );
  return counts;
};
const report = {
  result: "PASS_BOUNDED",
  stage: milestoneB ? "Milestone B" : 2,
  startedAt,
  finishedAt: new Date().toISOString(),
  sourceHash: current.sourceHash,
  gitCommit: null,
  nativeRun: native.runId,
  isolationRun: isolation.runId,
  nativeTests: await testCounts(nativePointer.directory + "/node-tests.log"),
  postgresTests: await testCounts(
    isolationPointer.directory + "/stage2-postgres-tests.log",
  ),
  workflowCases: isolation.stage2.cases.length,
  ...(milestoneB
    ? {
        gitContainerTests: await testCounts(
          isolationPointer.directory + "/git-container-tests.log",
        ),
        benchmark: {
          ...isolation.benchmark.metrics,
          authorizationP50Ms: isolation.benchmark.authorizationP50Ms,
          authorizationP95Ms: isolation.benchmark.authorizationP95Ms,
          corpusHash: isolation.benchmark.corpusHash,
        },
        codex: {
          version: isolation.codexRun.version,
          binarySha256: isolation.codexRun.binarySha256,
          model: isolation.codexRun.model,
          actualActions: isolation.codexProof.actions.length,
          replayedReads: isolation.codexProof.replayedReads.length,
          forbiddenReplayRule: isolation.codexProof.forcedInjectionAttempt.rule,
        },
        environmentHash: isolation.environmentHash,
        cleanup: isolation.cleanup,
        credentialScan: isolation.credentialScan,
      }
    : {}),
  scope: milestoneB
    ? "Local official Codex CLI with actual Qwen inference, gateway/MCP/OPA, synthetic PostgreSQL/Git mock PR, injection replay and curated test-client benchmark. No hosted OpenAI model or live GitHub; not production or statistical model reliability."
    : "Local PostgreSQL control/target + actual disposable Git/mock PR + gateway/OPA/MCP + isolated agent. See known limitations; not Milestone B or live GitHub/Codex acceptance.",
};
await writeFile(
  milestoneB
    ? "docs/evidence/milestone-b.json"
    : "docs/evidence/stage2-latest.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
