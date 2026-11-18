import { build, context } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function options(outdir, development = false) {
  return {
    absWorkingDir: root, entryPoints: { app: 'src/main.tsx' },
    outdir: join(outdir, 'assets'), bundle: true, format: 'esm', platform: 'browser',
    target: ['es2022'], jsx: 'automatic', minify: !development,
    define: { 'process.env.NODE_ENV': JSON.stringify(development ? 'development' : 'production') },
    write: false, logLevel: 'silent',
  };
}
async function page() {
  const template = await readFile(join(root, 'index.html'), 'utf8');
  if (!template.includes('src="/src/main.tsx"')) throw Error('Missing UI entry point');
  return template.replace('src="/src/main.tsx"', 'src="/assets/app.js"')
    .replace('</head>', '<link rel="stylesheet" href="/assets/app.css"/></head>');
}
export async function buildUi({ outdir = join(root, 'dist') } = {}) {
  // Build first: errors must not publish a new index referencing absent assets.
  const result = await build(options(resolve(outdir)));
  await mkdir(join(outdir, 'assets'), { recursive: true });
  for (const file of result.outputFiles) await writeFile(file.path, file.contents);
  await writeFile(join(outdir, 'favicon.svg'), await readFile(join(root, 'public/favicon.svg')));
  await writeFile(join(outdir, 'index.html'), await page());
}
export async function developmentUi() {
  // In-memory output only; no development server port, arbitrary file serving,
  // glob patterns, dotenv injection, or target credentials in the build.
  const ctx = await context(options(join(root, 'dist'), true));
  return {
    close: () => ctx.dispose(),
    middleware: async (req, res, next) => {
      if (!['GET', 'HEAD'].includes(req.method) || req.path.startsWith('/api/')) return next();
      const assets = { '/assets/app.js': ['app.js', 'text/javascript'], '/assets/app.css': ['app.css', 'text/css'] };
      if (req.path !== '/' && req.path !== '/index.html' && req.path !== '/favicon.svg' && !assets[req.path]) return next();
      try {
        res.setHeader('Cache-Control', 'no-store');
        if (req.path === '/favicon.svg') return res.type('image/svg+xml').send(await readFile(join(root, 'public/favicon.svg')));
        const result = await ctx.rebuild();
        if (assets[req.path]) {
          const [name, type] = assets[req.path];
          const output = result.outputFiles.find(file => file.path === join(root, 'dist/assets', name));
          if (!output) throw Error('Missing UI output');
          return res.type(type).send(Buffer.from(output.contents));
        }
        return res.type('html').send(await page());
      } catch { return res.status(503).type('text').send('Local UI build failed. Check the source and run npm run build.'); }
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await buildUi();
