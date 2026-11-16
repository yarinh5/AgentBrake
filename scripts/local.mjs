import { spawn } from "node:child_process";
import { startOpa, root } from "./opa-runtime.mjs";
const opa = await startOpa();
const osEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    [
      "PATH",
      "SYSTEMROOT",
      "WINDIR",
      "TEMP",
      "TMP",
      "HOME",
      "USERPROFILE",
    ].includes(key.toUpperCase()),
  ),
);
const child = spawn(
  process.execPath,
  ["--import", "tsx", "server/stage1.ts", ...process.argv.slice(2)],
  {
    cwd: root,
    env: { ...osEnv, OPA_URL: opa.url, OPA_TOKEN: opa.token },
    stdio: "inherit",
    windowsHide: true,
  },
);
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    interrupted = true;
    child.kill();
  });
try {
  process.exitCode = await new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(interrupted ? 0 : (code ?? 1)));
  });
} finally {
  await opa.stop();
}
