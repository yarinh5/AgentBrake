import { z } from 'zod';
import { GitHubAppClient, type GitHubAppConfig } from './github-app-client.js';
import { TargetChangedError, type ActionPreview } from '../contracts.js';
import type { ExecutionAction } from './fixture-http.js';
import { canonical } from '../store.js';
export type { GitHubAppConfig } from './github-app-client.js';

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const branch = z.string().regex(/^agentbrake\/[a-z0-9-]{1,48}$/);
const path = z.string().max(120).refine(p => /^(README\.md|(?:docs\/[A-Za-z0-9][A-Za-z0-9_-]*\.md|src\/[A-Za-z0-9][A-Za-z0-9_-]*\.(?:ts|tsx|js|json)))$/.test(p) && !/(secret|credential|password|token|private[_-]?key)/i.test(p));
const text = z.string().max(8000).refine(s => Buffer.byteLength(s) <= 8000 && !s.includes('\0') && Buffer.from(s).toString() === s);
const changes = z.array(z.object({ path, content: text }).strict()).min(1).max(5).refine(list =>
  new Set(list.map(c => c.path.toLowerCase())).size === list.length && list.reduce((n, c) => n + Buffer.byteLength(c.content), 0) <= 32000);
const entrySchema = z.object({ path: z.string(), mode: z.string(), type: z.string(), sha });
type Entry = z.infer<typeof entrySchema>;
type Request = { tool: string; arguments: any };
const writes = new Set(['github_create_branch', 'github_open_pull_request']);

