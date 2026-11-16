import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { startOpa, root, opaPath } from "./opa-runtime.mjs";
export async function run(command, args, env = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
const rego = await run(opaPath, ["test", "services/policy", "-v"]);
if (rego) process.exit(rego);
const opa = await startOpa();
try {
  const files = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const target = join(path, entry.name);
      if (entry.isDirectory() && entry.name !== "browser") await walk(target);
      else if (
        /\.test\.(?:ts|mjs)$/.test(entry.name) &&
        entry.name !== "postgres-control.test.ts"
      )
        files.push(target);
    }
  }
  await walk(join(root, "tests"));
  process.exitCode = await run(
    process.execPath,
    ["--import", "tsx", "--test", "--test-concurrency=1", ...files],
    { OPA_URL: opa.url, OPA_TOKEN: opa.token },
  );
} finally {
  await opa.stop();
}
