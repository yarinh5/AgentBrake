import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { root } from "./opa-runtime.mjs";
export async function sourceManifest() {
  const files = [];
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  async function walk(path) {
    const entries = await readdir(path, { withFileTypes: true }).catch(
      () => null,
    );
    if (entries) {
      for (const entry of entries)
        if (
          ![
            "node_modules",
            ".next",
            "test-results",
            "playwright-report",
          ].includes(entry.name) &&
          !entry.name.endsWith(".tsbuildinfo")
        )
          await walk(join(path, entry.name));
    } else
      files.push({
        path: relative(root, path).replaceAll("\\", "/"),
        sha256: hash(await readFile(path)),
      });
  }
  for (const location of [
    "server",
    ".github",
    "src",
    "apps/dashboard",
    "services",
    "infra",
    "scripts",
    "tests",
    "docs/specification",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
    "playwright.config.ts",
    ".dockerignore",
    "index.html",
    "public",
  ])
    await walk(join(root, location));
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { sourceHash: hash(JSON.stringify(files)), files };
}
