// Cold local-volume snapshots only. Never follow symlinks or restore over data.
import {
  readdir,
  lstat,
  readFile,
  mkdir,
  writeFile,
  chmod,
  realpath,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
const LIMIT = 256 * 1024 * 1024,
  MAX_ENTRIES = 10000;
// Shared with the Docker transport and encrypted package ceiling. The whole
// package (including config and other volumes) must also fit this bound.
export const SNAPSHOT_MAX_BYTES = 64 * 1024 * 1024;
const safePath = (path) =>
  typeof path === "string" &&
  path.length <= 1000 &&
  path
    .split("/")
    .every((p) => p && p !== "." && p !== ".." && !/[\\:\x00-\x1f]/.test(p));
export function validateSnapshot(encoded) {
  if (
    typeof encoded !== "string" ||
    encoded.length > SNAPSHOT_MAX_BYTES ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw Error("Invalid volume snapshot");
  let entries;
  try {
    entries = JSON.parse(
      gunzipSync(Buffer.from(encoded, "base64"), {
        maxOutputLength: 384 * 1024 * 1024,
      }).toString("utf8"),
    );
  } catch {
    throw Error("Invalid volume snapshot");
  }
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES)
    throw Error("Invalid volume entries");
  const paths = new Set(),
    dirs = new Set();
  let size = 0;
  for (const item of entries) {
    if (
      !item ||
      !safePath(item.path) ||
      paths.has(item.path) ||
      !["file", "directory"].includes(item.type) ||
      !Number.isInteger(item.mode) ||
      item.mode < 0 ||
      item.mode > 0o777
    )
      throw Error("Unsafe volume entry");
    const parent = item.path.split("/").slice(0, -1).join("/");
    if (parent && !dirs.has(parent))
      throw Error("Volume parent must precede child");
    if (item.type === "directory") {
      if (item.data !== undefined) throw Error("Invalid directory data");
      dirs.add(item.path);
    } else {
      if (
        typeof item.data !== "string" ||
        /[^A-Za-z0-9+/=]/.test(item.data) ||
        Buffer.from(item.data, "base64").toString("base64") !== item.data
      )
        throw Error("Invalid volume data");
      size += Buffer.byteLength(item.data, "base64");
      if (size > LIMIT) throw Error("Volume size limit exceeded");
    }
    paths.add(item.path);
  }
  return entries;
}
export async function snapshotVolume(directory) {
  if ((await lstat(directory)).isSymbolicLink())
    throw Error("Volume root must not be a symbolic link");
  const root = await realpath(directory),
    entries = [];
  let size = 0;
  async function walk(dir) {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name),
        info = await lstat(path),
        key = relative(root, path).split(sep).join("/");
      if (
        !safePath(key) ||
        info.isSymbolicLink() ||
        (!info.isFile() && !info.isDirectory())
      )
        throw Error("Unsupported volume entry");
      if (entries.length >= MAX_ENTRIES)
        throw Error("Volume entry limit exceeded");
      if (info.isDirectory()) {
        entries.push({ path: key, type: "directory", mode: info.mode & 0o777 });
        await walk(path);
      } else {
        size += info.size;
        if (size > LIMIT) throw Error("Volume size limit exceeded");
        entries.push({
          path: key,
          type: "file",
          mode: info.mode & 0o777,
          data: (await readFile(path)).toString("base64"),
        });
      }
    }
  }
  await walk(root);
  const encoded = gzipSync(JSON.stringify(entries)).toString("base64");
  if (encoded.length > SNAPSHOT_MAX_BYTES)
    throw Error("Volume snapshot size limit exceeded");
  return encoded;
}
export async function restoreVolume(directory, encoded) {
  const entries = validateSnapshot(encoded);
  if (
    (await lstat(directory)).isSymbolicLink() ||
    (await readdir(directory)).length
  )
    throw Error("Restore requires an empty real volume");
  const root = await realpath(directory);
  for (const item of entries) {
    const path = join(root, ...item.path.split("/"));
    if (!path.startsWith(root + sep))
      throw Error("Volume path escapes destination");
    if (item.type === "directory") await mkdir(path, { mode: item.mode });
    else
      await writeFile(path, Buffer.from(item.data, "base64"), {
        flag: "wx",
        mode: item.mode,
      });
    await chmod(path, item.mode);
  }
  return { restored: entries.length };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [operation, directory] = process.argv.slice(2);
    if (operation === "snapshot")
      process.stdout.write(await snapshotVolume(directory));
    else if (operation === "restore") {
      let input = "";
      for await (const chunk of process.stdin) {
        input += chunk;
        if (input.length > SNAPSHOT_MAX_BYTES)
          throw Error("Snapshot input limit exceeded");
      }
      process.stdout.write(
        JSON.stringify(await restoreVolume(directory, input)),
      );
    } else throw Error("Unknown volume operation");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
