// Public Docker Hub metadata only. Never reads Docker credentials/config.
import { writeFile } from "node:fs/promises";
const images = {
  node: ["library/node", "22-bookworm-slim"],
  postgres: ["library/postgres", "18-alpine"],
  opa: ["openpolicyagent/opa", "1.22.4-static"],
};
const result = { resolvedAt: new Date().toISOString(), images: {} };
for (const [key, [repository, tag]] of Object.entries(images)) {
  const tokenResponse = await fetch(
    `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!tokenResponse.ok) throw new Error("Public registry auth failed");
  const { token } = await tokenResponse.json();
  const manifest = await fetch(
    `https://registry-1.docker.io/v2/${repository}/manifests/${tag}`,
    {
      method: "HEAD",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:
          "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  const digest = manifest.headers.get("docker-content-digest");
  if (!manifest.ok || !/^sha256:[0-9a-f]{64}$/.test(digest ?? ""))
    throw new Error(`No verified digest for ${repository}:${tag}`);
  result.images[key] = {
    tag: `${repository}:${tag}`,
    image: `${repository}@${digest}`,
  };
  console.log(`${key}: ${digest}`);
}
await writeFile(
  new URL("../infra/local/images.lock.json", import.meta.url),
  JSON.stringify(result, null, 2),
);
