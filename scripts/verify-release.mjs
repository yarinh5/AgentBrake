import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { sourceManifest } from "./source-manifest.mjs";
const startedAt = new Date().toISOString();
for (const args of [
  ["scripts/verify-all.mjs", "--milestone-b", "--coding-workflow"],
  ["scripts/verify-product.mjs"],
  ["scripts/verify-service.mjs"],
  ["scripts/verify-candidate.mjs"],
  ["scripts/verify-security.mjs"],
]) {
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
  if (code) process.exit(code);
}
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const baseline = await json("docs/evidence/milestone-b.json"),
  productPointer = await json("docs/evidence/latest-product.json"),
  securityPointer = await json("docs/evidence/latest-security.json");
const product = await json(productPointer.directory + "/product-summary.json"),
  security = await json(securityPointer.directory + "/security-summary.json"),
  source = await sourceManifest();
const servicePointer = await json("docs/evidence/latest-service.json");
const service = await json(servicePointer.directory + "/service-summary.json");
const candidatePointer = await json('docs/evidence/latest-candidate.json');
const candidate = await json(candidatePointer.directory + '/candidate-summary.json');
if (
  baseline.result !== "PASS_BOUNDED" ||
  baseline.coding?.result !== "PASS_SCOPED_LOCAL_CODING" ||
  product.result !== "PASS_LOCAL_PRODUCT" ||
  security.result !== "PASS_LOCAL_SECURITY_CHECKS" ||
  service.result !== "PASS_LOCAL_SERVICE" ||
  candidate.result !== 'PASS_LOCAL_CANDIDATE' || candidate.cleanup?.result !== 'PASS' || candidate.sourceHash !== source.sourceHash ||
  service.cleanup.some((item) => item.result !== "PASS") ||
  [baseline, product, security, service].some(
    (r) => r.sourceHash !== source.sourceHash,
  ) ||
  product.cleanup?.result !== "PASS"
)
  throw Error("Release acceptance or exact-source consistency failed");
const report = {
  result: "LOCAL_MVP_VERIFIED_EXTERNAL_GATES_OPEN",
  startedAt,
  finishedAt: new Date().toISOString(),
  sourceHash: source.sourceHash,
  gitCommit: null,
  milestoneC: "PASS_LOCAL",
  milestoneD: "LOCAL_ENGINEERING_VERIFIED_EXTERNAL_SIGNOFF_PENDING",
  baseline,
  productRun: product.runId,
  service: {
    runId: service.runId,
    result: service.result,
    cases: service.cases,
    cleanup: service.cleanup,
  },
  securityRun: security.runId,
  candidateRun: candidate.runId,
  productCases: product.cases,
  security: {
    scanner: security.scannerVersion,
    sast: security.sast,
    root: security.root,
    dashboard: security.dashboard,
  },
  externalGates: {
    independentCleanMachine: "NOT_RUN",
    externalHumanSecuritySignoff: "NOT_OBTAINED",
    liveGitHubApp: "OPT_IN_OFFLINE_CONTRACTS_VERIFIED_LIVE_NOT_RUN",
    productionDeployment: "NOT_AUTHORIZED_NOT_RUN",
    marketInterviews: "NOT_RUN",
  },
  scope:
    "Local synthetic service and HTTPS/GitHub-App candidate contract verification only; no paid inference, real target credentials or external deployment. Actual Codex uses local Qwen in the separate isolated verification profile.",
};
await writeFile(
  "docs/evidence/local-release.json",
  JSON.stringify(report, null, 2),
);
console.log(report.result + " source=" + source.sourceHash);
