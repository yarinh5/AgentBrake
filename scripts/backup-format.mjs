import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { SNAPSHOT_MAX_BYTES } from "../infra/product/volume-archive.mjs";
const MAGIC = Buffer.from("AGENTBRAKE-BACKUP-1\n");
export const BACKUP_MAX_BYTES = SNAPSHOT_MAX_BYTES;
const checkKey = (key) => {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw Error("Recovery key must be 32 bytes");
};
export function encryptBackup(value, key) {
  checkKey(key);
  const plaintext = Buffer.from(JSON.stringify(value));
  if (plaintext.length > BACKUP_MAX_BYTES - 128) throw Error("Backup size limit exceeded");
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  plaintext.fill(0);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), encrypted]);
}
export function decryptBackup(bytes, key) {
  checkKey(key);
  if (bytes.length > BACKUP_MAX_BYTES) throw Error("Backup size limit exceeded");
  if (
    bytes.length < MAGIC.length + 30 ||
    !bytes.subarray(0, MAGIC.length).equals(MAGIC)
  )
    throw Error("Invalid backup envelope");
  let plaintext;
  try {
    const offset = MAGIC.length;
    const cipher = createDecipheriv(
      "aes-256-gcm",
      key,
      bytes.subarray(offset, offset + 12),
    );
    cipher.setAAD(MAGIC);
    cipher.setAuthTag(bytes.subarray(offset + 12, offset + 28));
    plaintext = Buffer.concat([
      cipher.update(bytes.subarray(offset + 28)),
      cipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw Error("Backup authentication failed");
  } finally {
    plaintext?.fill(0);
  }
}
