import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
export const root = fileURLToPath(new URL("../", import.meta.url));
export const opaPath = join(
  root,
  ".tools",
  process.platform === "win32" ? "opa.exe" : "opa",
);
export async function startOpa() {
  const toolchain = JSON.parse(
    await readFile(join(root, "services/policy/toolchain.json"), "utf8"),
  );
  const asset = toolchain.assets[`${process.platform}-${process.arch}`];
  const binary = await readFile(opaPath).catch(() => {
    throw new Error("Run npm run setup:policy first");
  });
  if (
    !asset ||
    createHash("sha256").update(binary).digest("hex") !== asset.sha256
  )
    throw new Error("OPA binary is not the verified version");
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const temp = await mkdtemp(join(tmpdir(), "agentbrake-opa-"));
  const token = randomBytes(32).toString("hex");
  const policyHash = createHash("sha256")
    .update(await readFile(join(root, "services/policy/agentbrake.rego")))
    .update(await readFile(join(root, "services/policy/authz.rego")))
    .digest("hex");
  await writeFile(
    join(temp, "auth.json"),
    JSON.stringify({
      agentbrake_auth: { token },
      agentbrake_meta: { policy_hash: policyHash },
    }),
    { mode: 0o600 },
  );
  const child = spawn(
    opaPath,
    [
      "run",
      "--server",
      "--addr",
      `127.0.0.1:${port}`,
      "--authentication=token",
      "--authorization=basic",
      "--log-level=error",
      join(root, "services/policy/agentbrake.rego"),
      join(root, "services/policy/authz.rego"),
      join(temp, "auth.json"),
    ],
    {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        SystemRoot: process.env.SystemRoot,
        PATH: process.env.PATH,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
      },
    },
  );
  let startupError = "";
  child.stderr.on("data", (chunk) => {
    startupError += chunk.toString();
  });
  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    const target = resolve(temp);
    if (
      !target.startsWith(resolve(tmpdir()) + "\\") &&
      !target.startsWith(resolve(tmpdir()) + "/")
    )
      throw new Error("Unsafe temporary path");
    await rm(target, { recursive: true, force: true });
  };
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) {
      await stop();
      throw new Error(
        "OPA startup failed: " + startupError.replaceAll(token, "[REDACTED]"),
      );
    }
    try {
      const response = await fetch(url + "/health", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(100),
      });
      if (response.ok)
        return { url, token, policyHash, stop, version: toolchain.version };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await stop();
  throw new Error("OPA did not become ready");
}
