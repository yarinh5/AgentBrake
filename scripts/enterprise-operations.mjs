import { open, lstat, realpath, opendir, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, parse, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, X509Certificate } from 'node:crypto';
import { decryptBackup, BACKUP_MAX_BYTES } from './backup-format.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
// Reject links in every component, including Windows junctions. The parent must
// remain controlled by the operator; Node has no portable openat directory API.
export async function checkedPath(input, directory = false) {
  if (typeof input !== 'string' || !input || input.includes('\0')) throw Error('Invalid file path');
  const absolute = resolve(input), root = parse(absolute).root;
  let current = root;
  const parts = absolute.slice(root.length).split(/[\\/]/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw Error('Symbolic link or junction refused');
    if ((i < parts.length - 1 || directory) && !info.isDirectory()) throw Error('Expected directory');
  }
  if (resolve(await realpath(absolute)).toLowerCase() !== absolute.toLowerCase()) throw Error('Noncanonical path refused');
  return absolute;
}
export async function readSafeFile(input, limit = BACKUP_MAX_BYTES) {
  const file = await checkedPath(input);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > limit) throw Error('Invalid file type, link count or size limit');
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw Error('File changed during read');
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw Error('File changed during read');
    return bytes;
  } finally { await handle.close(); }
}
export async function writeExclusiveFile(file, bytes) {
  const absolute = resolve(file), parent = parse(absolute).dir;
  await checkedPath(parent, true);
  const info = await lstat(parent);
  if (process.platform !== 'win32' && (info.mode & 0o022)) throw Error('Destination directory must not be writable by group or others');
  const handle = await open(absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  return absolute;
}
async function authenticatedBackup(bytes, keyFile) {
  const key = await readSafeFile(keyFile, 32);
  let value;
  try { value = decryptBackup(bytes, key); } finally { key.fill(0); }
  // Custody validation only. Full restore validates configuration and snapshots
  // through product-maintenance.inspectBackup before provisioning resources.
  if (value?.format !== 'agentbrake-cold-backup' || value.schema !== 1 ||
      !/^[a-f0-9-]{36}$/.test(value.id) || !Number.isFinite(Date.parse(value.createdAt))) throw Error('Unsupported backup metadata');
  return { backupId: value.id, createdAt: value.createdAt };
}
export async function verifyEncryptedBackup({ file, keyFile, expectedSha256 }) {
  if (!hex(expectedSha256)) throw Error('Expected SHA-256 checksum required');
  const bytes = await readSafeFile(file);
  if (hash(bytes) !== expectedSha256) throw Error('Backup checksum mismatch');
  const metadata = await authenticatedBackup(bytes, keyFile);
  return { schema: 1, file: resolve(file), sha256: expectedSha256, bytes: bytes.length, ...metadata, verified: true, verifiedAt: new Date().toISOString() };
}
export async function copyEncryptedBackup({ sourceFile, keyFile, destinationDirectory }) {
  const directory = await checkedPath(destinationDirectory, true);
  const bytes = await readSafeFile(sourceFile);
  await authenticatedBackup(bytes, keyFile);
  if (!basename(sourceFile).endsWith('.abk')) throw Error('Encrypted backup must use .abk extension');
  const file = join(directory, basename(sourceFile));
  await writeExclusiveFile(file, bytes);
  // Reopen the actual destination and authenticate after its data is flushed.
  // On any failure retain the unverified artifact for explicit diagnosis; no overwrite retry.
  return verifyEncryptedBackup({ file, keyFile, expectedSha256: hash(bytes) });
}
export async function previewRetention({ directory, keep = 7, maxEntries = 1000 }) {
  if (!Number.isInteger(keep) || keep < 1 || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10000) throw Error('Invalid retention bounds');
  const path = await checkedPath(directory, true), entries = [], dir = await opendir(path);
  let count = 0;
  for await (const entry of dir) {
    if (++count > maxEntries) throw Error('Retention entry limit exceeded');
    if (!entry.name.endsWith('.abk')) continue;
    const info = await lstat(join(path, entry.name));
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) throw Error('Unsafe backup entry');
    entries.push({ name: entry.name, modifiedAt: info.mtime.toISOString(), bytes: info.size });
  }
  entries.sort((a,b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.name.localeCompare(b.name));
  return { schema: 1, previewOnly: true, basis: 'filesystem modification time; not recovery assurance', keep: entries.slice(0,keep), candidates: entries.slice(keep) };
}
function boundedNumber(value, fallback, minimum, maximum) {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < minimum || result > maximum) throw Error('Invalid health threshold');
  return result;
}
export async function collectHealth(options = {}) {
  const { healthUrl, diskPath, certificateFile, backupFile, keyFile, allowLoopbackHttp = false } = options;
  const timeoutMs = boundedNumber(options.timeoutMs,5000,1,60000), minFreeBytes = boundedNumber(options.minFreeBytes,1024**3,0,Number.MAX_SAFE_INTEGER),
    maxBackupAgeMs = boundedNumber(options.maxBackupAgeMs,86400000,0,Number.MAX_SAFE_INTEGER), warningDays = boundedNumber(options.certificateWarningDays,30,0,3650);
  let url;
  if (healthUrl) {
    url = new URL(healthUrl);
    if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(allowLoopbackHttp && url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw Error('Health endpoint requires HTTPS (explicit loopback HTTP test option only)');
  }
  const unknown = reason => ({status:'UNKNOWN', reason});
  const checks = {availability:unknown('endpoint not configured'),disk:unknown('disk path not configured'),certificate:unknown('certificate file not configured'),backup:unknown('backup and recovery key not configured')};
  await Promise.all([
    (async()=>{ if(!url)return; try { const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(timeoutMs)}); await response.body?.cancel(); checks.availability={status:response.status===200?'OK':'CRITICAL',httpStatus:response.status}; } catch {checks.availability={status:'CRITICAL',reason:'endpoint unavailable or TLS/request validation failed'};} })(),
    (async()=>{ if(!diskPath)return; try {const disk=await statfs(await checkedPath(diskPath,true),{bigint:true}), free=disk.bavail*disk.bsize;checks.disk={status:free<BigInt(Math.ceil(minFreeBytes))?'CRITICAL':'OK',availableBytes:free.toString(),minimumBytes:minFreeBytes};}catch {checks.disk=unknown('disk measurement failed');} })(),
    (async()=>{ if(!certificateFile)return;try {const cert=new X509Certificate(await readSafeFile(certificateFile,1024*1024)), remaining=Date.parse(cert.validTo)-Date.now(); checks.certificate={status:remaining<=0||Date.parse(cert.validFrom)>Date.now()?'CRITICAL':remaining<=warningDays*86400000?'WARNING':'OK',expiresAt:new Date(cert.validTo).toISOString(),evidence:'configured certificate file validity only'};}catch{checks.certificate=unknown('certificate evidence unreadable or invalid');} })(),
    (async()=>{ if(!backupFile||!keyFile)return;try {const metadata=await authenticatedBackup(await readSafeFile(backupFile),keyFile),age=Date.now()-Date.parse(metadata.createdAt);checks.backup={status:age<0||age>maxBackupAgeMs?'CRITICAL':'OK',createdAt:metadata.createdAt,ageMs:age,evidence:'authenticated backup envelope; restore acceptance separate'};}catch{checks.backup={status:'CRITICAL',reason:'backup authentication or evidence read failed'};} })(),
  ]);
  const states=Object.values(checks).map(c=>c.status), status=['CRITICAL','UNKNOWN','WARNING','OK'].find(s=>states.includes(s));
  return {schema:1,checkedAt:new Date().toISOString(),status,checks};
}
export function systemdTemplates({ nodePath, workspacePath, configFile, user, intervalMinutes = 15 }) {
  // Strict Linux path subset avoids systemd quoting, specifier and environment expansion.
  for(const path of [nodePath,workspacePath,configFile]) if(typeof path!=='string'||!/^\/[A-Za-z0-9_./-]+$/.test(path)||path.split('/').includes('..')) throw Error('Invalid systemd absolute path');
  if(!/^[a-z_][a-z0-9_-]{0,31}$/.test(user)||user==='root'||!Number.isInteger(intervalMinutes)||intervalMinutes<1||intervalMinutes>1440) throw Error('Invalid systemd user or interval');
  return {
    service:`[Unit]\nDescription=AgentBrake enterprise health evidence\nAfter=network-online.target\n\n[Service]\nType=oneshot\nUser=${user}\nWorkingDirectory=${workspacePath}\nExecStart=${nodePath} ${workspacePath}/scripts/enterprise-operations.mjs health ${configFile}\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=read-only\nUMask=0077\nTimeoutStartSec=90\n`,
    timer:`[Unit]\nDescription=AgentBrake periodic health evidence\n\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=${intervalMinutes}min\nUnit=agentbrake-health.service\n\n[Install]\nWantedBy=timers.target\n`,
    installed:false,
  };
}
if(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, configFile] = process.argv.slice(2), actions={copy:copyEncryptedBackup,verify:verifyEncryptedBackup,retention:previewRetention,health:collectHealth,templates:systemdTemplates};
    if(!Object.hasOwn(actions,command)||!configFile||process.argv.length!==4) throw Error('Usage: enterprise-operations.mjs <copy|verify|retention|health|templates> <config.json>');
    const result=await actions[command](JSON.parse((await readSafeFile(configFile,65536)).toString('utf8')));
    console.log(JSON.stringify(result,null,2)); if(command==='health'&&result.status!=='OK') process.exitCode=2;
  } catch { console.error('Enterprise operations failed; check command/configuration, file integrity and private directory permissions.');process.exitCode=1; }
}
