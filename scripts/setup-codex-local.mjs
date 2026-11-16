import { spawn } from "node:child_process";
import { verifyModelCache } from "./verify-model-cache.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
const lock = JSON.parse(await readFile("infra/local/codex.lock.json", "utf8"));
const cache = resolve(".tools/ollama-models"),
  config = resolve(".agentbrake-local/docker-public");
await mkdir(cache, { recursive: true });
await mkdir(config, { recursive: true });
const name = "agentbrake-model-setup-" + randomUUID().slice(0, 8);
const args = [
  "--config",
  config,
  ...(process.platform === "win32"
    ? ["--host", "npipe:////./pipe/docker_engine"]
    : []),
];
async function docker(options) {
  return await new Promise((resolveResult, reject) => {
    let tail = "";
    const p = spawn("docker", [...args, ...options], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    p.stdout.on("data", (b) => (tail = (tail + b).slice(-4000)));
    p.stderr.on("data", (b) => (tail = (tail + b).slice(-4000)));
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolveResult(tail)
        : reject(Error("Docker setup failed: " + tail)),
    );
  });
}
console.log(
  "Downloading pinned local inference runtime (no task credentials).",
);
await docker(["pull", lock.ollama.image]);
try {
  await docker([
    "run",
    "-d",
    "--name",
    name,
    "--label",
    "com.agentbrake.fixture=true",
    "--mount",
    "type=bind,src=" + cache + ",dst=/models",
    "--env",
    "OLLAMA_MODELS=/models",
    "--env",
    "OLLAMA_NO_CLOUD=1",
    lock.ollama.image,
    "serve",
  ]);
  console.log(
    "Downloading " + lock.model.name + " weights to the project cache.",
  );
  await docker(["exec", name, "ollama", "pull", lock.model.name]);
  Object.assign(
    lock.model,
    await verifyModelCache(cache, lock.model.expectedRegistryManifestSha256),
  );
  await writeFile("infra/local/codex.lock.json", JSON.stringify(lock, null, 2));
  console.log("Local model ready: sha256:" + lock.model.manifestSha256);
} finally {
  await docker(["rm", "--force", name]);
}
