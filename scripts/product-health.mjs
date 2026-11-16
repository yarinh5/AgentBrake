import { request } from 'node:https';
import { rootCertificates } from 'node:tls';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function productHealth(config) {
  if (!config.candidate?.httpsOrigin) {
    const result = await fetch(`http://127.0.0.1:${config.port}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    await result.body?.cancel(); return String(result.status);
  }
  const origin = new URL(config.candidate.httpsOrigin), cert = await readFile(join(config.dir, 'tls-cert.pem'), 'utf8');
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: config.port, servername: origin.hostname, path: '/api/health',
      ca: [...rootCertificates, cert], headers: { Host: origin.host }, timeout: 5000 }, res => { res.resume(); res.on('end', () => resolve(String(res.statusCode))); });
    req.on('error', reject); req.on('timeout', () => req.destroy(Error('HTTPS health deadline exceeded'))); req.end();
  });
}
