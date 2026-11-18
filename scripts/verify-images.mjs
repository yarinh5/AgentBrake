import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sourceManifest } from './source-manifest.mjs';
import { dockerProduct } from './product.mjs';
import { verifyImageBinding } from './image-evidence.mjs';
const runId = randomUUID(), root = resolve('.'), directory = join(root, 'docs/evidence', runId), cache = join(root, '.agentbrake-local/trivy-cache');
await mkdir(directory, { recursive: true });
const pointer = JSON.parse(await readFile('docs/evidence/latest-candidate.json', 'utf8'));
const candidate = JSON.parse(await readFile(join(pointer.directory, 'candidate-summary.json'), 'utf8'));
const source = await sourceManifest();
if (!/^[a-f0-9-]{36}$/.test(candidate.runId) || candidate.result !== 'PASS_LOCAL_CANDIDATE') throw Error('A successful candidate image build is required');
const scanner = JSON.parse(await readFile('infra/security/trivy.lock.json', 'utf8'));
const images = JSON.parse(await readFile('infra/local/images.lock.json', 'utf8')).images;
const project = 'agentbrake-product-verify-candidate-' + candidate.runId.slice(0, 8);
const config = { env: { ...process.env } };
const report = { runId, sourceHash: candidate.sourceHash, currentSourceHash: source.sourceHash, startedAt: new Date().toISOString(), scanner, result: 'NOT_RUN', images: [],
  scope: 'Offline Trivy vulnerability scan of locally exported images. Database downloaded separately; no source or image uploaded. Unfixed findings included; no blanket suppression.' };
const scratch = join(root, '.agentbrake-local/image-scans', runId); await mkdir(scratch, { recursive: true });
try {
  report.database = JSON.parse(await readFile(join(cache, 'db/metadata.json'), 'utf8'));
  if (Date.now() - Date.parse(report.database.UpdatedAt) > 48 * 3600000) throw Error('Trivy vulnerability database is older than 48 hours');
  for (const [name, reference] of Object.entries(candidate.imageReferences ?? { runtime: project + '-runtime', dashboard: project + '-dashboard', postgres: images.postgres.image, opa: images.opa.image })) {
    const archive = join(scratch, name + '.tar');
    const image = JSON.parse(await dockerProduct(config, ['image', 'inspect', reference], { capture: true }))[0];
    verifyImageBinding(candidate, name, image.Id);
    await dockerProduct(config, ['image', 'save', '--output', archive, image.Id], { capture: true });
    try {
      await dockerProduct(config, ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--memory', '2g', '--pids-limit', '64', '--tmpfs', '/tmp:size=512m',
        // Linux bind mounts preserve the operator's ownership. Match it so the
        // capability-free scanner can read its private cache and write reports.
        ...(process.platform === 'linux' ? ['--user', `${process.getuid()}:${process.getgid()}`] : []), '--env', 'HOME=/tmp',
        '--mount', `type=bind,src=${cache},dst=/cache`, '--mount', `type=bind,src=${scratch},dst=/images,readonly`, '--mount', `type=bind,src=${directory},dst=/output`,
        scanner.image, 'image', '--cache-dir', '/cache', '--skip-db-update', '--skip-java-db-update', '--offline-scan', '--scanners', 'vuln', '--no-progress', '--format', 'json', '--output', `/output/${name}.json`, '--input', `/images/${name}.tar`], { capture: true, timeoutMs: 300000 });
      const results = JSON.parse(await readFile(join(directory, name + '.json'), 'utf8'));
      const findings = (results.Results ?? []).flatMap(r => (r.Vulnerabilities ?? []).map(v => ({ target: r.Target, type: r.Type, id: v.VulnerabilityID, package: v.PkgName,
        installed: v.InstalledVersion, fixed: v.FixedVersion ?? null, severity: v.Severity, url: v.PrimaryURL })));
      report.images.push({ name, imageId: image.Id, reference, total: findings.length, highCritical: findings.filter(f => ['HIGH', 'CRITICAL'].includes(f.severity)) });
      console.log(name + ': ' + findings.length + ' findings, ' + report.images.at(-1).highCritical.length + ' high/critical');
    } finally { await rm(archive, { force: true }); }
  }
  report.result = report.images.some(i => i.highCritical.length) ? 'BLOCKED_VULNERABILITIES' : 'PASS_IMAGE_SCAN';
  if (report.result !== 'PASS_IMAGE_SCAN') process.exitCode = 2;
} catch (e) { report.result = 'FAIL'; report.error = e.message; process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(join(directory, 'container-scan.json'), JSON.stringify(report, null, 2));
  await writeFile('docs/evidence/container-scan.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify({ result: report.result, runId })); }
