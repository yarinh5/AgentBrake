import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import { z } from 'zod';
const id = z.number().int().positive().safe();
const repository = z.string().max(120).regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/);
const origin = z.string().refine(value => { try { const u = new URL(value); return u.protocol === 'https:' && u.origin === value && !u.username && !u.password; } catch { return false; } });
const publicApp = z.object({ appId: id, installationId: id, repositoryId: id, ownerId: id, repository, defaultBranch: z.literal('main') }).strict();
const file = z.string().refine(isAbsolute);
const inputSchema = z.object({
  https: z.object({ origin, certificateFile: file, privateKeyFile: file }).strict().optional(),
  githubApp: publicApp.extend({ privateKeyFile: file, disposableRepository: repository }).optional(),
}).strict().refine(input => input.https || input.githubApp);
const manifest = z.object({ schema: z.literal(1), installationId: z.string().uuid(), httpsOrigin: origin.optional(), github: z.boolean() }).strict();
async function boundedFile(path, max = 32000) {
  const info = await stat(path); if (!info.isFile() || info.size > max) throw Error('Invalid candidate credential file size');
  return readFile(path);
}
export async function loadCandidate(config) {
  let data;
  try { data = await readFile(join(config.dir, 'candidate.json'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  const result = manifest.parse(JSON.parse(data));
  if (result.installationId !== config.id || config.name === 'local') throw Error('Candidate configuration does not match this dedicated installation');
  if (result.github) publicApp.parse(JSON.parse(await readFile(join(config.dir, 'github-app.json'), 'utf8')));
  return result;
}
export async function configureCandidate(config, input) {
  if (config.name === 'local') throw Error('Use a separate candidate installation, preserving product-local');
  const owner = JSON.parse(await readFile(join(config.dir, 'installation.json'), 'utf8'));
  if (owner.name !== config.name || owner.id !== config.id) throw Error('Installation identity mismatch');
  if (await loadCandidate(config)) throw Error('Candidate is already configured; do not replace authority in place');
  const parsed = inputSchema.safeParse(input); if (!parsed.success) throw Error('Invalid candidate configuration');
  const value = parsed.data, files = [];
  if (value.https) {
    const cert = await boundedFile(value.https.certificateFile, 64000), key = await boundedFile(value.https.privateKeyFile);
    const x509 = new X509Certificate(cert), privateKey = createPrivateKey(key), url = new URL(value.https.origin);
    if (!x509.checkHost(url.hostname) || Date.parse(x509.validTo) <= Date.now() || Date.parse(x509.validFrom) > Date.now() ||
        !x509.publicKey.equals(createPublicKey(privateKey))) throw Error('TLS certificate hostname, validity or key mismatch');
    files.push(['tls-cert.pem', cert], ['tls-key.pem', key]);
  }
  if (value.githubApp) {
    const { privateKeyFile, disposableRepository, ...app } = value.githubApp;
    if (disposableRepository !== app.repository) throw Error('Explicit disposable repository acknowledgment must match the pinned target');
    const key = await boundedFile(privateKeyFile), parsedKey = createPrivateKey(key);
    if (parsedKey.asymmetricKeyType !== 'rsa' || (parsedKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw Error('GitHub App requires an RSA key of at least 2048 bits');
    files.push(['github-app.json', JSON.stringify(app, null, 2)], ['github-app-key.pem', key]);
  }
  // Exclusive writes; metadata is last, so partial preparation cannot enable a connection.
  for (const [name, data] of files) await writeFile(join(config.dir, name), data, { flag: 'wx', mode: 0o600 });
  const result = { schema: 1, installationId: config.id, ...(value.https ? { httpsOrigin: value.https.origin } : {}), github: !!value.githubApp };
  await writeFile(join(config.dir, 'candidate.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  return result;
}
