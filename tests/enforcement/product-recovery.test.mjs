import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const scenario of ["build-failure", "recovery-failure", "success", "minimal-success", "minimal-image-mismatch", "unknown-profile", "ordinary-start"]) {
  test("actual restore/start orchestration: " + scenario + " (simulated Docker)", () => {
    const result = spawnSync(process.execPath, [
      "--experimental-vm-modules",
      fileURLToPath(new URL("./service-restore-orchestration.mjs", import.meta.url)),
      scenario,
    ], { encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
