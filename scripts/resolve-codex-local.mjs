import { writeFile } from "node:fs/promises";
async function get(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error("Public dependency metadata unavailable: " + r.status);
  return r;
}
const codex = await (
  await get("https://registry.npmjs.org/@openai%2Fcodex/latest")
).json();
const repository = "ollama/ollama",
  tag = "0.40.16";
const { token } = await (
  await get(
    "https://auth.docker.io/token?service=registry.docker.io&scope=repository:" +
      repository +
      ":pull",
  )
).json();
const r = await get(
  "https://registry-1.docker.io/v2/" + repository + "/manifests/" + tag,
  {
    method: "HEAD",
    headers: {
      Authorization: "Bearer " + token,
      Accept:
        "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
    },
  },
);
const digest = r.headers.get("docker-content-digest");
if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? ""))
  throw Error("Missing image digest");
const lock = {
  resolvedAt: new Date().toISOString(),
  codex: {
    package: "@openai/codex",
    version: codex.version,
    integrity: codex.dist.integrity,
    tarball: codex.dist.tarball,
  },
  ollama: { version: tag, image: repository + "@" + digest },
  model: {
    name: "qwen3:4b-instruct",
    expectedRegistryManifestSha256:
      "0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0",
    contextTokens: 65536,
    cloud: false,
  },
};
await writeFile("infra/local/codex.lock.json", JSON.stringify(lock, null, 2));
console.log(JSON.stringify(lock, null, 2));
