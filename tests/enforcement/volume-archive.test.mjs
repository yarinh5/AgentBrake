import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { gzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import { randomBytes } from 'node:crypto';
import { encryptBackup } from '../../scripts/backup-format.mjs';
import { inspectBackup } from '../../scripts/product-maintenance.mjs';
import {
  snapshotVolume,
  restoreVolume,
  validateSnapshot,
} from "../../infra/product/volume-archive.mjs";
await mkdir(resolve('.agentbrake-local'), { recursive: true, mode: 0o700 });
test("cold volume roundtrip preserves binary data and refuses nonempty restore", async () => {
  const dir = await mkdtemp(resolve(".agentbrake-local/archive-test-"));
  try {
    const source = join(dir, "source"),
      target = join(dir, "target");
    await mkdir(source);
    await mkdir(target);
    await mkdir(join(source, "nested"));
    const bytes = randomBytes(36 * 1024 * 1024);
    bytes[0] = 255;
    await writeFile(join(source, "nested", "data"), bytes);
    const encoded = await snapshotVolume(source);
    assert.ok(encoded.length > 48 * 1024 * 1024);
    assert.ok(encryptBackup({schema:1,volume:encoded},randomBytes(32)).length < 64 * 1024 * 1024);
    const key = randomBytes(32), keyFile = join(dir, "key"), backup = join(dir, "backup.abk");
    await writeFile(keyFile, key);
    const empty = gzipSync("[]").toString("base64");
    await writeFile(backup, encryptBackup({
      format: "agentbrake-cold-backup", schema: 1,
      id: "11111111-1111-4111-8111-111111111111",
      installation: { id: "22222222-2222-4222-8222-222222222222" },
      postgresImage: "synthetic-postgres",
      files: Object.fromEntries([
        "session-key", "binding-key", "bridge-key", "opa-token", "target-token",
        "observer-token", "control-password", "control-owner-password",
        "postgres-bootstrap", "target-read-password", "target-write-password", "operators.json",
      ].map((name) => [name, Buffer.from("synthetic").toString("base64")])),
      volumes: { "control-data": encoded, "target-data": empty, "git-data": empty },
    }, key));
    const inspected = await inspectBackup(backup, keyFile);
    assert.equal(inspected.volumes["control-data"], encoded);
    // Exercise the actual helper stdin path used by Docker, above the old 48MiB bound.
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["infra/product/volume-archive.mjs", "restore", target], { windowsHide: true });
      let output = "", errors = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { errors += chunk; });
      child.on("error", reject);
      child.stdin.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(JSON.parse(output)) : reject(Error(errors)));
      child.stdin.end(encoded);
    });
    assert.deepEqual(result, { restored: 2 });
    assert.deepEqual(await readFile(join(target, "nested", "data")), bytes);
    await assert.rejects(restoreVolume(target, encoded), /empty real volume/);
    for (const path of [
      "../escape",
      "/absolute",
      "x/../../escape",
      "C:/escape",
      "x\\escape",
    ]) {
      const bad = gzipSync(
        JSON.stringify([{ path, type: "file", mode: 384, data: "eA==" }]),
      ).toString("base64");
      assert.throws(() => validateSnapshot(bad), /Unsafe|parent/);
      await assert.rejects(restoreVolume(source, bad), /Unsafe|parent/);
    }
    const file = { path: "duplicate", type: "file", mode: 384, data: "eA==" };
    assert.throws(() => validateSnapshot(gzipSync(JSON.stringify([file, file])).toString("base64")), /Unsafe volume entry/);
    assert.throws(() => validateSnapshot(gzipSync(JSON.stringify([{ ...file, data: "eA=" }])).toString("base64")), /Invalid volume data/);
    assert.deepEqual((await readdir(dir)).sort(), ["backup.abk", "key", "source", "target"]);
  } finally {
    assert.equal(dirname(resolve(dir)), resolve(".agentbrake-local"));
    assert.match(basename(dir), /^archive-test-[a-zA-Z0-9]+$/);
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot writer refuses incompressible data above the shared package ceiling", async () => {
  const dir = await mkdtemp(resolve(".agentbrake-local/archive-test-"));
  try {
    await writeFile(join(dir, "data"), randomBytes(50 * 1024 * 1024));
    await assert.rejects(snapshotVolume(dir), /snapshot size limit/);
  } finally {
    assert.equal(dirname(resolve(dir)), resolve(".agentbrake-local"));
    assert.match(basename(dir), /^archive-test-[a-zA-Z0-9]+$/);
    await rm(dir, { recursive: true, force: true });
  }
});
