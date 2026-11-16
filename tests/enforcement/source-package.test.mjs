import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { sourceManifest } from "../../scripts/source-manifest.mjs";
import { packageFilePaths } from "../../scripts/package-inventory.mjs";
import { root } from "../../scripts/opa-runtime.mjs";

test("verified source and actual package inventory contain the root Vite entry and its public favicon", async () => {
  const source = await sourceManifest();
  const packaged = packageFilePaths(source);
  for (const path of ["index.html", "public/favicon.svg"]) {
    const file = source.files.find((file) => file.path === path);
    assert.ok(file, path + " is required by the packaged build");
    assert.ok(packaged.includes(path), path + " must survive package selection");
    assert.equal(file.sha256, createHash("sha256").update(await readFile(join(root, path))).digest("hex"));
  }
  assert.equal(packaged.some((path) => /(^|\/)(node_modules|\.agentbrake-local|\.env)(\/|$)/.test(path)), false);
});
