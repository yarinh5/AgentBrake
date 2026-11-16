import { readFile, writeFile } from 'node:fs/promises';
import { sourceManifest } from './source-manifest.mjs';
import { assessProduction } from './production-readiness.mjs';
const json = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return undefined; throw e; } };
const pointer = await json('docs/evidence/latest-candidate.json');
const report = assessProduction({ sourceHash: (await sourceManifest()).sourceHash,
  localRelease: await json('docs/evidence/local-release.json'), candidate: pointer ? await json(pointer.directory + '/candidate-summary.json') : undefined,
  images: await json('docs/evidence/container-scan.json') });
report.at = new Date().toISOString();
await writeFile('docs/evidence/production-readiness.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.result === 'BLOCKED' ? 2 : 0;