/** A disposable real repository is separate from all local/demo identities. */
export class GitHubAppAdapter {
  private client: GitHubAppClient;
  readonly config: GitHubAppConfig;
  constructor(config: GitHubAppConfig, transport: typeof fetch = fetch) {
    this.client = new GitHubAppClient(config, transport); this.config = this.client.config;
  }
  private parse(action: ExecutionAction): Request {
    if (action.sandbox !== false) throw Error('GitHub App cannot execute a local fixture action');
    const repo = z.literal(this.config.repository), fields = { repo, baseSha: sha, branch };
    const schemas: Record<string, z.ZodType> = {
      github_list_repo: z.object({}).strict(), github_list_branches: z.object({ repo }).strict(),
      github_read_file: z.object({ repo, path }).strict(),
      github_propose_change: z.object({ ...fields, changes }).strict(),
      github_create_branch: z.object(fields).strict(),
      github_open_pull_request: z.object({ ...fields, changes, title: z.string().trim().min(1).max(160).refine(s => !/[\x00-\x1f\x7f]/.test(s)), body: z.string().max(4000).refine(s => !s.includes('\0')).default('') }).strict(),
    };
    const parsed = Object.hasOwn(schemas, action.tool) ? schemas[action.tool].safeParse(action.arguments) : undefined;
    if (!parsed?.success) throw Error('Unsupported GitHub App action or arguments');
    return { tool: action.tool, arguments: parsed.data };
  }
  private async identity() {
    const raw = await this.client.request('GET', '');
    const parsed = z.object({ id: z.literal(this.config.repositoryId), full_name: z.literal(this.config.repository),
      owner: z.object({ id: z.literal(this.config.ownerId) }), default_branch: z.literal(this.config.defaultBranch),
      archived: z.literal(false), disabled: z.literal(false) }).safeParse(raw);
    if (!parsed.success) throw Error('Configured GitHub repository identity could not be verified');
    return { repositoryId: parsed.data.id, ownerId: parsed.data.owner.id, repo: parsed.data.full_name, defaultBranch: parsed.data.default_branch };
  }
  private async main() {
    return z.object({ name: z.literal('main'), protected: z.boolean(), commit: z.object({ sha }) }).parse(await this.client.request('GET', '/branches/main'));
  }
  private async feature(name: string) {
    const raw = await this.client.request('GET', `/git/ref/heads/${name}`, undefined, true);
    return raw === null ? null : z.object({ ref: z.literal(`refs/heads/${name}`), object: z.object({ type: z.literal('commit'), sha }) }).parse(raw).object.sha;
  }
  private async tree(base: string) {
    const commit = z.object({ sha: z.literal(base), tree: z.object({ sha }) }).parse(await this.client.request('GET', `/git/commits/${base}`));
    const result = z.object({ sha: z.literal(commit.tree.sha), truncated: z.literal(false), tree: z.array(entrySchema).max(2000) }).parse(await this.client.request('GET', `/git/trees/${commit.tree.sha}?recursive=1`));
    return result;
  }
  private async content(entry?: Entry): Promise<string | null> {
    if (!entry) return null;
    if (entry.type !== 'blob' || entry.mode !== '100644') throw Error('Only regular text files are supported');
    const raw = z.object({ sha: z.literal(entry.sha), encoding: z.literal('base64'), size: z.number().int().min(0).max(8000), content: z.string().max(12000) }).parse(await this.client.request('GET', `/git/blobs/${entry.sha}`));
    const encoded = raw.content.replace(/\n/g, ''), bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded || bytes.byteLength !== raw.size) throw Error('Invalid GitHub text encoding');
    return text.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  private async describe(request: Request): Promise<ActionPreview> {
    const identity = await this.identity(), main = await this.main(), args = request.arguments;
    if (!main.protected || main.commit.sha !== args.baseSha) throw new TargetChangedError();
    const feature = await this.feature(args.branch);
    if (request.tool === 'github_create_branch' ? feature !== null : request.tool === 'github_propose_change' ? feature !== null && feature !== args.baseSha : feature !== args.baseSha) throw new TargetChangedError();
    const common = { ...identity, baseSha: args.baseSha, branch: args.branch, branchSha: feature };
    const tree = await this.tree(args.baseSha);
    // This connector is deliberately limited to disposable repositories without
    // Actions automation: creating a ref/PR must not trigger an existing deploy workflow.
    if (tree.tree.some(e => e.path.startsWith('.github/workflows/'))) throw Error('Sandbox workflow automation must be removed before enabling reviewed writes');
    if (request.tool === 'github_create_branch') return { kind: 'git-branch', summary: 'Create a reviewed GitHub feature branch', details: common };
    const preview = [];
    for (const change of args.changes) {
      // Reject aliases and non-regular parent components even when the exact file is absent.
      if (tree.tree.some(e => e.path.toLowerCase() === change.path.toLowerCase() && e.path !== change.path)) throw Error('Ambiguous GitHub file path');
      const parent = change.path.includes('/') ? change.path.split('/')[0] : undefined;
      if (parent && tree.tree.some(e => e.path === parent && (e.type !== 'tree' || e.mode !== '040000'))) throw Error('Unsupported GitHub path parent');
      preview.push({ path: change.path, before: await this.content(tree.tree.find(e => e.path === change.path)), after: change.content });
    }
    const prs = z.array(z.object({ number: z.number().int().positive() })).max(100).parse(await this.client.request('GET', `/pulls?state=all&head=${encodeURIComponent(this.config.repository.split('/')[0] + ':' + args.branch)}&base=main&per_page=100`));
    if (prs.length) throw new TargetChangedError();
    return { kind: 'git-change', summary: 'Apply reviewed files and open a draft GitHub pull request',
      details: { ...common, treeSha: tree.sha, changes: preview, ...(request.tool === 'github_open_pull_request' ? { title: args.title, body: args.body, draft: true } : {}) } };
  }
  async preview(action: ExecutionAction) {
    const request = this.parse(action);
    if (!writes.has(request.tool) && request.tool !== 'github_propose_change') throw Error('This GitHub operation does not require a change preview');
    return this.describe(request);
  }
  async execute(action: ExecutionAction): Promise<unknown> {
    const request = this.parse(action), args = request.arguments;
    if (writes.has(request.tool)) {
      if (!action.preview) throw Error('Reviewed GitHub preview required');
      const current = await this.describe(request);
      if (canonical(current) !== canonical(action.preview)) throw new TargetChangedError();
      // Beyond this point even rejected responses may follow partial side effects.
      // Do not throw TargetChangedError here; Gateway records UNKNOWN, without retries.
      try {
        if (request.tool === 'github_create_branch') {
          const result = await this.client.request('POST', '/git/refs', { ref: `refs/heads/${args.branch}`, sha: args.baseSha });
          z.object({ ref: z.literal(`refs/heads/${args.branch}`), object: z.object({ sha: z.literal(args.baseSha) }) }).parse(result);
          return { repositoryId: this.config.repositoryId, repo: this.config.repository, branch: args.branch, sha: args.baseSha };
        }
        const tree = z.object({ sha }).parse(await this.client.request('POST', '/git/trees', { base_tree: current.details.treeSha,
          tree: args.changes.map((c: { path: string; content: string }) => ({ path: c.path, mode: '100644', type: 'blob', content: c.content })) }));
        const commit = z.object({ sha }).parse(await this.client.request('POST', '/git/commits', { message: 'Apply reviewed AgentBrake proposal', tree: tree.sha, parents: [args.baseSha] }));
        if ((await this.main()).commit.sha !== args.baseSha || await this.feature(args.branch) !== args.baseSha) throw Error('GitHub reference changed after object creation');
        const updated = await this.client.request('PATCH', `/git/refs/heads/${args.branch}`, { sha: commit.sha, force: false });
        z.object({ ref: z.literal(`refs/heads/${args.branch}`), object: z.object({ sha: z.literal(commit.sha) }) }).parse(updated);
        const pr = z.object({ number: z.number().int().positive(), state: z.literal('open'), draft: z.literal(true), head: z.object({ sha: z.literal(commit.sha) }), base: z.object({ ref: z.literal('main') }) }).parse(await this.client.request('POST', '/pulls', {
          title: args.title, body: args.body, head: args.branch, base: 'main', draft: true, maintainer_can_modify: false,
        }));
        return { repositoryId: this.config.repositoryId, repo: this.config.repository, baseSha: args.baseSha, branch: args.branch,
          headSha: commit.sha, pullRequest: { number: pr.number, state: pr.state, draft: pr.draft } };
      } catch { throw Error('GitHub mutation outcome requires manual reconciliation'); }
    }
    if (request.tool === 'github_propose_change') return this.describe(request);
    const identity = await this.identity();
    if (request.tool === 'github_list_repo') return { repository: identity };
    if (request.tool === 'github_list_branches') {
      const result = z.array(z.object({ name: z.string().max(255), commit: z.object({ sha }) })).max(100).parse(await this.client.request('GET', '/branches?per_page=100'));
      return { repository: identity, branches: result.map(b => ({ name: b.name, sha: b.commit.sha })), possiblyTruncated: result.length === 100 };
    }
    const main = await this.main(), tree = await this.tree(main.commit.sha);
    const content = await this.content(tree.tree.find(e => e.path === args.path));
    if (content === null) throw Error('Approved GitHub file not found');
    return { ...identity, path: args.path, sha: main.commit.sha, content };
  }
}
