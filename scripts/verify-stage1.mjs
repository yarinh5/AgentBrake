import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import { startOpa, root, opaPath } from "./opa-runtime.mjs";
import { sourceManifest } from "./source-manifest.mjs";
import { failureDiagnostics } from "./ci-failure-diagnostics.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const runId = randomUUID(),
  startedAt = new Date().toISOString();
const directory = join(root, "docs", "evidence", runId);
await mkdir(directory, { recursive: true });
const { sourceHash, files: manifest } = await sourceManifest();
await writeFile(
  join(directory, "source-manifest.json"),
  JSON.stringify({ sourceHash, files: manifest }, null, 2),
);
const opa = await startOpa();
const commands = [];
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    [
      "PATH",
      "SYSTEMROOT",
      "WINDIR",
      "TEMP",
      "TMP",
      "HOME",
      "USERPROFILE",
      "LOCALAPPDATA",
      "APPDATA",
      "PROGRAMFILES",
    ].includes(key.toUpperCase()),
  ),
);
const env = { ...baseEnv, OPA_URL: opa.url, OPA_TOKEN: opa.token };
async function run(label, command, args) {
  const at = new Date().toISOString();
  let output = "";
  const exitCode = await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.once("error", (e) => {
      output += "spawn error: " + e.message;
      resolve(1);
    });
    child.once("exit", (code) => resolve(code ?? 1));
  });
  output = output.replaceAll(opa.token, "[REDACTED]");
  if (exitCode && label === "node-tests") console.log(JSON.stringify(failureDiagnostics(label, output)));
  await writeFile(join(directory, label + ".log"), output);
  commands.push({
    label,
    command: [relative(root, command) || command, ...args].join(" "),
    startedAt: at,
    finishedAt: new Date().toISOString(),
    exitCode,
    result: exitCode === 0 ? "PASS" : "FAIL",
    log: label + ".log",
  });
  console.log(
    `${label}: ${exitCode === 0 ? "PASS" : "FAIL"} (exit ${exitCode})`,
  );
  return exitCode;
}
try {
  await run("rego", opaPath, ["test", "services/policy", "-v"]);
  const tests = [];
  async function collect(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== "browser")
        await collect(join(path, entry.name));
      else if (
        /\.test\.(?:ts|mjs)$/.test(entry.name) &&
        entry.name !== "postgres-control.test.ts"
      )
        tests.push(relative(root, join(path, entry.name)));
    }
  }
  await collect(join(root, "tests"));
  await run("node-tests", process.execPath, [
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    ...tests,
  ]);
  await run("typecheck", process.execPath, [
    "node_modules/typescript/bin/tsc",
    "--noEmit",
  ]);
  const build = await run("build", process.execPath, [
    "node_modules/vite/bin/vite.js",
    "build",
  ]);
  if (!build) {
    const dashboard = await run("dashboard-build", process.execPath, [
      "scripts/build-dashboard.mjs",
    ]);
    if (!dashboard)
      await run("browser", process.execPath, ["tests/product-ui/run.mjs"]);
  }
  await run("upstream-proof", process.execPath, [
    "--import",
    "tsx",
    "tests/evidence-scenarios.ts",
    join(directory, "upstream-proof.json"),
  ]);
  const dockerExit = await run("docker-preflight", "docker", [
    "--config",
    join(root, ".agentbrake-local/docker-public"),
    ...(process.platform === "win32"
      ? ["--host", "npipe:////./pipe/docker_engine"]
      : []),
    "version",
    "--format",
    "{{json .Server}}",
  ]);
  const environment = {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    opa: opa.version,
    packageLockHash: hash(await readFile(join(root, "package-lock.json"))),
  };
  const summary = {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    gitCommit: null,
    gitReason: "Workspace is not a Git repository; no commit fabricated.",
    sourceHash,
    policyHash: opa.policyHash,
    environment,
    environmentHash: hash(JSON.stringify(environment)),
    commands,
    scope:
      "Authenticated native OPA; loopback HTTP/MCP; counted synthetic SQLite/repository fixture adapters. No external GitHub or PostgreSQL calls.",
    isolation: {
      T20: "NOT RUN",
      reason: dockerExit
        ? "Docker daemon unavailable; docker-preflight.log records actual error."
        : "Run verify:isolation separately; native tests do not prove container isolation.",
    },
    milestoneA: "See separate native+isolation milestone evidence",
    result: commands
      .filter((c) => c.label !== "docker-preflight")
      .every((c) => c.exitCode === 0)
      ? "PASS_SCOPED"
      : "FAIL",
  };
  await writeFile(
    join(directory, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  await writeFile(
    join(root, "docs", "evidence", "latest.json"),
    JSON.stringify(
      {
        runId,
        directory: relative(root, directory).replaceAll("\\", "/"),
        result: summary.result,
      },
      null,
      2,
    ),
  );
  process.exitCode = summary.result === "PASS_SCOPED" ? 0 : 1;
  console.log(
    `Evidence: ${relative(root, directory)}\n${summary.result}; Container evidence is reported separately.`,
  );
} finally {
  await opa.stop();
}
