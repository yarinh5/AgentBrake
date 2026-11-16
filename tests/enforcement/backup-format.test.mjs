import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encryptBackup, decryptBackup } from "../../scripts/backup-format.mjs";

test("backup envelope authenticates metadata and payload without plaintext credentials", () => {
  const key = randomBytes(32);
  const value = {
    schema: 1,
    secret: "synthetic-password-not-for-output",
    snapshot: { count: 3 },
  };
  const encoded = encryptBackup(value, key);
  assert.equal(encoded.includes(Buffer.from(value.secret)), false);
  assert.deepEqual(decryptBackup(encoded, key), value);
  assert.throws(
    () => decryptBackup(encoded, randomBytes(32)),
    /Backup authentication failed/,
  );
  const modified = Buffer.from(encoded);
  modified[modified.length - 2] ^= 1;
  assert.throws(
    () => decryptBackup(modified, key),
    /Backup authentication failed/,
  );
  assert.throws(
    () => decryptBackup(encoded.subarray(0, 20), key),
    /Invalid backup envelope/,
  );
  assert.throws(() => encryptBackup(value, Buffer.alloc(16)), /32 bytes/);
});

test("backup encryption has fresh nonce and rejects oversized input before parsing", () => {
  const key = randomBytes(32),
    a = encryptBackup({ schema: 1 }, key),
    b = encryptBackup({ schema: 1 }, key);
  assert.notDeepEqual(a, b);
  assert.throws(
    () => decryptBackup(Buffer.alloc(64 * 1024 * 1024 + 1), key),
    /size limit/,
  );
});
