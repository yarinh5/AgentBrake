// Focused source-distribution build check, deliberately separate from the gated
// final release packager. This creates an UNVERIFIED local staging archive.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, copyFile, symlink, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { sourceManifest } from "../../scripts/source-manifest.mjs";
import { packageFilePaths } from "../../scripts/package-inventory.mjs";
import { root } from "../../scripts/opa-runtime.mjs";

const work = await mkdtemp(join(root, ".agentbrake-local/service-package-build-"));
const stage = join(work, "stage"), extracted = join(work, "extracted");
await mkdir(stage);
await mkdir(extracted);
const source = await sourceManifest();
const files = packageFilePaths(source);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = [];
for (const file of files) {
  assert.ok(!/(^|\/)(node_modules|\.agentbrake-local|\.env)(\/|$)/.test(file));
  const to = join(stage, file);
  await mkdir(dirname(to), { recursive: true });
  await copyFile(join(root, file), to, 1);
  manifest.push({ path: file, sha256: hash(await readFile(to)) });
}
await writeFile(join(stage, "SOURCE-STAGING.json"), JSON.stringify({
  result: "UNVERIFIED_SOURCE_STAGING_ONLY", sourceHash: source.sourceHash, files: manifest,
  scope: "Actual package file selection, not a gated release. Existing release evidence is copied unchanged and does not attest this source.",
}, null, 2));
const archive = join(work, "unverified-source-staging.tar.gz");
for (const args of [["-czf", archive, "-C", stage, "."], ["-xzf", archive, "-C", extracted]]) {
  const result = spawnSync("tar", args, { encoding: "utf8", windowsHide: true, timeout: 120000 });
  assert.equal(result.status, 0, result.stderr);
}
for (const file of manifest)
  assert.equal(hash(await readFile(join(extracted, file.path))), file.sha256, file.path);
for (const file of ["index.html", "public/favicon.svg"])
  assert.ok(manifest.some(({ path }) => path === file));

// Supply dependencies only after extraction. Reuse the existing same-machine
// installations; no npm install, network/dependency changes or independent-host claim.
for (const prefix of ["", "apps/dashboard"]) {
  const dependencies = join(root, prefix, "node_modules");
  assert.ok((await stat(dependencies)).isDirectory());
  await symlink(dependencies, join(extracted, prefix, "node_modules"), process.platform === "win32" ? "junction" : "dir");
}
const build = spawnSync(process.platform === "win32" ? "cmd.exe" : "npm",
  process.platform === "win32" ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"],
  { cwd: extracted, encoding: "utf8", windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
await writeFile(join(work, "build.log"), build.stdout + build.stderr);
assert.equal(build.status, 0, build.stdout + build.stderr);
assert.ok((await stat(join(extracted, "dist/index.html"))).isFile());
assert.equal(hash(await readFile(join(extracted, "dist/favicon.svg"))), hash(await readFile(join(root, "public/favicon.svg"))));
assert.equal((await sourceManifest()).sourceHash, source.sourceHash, "Source must remain stable during staging/build");
const report = {
  result: "PASS_FOCUSED_STAGED_EXTRACTION_BUILD", sourceHash: source.sourceHash,
  work, archive, archiveSha256: hash(await readFile(archive)), files: manifest.length,
  inventoryVerified: true, extractedBuild: "npm run build", buildExit: build.status,
  dependencies: "Same-machine root and dashboard node_modules junctions supplied after extraction; no installs/updates",
  scope: "Not a gated release archive or independent clean-machine validation. Final matching-source release/package extraction remains root-owned.",
};
await writeFile(join(work, "result.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
