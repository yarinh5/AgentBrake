import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const cwd = fileURLToPath(new URL("../apps/dashboard/", import.meta.url));
const child = spawn(
  process.execPath,
  [join(cwd, "node_modules/next/dist/bin/next"), "build", "--webpack"],
  {
    cwd,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    windowsHide: true,
    stdio: "inherit",
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
