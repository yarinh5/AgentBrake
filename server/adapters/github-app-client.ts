import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { z } from 'zod';

const positiveId = z.number().int().positive().safe();
export const githubAppConfigSchema = z.object({
  appId: positiveId, installationId: positiveId, repositoryId: positiveId, ownerId: positiveId,
  repository: z.string().max(120).regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/),
  defaultBranch: z.literal('main'), privateKey: z.string().min(100).max(16000),
}).strict();
export type GitHubAppConfig = z.infer<typeof githubAppConfigSchema>;
const failure = () => Error('GitHub App request could not be verified');

/** Fixed-origin, bounded HTTP and one-repository installation-token broker.
 * A transport dependency supports offline contract tests; no runtime URL option exists. */
export class GitHubAppClient {
  readonly config: GitHubAppConfig;
  private key: KeyObject;
  private cached?: { value: string; expires: number };
  private minting?: Promise<string>;
  constructor(config: GitHubAppConfig, private transport: typeof fetch = fetch) {
    const parsed = githubAppConfigSchema.safeParse(config);
    if (!parsed.success) throw Error('Invalid GitHub App configuration');
    this.config = Object.freeze(parsed.data);
    try {
      this.key = createPrivateKey(this.config.privateKey);
      if (this.key.asymmetricKeyType !== 'rsa' || (this.key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw failure();
    } catch { throw Error('GitHub App requires an RSA private key of at least 2048 bits'); }
  }
  private async json(method: string, path: string, credential: string, body?: unknown, missing = false): Promise<any> {
    try {
      const response = await this.transport(new URL(path, 'https://api.github.com'), {
        method, redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'AgentBrake', Authorization: `Bearer ${credential}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (missing && response.status === 404) { await response.body?.cancel(); return null; }
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw failure(); }
      const reader = response.body?.getReader(); if (!reader) throw failure();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.byteLength;
          if (size > 128000) { await reader.cancel(); throw failure(); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } catch { throw failure(); } // Never propagate provider bodies, credentials or fetch details.
  }
  private async mint() {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: String(this.config.appId), iat: now - 60, exp: now + 540 })}`;
    const jwt = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), this.key).toString('base64url')}`;
    const value = await this.json('POST', `/app/installations/${this.config.installationId}/access_tokens`, jwt,
      { repository_ids: [this.config.repositoryId], permissions: { contents: 'write', pull_requests: 'write' } });
    const token = z.object({ token: z.string().min(16).max(8192), expires_at: z.string(),
      permissions: z.object({ contents: z.literal('write'), pull_requests: z.literal('write'), metadata: z.literal('read').optional() }).strict(),
      repositories: z.array(z.object({ id: positiveId })).length(1) }).safeParse(value);
    if (!token.success || token.data.repositories[0].id !== this.config.repositoryId) throw failure();
    const expires = Date.parse(token.data.expires_at);
    if (!Number.isFinite(expires) || expires < Date.now() + 60000 || expires > Date.now() + 3660000) throw failure();
    this.cached = { value: token.data.token, expires: expires - 60000 };
    return token.data.token;
  }
  private async token() {
    if (this.cached && this.cached.expires > Date.now()) return this.cached.value;
    if (!this.minting) this.minting = this.mint().finally(() => { this.minting = undefined; });
    return this.minting;
  }
  async request(method: 'GET' | 'POST' | 'PATCH', suffix: string, body?: unknown, missing = false) {
    // Only adapter-authored repository-relative paths; cannot become an absolute URL.
    if ((suffix && !suffix.startsWith('/')) || /[\\#\r\n]/.test(suffix) || suffix.includes('..')) throw failure();
    return this.json(method, `/repos/${this.config.repository}${suffix}`, await this.token(), body, missing);
  }
}
