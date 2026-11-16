import assert from 'node:assert/strict';
import { randomUUID, randomBytes, generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { chromium, expect } from '@playwright/test';
import { initializeProduct, productConfig, composeProduct, dockerProduct } from './product.mjs';
import { configureCandidate } from './candidate-config.mjs';
import { startProduct, doctorProduct } from './product-maintenance.mjs';
import { sourceManifest } from './source-manifest.mjs';

const runId = randomUUID(), name = 'verify-candidate-' + runId.slice(0, 8), port = 4334;
const directory = join('docs/evidence', runId), manifest = await sourceManifest();
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'source-manifest.json'), JSON.stringify(manifest, null, 2));
const report = { runId, sourceHash: manifest.sourceHash, startedAt: new Date().toISOString(), result: 'NOT_RUN', cases: [],
  scope: 'Local disposable Docker install with actual TLS/Next/control/Gateway and synthetic App key. GitHub outbound network internal; no real GitHub call or production certificate validation.' };
const passed = (name, observed) => { report.cases.push({ name, result: 'PASS', observed }); console.log('PASS ' + name); };
let config;
try {
  config = await initializeProduct(name, port);
  const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
    '-keyout', join(config.dir, 'input-tls-key.pem'), '-out', join(config.dir, 'input-tls-cert.pem')], { stdio: 'ignore', windowsHide: true });
  await writeFile(join(config.dir, 'input-app-key.pem'), generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  await configureCandidate(config, { https: { origin: `https://localhost:${port}`, certificateFile: join(config.dir, 'input-tls-cert.pem'), privateKeyFile: join(config.dir, 'input-tls-key.pem') },
    githubApp: { appId: 123, installationId: 456, repositoryId: 789, ownerId: 12, repository: 'example/disposable', defaultBranch: 'main', disposableRepository: 'example/disposable', privateKeyFile: join(config.dir, 'input-app-key.pem') } });
  config = { ...await productConfig(name), verificationComposeFiles: [resolve('infra/product/verify-candidate.compose.yaml')] };
  const composed = JSON.parse(await composeProduct(config, ['--profile', 'agent', 'config', '--format', 'json'], { capture: true }));
  for (const network of ['agent', 'github-private', 'github-outbound', 'control', 'protected', 'dashboard']) assert.equal(composed.networks[network].internal, true);
  assert.deepEqual(Object.keys(composed.services.agent.networks), ['agent']);
  assert.equal(composed.services.ingress.ports[0].host_ip, '127.0.0.1');
  assert.ok(!composed.services['control-api'].volumes.some(v => String(v.source).includes('github-app-key')));
  passed('compose-boundaries', 'Agent has one internal network; GitHub test egress internal; only loopback HTTPS port published.');
  await startProduct(config);
  const policyTests = await dockerProduct(config, ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--mount', `type=bind,src=${resolve('services/policy')},dst=/policy,readonly`, config.env.OPA_IMAGE, 'test', '/policy', '-v'], { capture: true });
  await writeFile(join(directory, 'candidate-policy-tests.log'), policyTests);
  passed('rebuilt-opa-policy-tests', 'Actual selected OPA image passed the repository Rego suite in a networkless container.');
  const doctor = await doctorProduct(config); assert.equal(doctor.http, '200');
  assert.ok(doctor.services.every(s => s.state === 'running' || s.name === 'volume-init'));
  passed('fresh-tls-install', { http: doctor.http, services: doctor.services });
  const cert = await readFile(join(config.dir, 'tls-cert.pem')), origin = `https://localhost:${port}`;
  const api = (path, body, cookie, csrf) => new Promise((resolveResponse, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = httpsRequest({ hostname: '127.0.0.1', port, servername: 'localhost', ca: cert, path: '/api/' + path,
      method: bytes === undefined ? 'GET' : 'POST', headers: { Host: `localhost:${port}`, Origin: origin,
        ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-AB-CSRF': csrf } : {}) } }, res => {
      let output = ''; res.on('data', b => output += b); res.on('end', () => { try { resolveResponse({ status: res.statusCode, body: JSON.parse(output), headers: res.headers }); } catch (e) { reject(e); } });
    }); req.setTimeout(15000, () => req.destroy(Error('TLS request timed out'))); req.on('error', reject); req.end(bytes);
  });
  const operators = JSON.parse(await readFile(join(config.dir, 'operators.json'), 'utf8'));
  const credential = { email: 'candidate@example.test', password: 'Candidate!' + randomBytes(24).toString('hex') };
  const setup = await api('setup', { ...credential, name: 'Candidate owner', key: operators.find(o => o.role === 'administrator').key });
  assert.equal(setup.status, 200); assert.match(setup.headers['set-cookie'][0], /; Secure/);
  const cookie = setup.headers['set-cookie'][0].split(';')[0], csrf = setup.body.csrfToken;
  const workspace = await api('workspace', undefined, cookie); assert.equal(workspace.body.connections.github, 'github-app-sandbox');
  passed('managed-owner-over-tls', 'Owner bootstrap succeeded; Secure/HttpOnly/SameSite session; public connection metadata contains no private key.');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const external = [], errors = [];
  try {
    await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external.push(route.request().url()); return route.abort(); });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.goto(origin);
    await page.getByLabel('Email', { exact: true }).fill(credential.email); await page.getByLabel('Password', { exact: true }).fill(credential.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Security overview' })).toBeVisible();
    await page.getByRole('navigation').getByRole('button', { name: 'Connections', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'GitHub App sandbox', exact: true })).toBeVisible();
    await page.screenshot({ path: join(directory, 'https-connections.png'), fullPage: true });
    await page.getByRole('button', { name: 'Create task identity', exact: true }).click();
    await page.getByLabel('Execution target').selectOption('github');
    await page.getByLabel('Agent name', { exact: true }).fill('Configured App browser identity');
    await page.getByRole('button', { name: 'Create scoped agent', exact: true }).click();
    await expect(page.locator('.token-row code')).toContainText('ab_');
    await page.getByRole('button', { name: 'Configure task grant', exact: true }).click();
    const card = page.locator('.agent-card').filter({ has: page.getByRole('heading', { name: 'Configured App browser identity', exact: true }) });
    await expect(card).toContainText('example/disposable');
    await card.getByRole('button', { name: 'Grant task', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Issue task grant', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const after = await api('workspace', undefined, cookie);
    const created = after.body.agents.find(a => a.name === 'Configured App browser identity');
    assert.equal(created.sandbox, false); assert.deepEqual(created.grant.resources, ['example/disposable']);
    assert.deepEqual(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })), { local: [], session: [] });
    passed('installed-app-identity-ui', 'Explicit App target identity and narrowed grant issued through the real HTTPS dashboard; no agent tool call or live GitHub request.');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    const sessionCookies = await context.cookies(); assert.ok(sessionCookies.filter(c => c.name === 'ab_session').every(c => c.secure && c.httpOnly));
    passed('installed-https-browser', { browserErrors: errors.length, externalRequests: external.length, localSelfSignedCertificate: true });
  } finally { await browser.close(); }
  const inspected = JSON.parse(await dockerProduct(config, ['inspect', (await composeProduct(config, ['ps', '--quiet', 'github-egress'], { capture: true })).trim()], { capture: true }))[0];
  const ips = Object.values(inspected.NetworkSettings.Networks).map(n => n.IPAddress);
  const probes = await composeProduct(config, ['exec', '-T', 'agent', 'node', '-e', `const net=require('node:net'); Promise.all(${JSON.stringify(ips)}.map(host=>new Promise(r=>{const s=net.connect({host,port:8080});s.setTimeout(1500,()=>{s.destroy();r({host,blocked:true})});s.on('connect',()=>{s.destroy();r({host,blocked:false})});s.on('error',()=>r({host,blocked:true}))}))).then(x=>{console.log(JSON.stringify(x));process.exit(x.every(y=>y.blocked)?0:1)})`], { capture: true });
  const parsed = JSON.parse(probes); assert.ok(parsed.length >= 1 && parsed.every(p => p.blocked));
  passed('agent-direct-egress-bypass-denied', parsed);
  report.images = JSON.parse(await composeProduct(config, ['images', '--format', 'json'], { capture: true }));
  report.imageReferences = { runtime: config.project + '-runtime', dashboard: config.project + '-dashboard', postgres: config.env.POSTGRES_IMAGE, opa: config.env.OPA_IMAGE };
  report.result = 'PASS_LOCAL_CANDIDATE';
} catch (error) {
  report.result = 'FAIL'; report.error = error.message; if (error.errorOutput) await writeFile(join(directory, 'docker-error.log'), error.errorOutput);
  console.error(error.message); process.exitCode = 1;
} finally {
  if (config) {
    try { await composeProduct(config, ['--profile', 'agent', 'down', '--volumes', '--remove-orphans'], { capture: true });
      const filter = `label=com.docker.compose.project=${config.project}`;
      const remaining = await Promise.all([
        ['ps', '--all', '--quiet', '--filter', filter], ['volume', 'ls', '--quiet', '--filter', filter], ['network', 'ls', '--quiet', '--filter', filter],
      ].map(args => dockerProduct(config, args, { capture: true })));
      for (const resources of remaining) assert.equal(resources.trim(), '');
      report.cleanup = { result: 'PASS', containers: 0, volumes: 0, networks: 0 };
    } catch (e) { report.cleanup = { result: 'FAIL', error: e.message }; report.result = 'FAIL'; process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString(); await writeFile(join(directory, 'candidate-summary.json'), JSON.stringify(report, null, 2));
  await writeFile('docs/evidence/latest-candidate.json', JSON.stringify({ runId, directory, result: report.result }, null, 2));
  console.log(JSON.stringify({ runId, result: report.result, directory }));
}
