import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { sourceManifest } from "./source-manifest.mjs";
import { packageFilePaths } from "./package-inventory.mjs";
const source = await sourceManifest();
const release = JSON.parse(
  await readFile("docs/evidence/local-release.json", "utf8"),
);
assert.equal(
  release.sourceHash,
  source.sourceHash,
  "Package requires the verified current source",
);
assert.equal(release.result, "LOCAL_MVP_VERIFIED_EXTERNAL_GATES_OPEN");
assert.equal(release.baseline?.coding?.result, "PASS_SCOPED_LOCAL_CODING",
  "Package requires the useful actual Codex coding-to-local-PR gate");
assert.equal(
  release.service?.result,
  "PASS_LOCAL_SERVICE",
  "Package requires the service lifecycle acceptance gate",
);
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const output = resolve(".agentbrake-local/releases");
await mkdir(output, { recursive: true, mode: 0o700 });
const stage = join(output, "stage-" + randomUUID());
await mkdir(stage, { mode: 0o700 });
const files = packageFilePaths(source);
const manifest = [];
for (const file of files) {
  const destination = join(stage, file);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(file, destination, 1);
  const bytes = await readFile(destination);
  manifest.push({
    path: file,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await writeFile(
  join(stage, "RELEASE.json"),
  JSON.stringify(
    {
      version,
      sourceHash: source.sourceHash,
      createdAt: new Date().toISOString(),
      files: manifest,
      scope:
        "Private local installation; dependency images/packages fetched separately. No runtime credentials, data, models or node_modules included. External acceptance gates remain documented.",
    },
    null,
    2,
  ),
);
const archive = join(
  output,
  `agentbrake-${version}-${source.sourceHash.slice(0, 12)}-${randomUUID().slice(0, 8)}.tar.gz`,
);
const packed = spawnSync("tar", ["-czf", archive, "-C", stage, "."], {
  encoding: "utf8",
  windowsHide: true,
  timeout: 120000,
});
if (packed.status !== 0)
  throw Error("Source packaging failed: " + packed.stderr);
const bytes = await readFile(archive),
  sha256 = createHash("sha256").update(bytes).digest("hex");
await writeFile(
  archive + ".sha256",
  sha256 + "  " + archive.split(/[\\/]/).at(-1) + "\n",
  { flag: "wx" },
);
const result = {
  archive,
  sha256,
  bytes: bytes.length,
  version,
  sourceHash: source.sourceHash,
  files: manifest.length,
};
await writeFile(
  "docs/evidence/release-package.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
