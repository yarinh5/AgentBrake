import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { sourceManifest } from "./source-manifest.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  runId = randomUUID(),
  directory = join(root, "docs/evidence", runId);
await mkdir(directory, { recursive: true });
const manifest = await sourceManifest(),
  report = {
    runId,
    sourceHash: manifest.sourceHash,
    startedAt: new Date().toISOString(),
    result: "NOT_RUN",
    checks: [],
    limits:
      "Semgrep OSS with eight local rules, npm advisories and dependency SBOM. Not exhaustive interprocedural analysis, OS image CVE coverage, penetration testing or external human review.",
  };
await writeFile(
  join(directory, "source-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
const run = async (label, command, args, cwd = root) => {
  let output = "",
    errors = "";
  const code = await new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (errors += d));
    child.on("error", (e) => {
      errors += e.message;
      resolveResult(1);
    });
    child.on("exit", (code) => resolveResult(code ?? 1));
  });
  await writeFile(join(directory, label + ".log"), errors);
  await writeFile(join(directory, label + ".json"), output);
  report.checks.push({ label, exitCode: code });
  if (code) throw Error(label + " failed (" + code + ")");
  return output;
};
const dockerArgs = [
  "--config",
  join(root, ".agentbrake-local/docker-public"),
  ...(process.platform === "win32"
    ? ["--host", "npipe:////./pipe/docker_engine"]
    : []),
];
try {
  const lock = JSON.parse(
    await readFile(join(root, "infra/security/tools.lock.json"), "utf8"),
  );
  const image = lock.semgrep.image;
  const base = [
    ...dockerArgs,
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    "1000:1000",
    "--tmpfs",
    "/tmp:rw,size=128m,mode=1777",
    "--env",
    "HOME=/tmp",
    "--env",
    "SEMGREP_SEND_METRICS=off",
    "--env",
    "SEMGREP_ENABLE_VERSION_CHECK=0",
    "--workdir",
    "/src",
    "--mount",
    `type=bind,src=${join(root, "infra/security")},dst=/rules,readonly`,
  ];
  const mounts = [];
  for (const [source, target] of [
    ["server", "server"],
    ["src", "src"],
    ["scripts", "scripts"],
    ["apps/dashboard/app", "dashboard-app"],
    ["apps/dashboard/lib", "dashboard-lib"],
    ["infra/product", "product"],
  ])
    mounts.push(
      "--mount",
      `type=bind,src=${join(root, source)},dst=/src/${target},readonly`,
    );
  report.scannerVersion = (
    await run("scanner-version", "docker", [
      ...base,
      image,
      "semgrep",
      "--version",
    ])
  ).trim();
  report.scannerImage = image;
  await run("sast-rule-tests", "docker", [
    ...base,
    image,
    "semgrep",
    "--test",
    "/rules",
    "--metrics=off",
    "--disable-version-check",
  ]);
  const scan = JSON.parse(
    await run("sast", "docker", [
      ...base,
      ...mounts,
      image,
      "semgrep",
      "scan",
      "--config=/rules/security.yaml",
      "--metrics=off",
      "--disable-version-check",
      "--no-git-ignore",
      "--error",
      "--json",
      "/src",
    ]),
  );
  if (scan.errors?.length)
    throw Error("SAST parser/config errors must be investigated");
  report.sast = {
    rules: 8,
    findings: scan.results.length,
    scanned: scan.paths?.scanned?.length ?? 0,
  };
  let npmCli =
    process.env.npm_execpath ??
    join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  if (!existsSync(npmCli) && existsSync("/usr/bin/npm"))
    npmCli = realpathSync("/usr/bin/npm");
  if (!existsSync(npmCli))
    throw Error(
      "Run via npm run verify:security so the installed npm CLI path is explicit",
    );
  for (const [name, cwd] of [
    ["root", root],
    ["dashboard", join(root, "apps/dashboard")],
  ]) {
    const bom = JSON.parse(
      await run(
        name + "-sbom",
        process.execPath,
        [
          npmCli,
          "sbom",
          "--package-lock-only",
          "--sbom-format=cyclonedx",
          "--sbom-type=application",
        ],
        cwd,
      ),
    );
    if (!bom.components?.length) throw Error("SBOM components missing");
    const audit = JSON.parse(
      await run(
        name + "-audit",
        process.execPath,
        [
          npmCli,
          "audit",
          "--json",
          "--cache",
          join(root, ".agentbrake-local/npm-cache"),
        ],
        cwd,
      ),
    );
    report[name] = {
      components: bom.components.length,
      vulnerabilities: audit.metadata.vulnerabilities,
    };
  }
  const current = await sourceManifest();
  if (current.sourceHash !== manifest.sourceHash)
    throw Error("Source changed during security scan; rerun final gate");
  report.result = "PASS_LOCAL_SECURITY_CHECKS";
} catch (error) {
  report.result = "FAIL";
  report.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
}
report.finishedAt = new Date().toISOString();
await writeFile(
  join(directory, "security-summary.json"),
  JSON.stringify(report, null, 2),
);
await writeFile(
  join(root, "docs/evidence/latest-security.json"),
  JSON.stringify({ runId, directory, result: report.result }, null, 2),
);
console.log(report.result + ": " + directory);
