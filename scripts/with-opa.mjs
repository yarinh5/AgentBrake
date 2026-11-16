import { spawn } from "node:child_process";
import { startOpa, root } from "./opa-runtime.mjs";
const opa = await startOpa();
try {
  process.exitCode = await new Promise((resolve) => {
    const child = spawn(process.execPath, process.argv.slice(2), {
      cwd: root,
      env: { ...process.env, OPA_URL: opa.url, OPA_TOKEN: opa.token },
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await opa.stop();
}
