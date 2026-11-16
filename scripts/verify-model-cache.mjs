import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
export async function verifyModelCache(cache, expected) {
  const bytes = await readFile(
    join(cache, "manifests/registry.ollama.ai/library/qwen3/4b-instruct"),
  );
  const local = JSON.parse(bytes),
    sha = (value) => createHash("sha256").update(value).digest("hex");
  let original = local;
  if (sha(bytes) !== expected) {
    const provenance = local.layers.find(
      (l) =>
        l.digest === "sha256:" + expected &&
        l.mediaType === "application/vnd.docker.distribution.manifest.v2+json",
    );
    if (!provenance) throw Error("Model registry provenance mismatch");
    const upstream = await readFile(join(cache, "blobs/sha256-" + expected));
    if (sha(upstream) !== expected)
      throw Error("Model registry manifest hash mismatch");
    original = JSON.parse(upstream);
    if (
      JSON.stringify(original.config) !== JSON.stringify(local.config) ||
      JSON.stringify(original.layers) !==
        JSON.stringify(local.layers.filter((l) => l !== provenance))
    )
      throw Error("Local model differs from reviewed registry layers");
  }
  const blobs = [local.config, ...local.layers];
  for (const blob of blobs) {
    if (!/^sha256:[0-9a-f]{64}$/.test(blob.digest))
      throw Error("Invalid blob digest");
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of createReadStream(
      join(cache, "blobs/" + blob.digest.replace(":", "-")),
    )) {
      hash.update(chunk);
      size += chunk.length;
    }
    if (hash.digest("hex") !== blob.digest.slice(7) || size !== blob.size)
      throw Error("Model blob integrity mismatch");
  }
  return {
    manifestSha256: sha(bytes),
    registryManifestSha256: expected,
    blobs: blobs.map(({ digest, size }) => ({ digest, size })),
  };
}
