import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import express from 'express';
import { spawnSync } from 'node:child_process';

test('the installed build dependency graph excludes the reproduced unpatched ReDoS dependency', async () => {
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  assert.equal(Object.keys(lock.packages).some(p => /(?:^|\/)node_modules\/picomatch$/.test(p)), false,
    'GHSA-fc5q-39xc-vjpf remains in the shipped build graph');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  // npm ls reports the installed graph, not only package.json intent.
  const graph = spawnSync(npm, ['ls', 'picomatch', '--json', '--all'], { encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true });
  assert.ok(graph.stdout && !JSON.stringify(JSON.parse(graph.stdout)).includes('"picomatch"'));
});

test('the actual React build emits reachable JS/CSS/favicon without injecting host environment', async () => {
  const module = await import('../../scripts/build-ui.mjs');
  const parent = join(process.cwd(), '.agentbrake-local');
  await mkdir(parent, { recursive: true });
  const outdir = await mkdtemp(join(parent, 'ui-build-test-'));
  const marker = 'agentbrake-build-private-marker-98765';
  process.env.VITE_PRIVATE_TEST = marker;
  try {
    await module.buildUi({ outdir });
    const html = await readFile(join(outdir, 'index.html'), 'utf8');
    assert.match(html, /src="\/assets\/app\.js"/);
    assert.match(html, /href="\/assets\/app\.css"/);
    assert.equal(html.includes('/src/main.tsx'), false);
    const js = await readFile(join(outdir, 'assets/app.js'), 'utf8');
    assert.ok(js.length > 1000);
    assert.ok((await readFile(join(outdir, 'assets/app.css'), 'utf8')).length > 1000);
    assert.equal((await readFile(join(outdir, 'favicon.svg'), 'utf8')).includes('<svg'), true);
    assert.equal(js.includes(marker), false);
    // Actual syntax validation, without executing the browser bundle on the host.
    const checked = spawnSync(process.execPath, ['--check', join(outdir, 'assets/app.js')], { encoding: 'utf8', windowsHide: true });
    assert.equal(checked.status, 0, checked.stderr);
  } finally { delete process.env.VITE_PRIVATE_TEST; }
});

test('development HTTP serves only compiled public assets, preserving API and file boundaries', async () => {
  const { developmentUi } = await import('../../scripts/build-ui.mjs');
  const ui = await developmentUi();
  const app = express();
  app.get('/api/check', (_req, res) => res.json({ marker: 'api-remains-separate' }));
  app.use(ui.middleware);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const [path, contentType] of [['/', 'text/html'], ['/assets/app.js', 'javascript'], ['/assets/app.css', 'text/css'], ['/favicon.svg', 'image/svg+xml']]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      assert.ok(response.headers.get('content-type').includes(contentType));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.ok((await response.text()).length > 40);
    }
    assert.deepEqual(await (await fetch(base + '/api/check')).json(), { marker: 'api-remains-separate' });
    for (const path of ['/api/unknown', '/server/index.ts', '/.env', '/package.json', '/src/main.tsx']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    assert.equal((await fetch(base + '/', { method: 'POST' })).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await ui.close();
  }
});

test('built and development bundles render the real application in Chromium without script errors', async () => {
  const { chromium } = await import('@playwright/test');
  const { createApp } = await import('../../server/app.ts');
  const { buildUi, developmentUi } = await import('../../scripts/build-ui.mjs');
  const parent = join(process.cwd(), '.agentbrake-local');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'ui-browser-test-'));
  await buildUi({ outdir: directory });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const built of [false, true]) {
      const system = createApp({ databasePath: ':memory:', adminKey: 'synthetic-ui-build-key-0123456789' });
      const ui = built ? null : await developmentUi();
      system.app.use(built ? express.static(directory) : ui.middleware);
      const server = system.app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'networkidle' });
        await page.locator('input').first().waitFor({ state: 'visible', timeout: 10000 });
        assert.ok((await page.locator('#root').innerText()).includes('AgentBrake'));
        assert.deepEqual(errors, []);
        assert.ok(await page.locator('link[rel="stylesheet"]').evaluateAll(links => links.every(link => Boolean(link.sheet))));
      } finally {
        await page.close(); server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await ui?.close(); await system.close();
      }
    }
  } finally { await browser.close(); }
});
