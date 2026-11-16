import { readFile, mkdir, writeFile, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const config = JSON.parse(
  await readFile(new URL("services/policy/toolchain.json", root), "utf8"),
);
const asset = config.assets[`${process.platform}-${process.arch}`];
if (!asset)
  throw new Error(
    "No verified OPA asset configured for this platform. Add a reviewed checksum first.",
  );
const target = new URL(
  `.tools/${process.platform === "win32" ? "opa.exe" : "opa"}`,
  root,
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
let bytes;
try {
  bytes = await readFile(target);
} catch {}
if (!bytes || hash(bytes) !== asset.sha256) {
  const response = await fetch(
    `https://github.com/open-policy-agent/opa/releases/download/v${config.version}/${asset.name}`,
    { signal: AbortSignal.timeout(120000) },
  );
  if (!response.ok)
    throw new Error(`OPA asset download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== asset.sha256)
    throw new Error("OPA checksum mismatch; refusing to install");
  await mkdir(new URL(".tools/", root), { recursive: true });
  await writeFile(target, bytes);
  if (process.platform !== "win32") await chmod(target, 0o700);
}
console.log(
  `OPA ${config.version} verified: ${asset.sha256}; local binary ${fileURLToPath(target)}`,
);
