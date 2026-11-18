import {execFileSync} from 'node:child_process';
import {readFileSync, statSync} from 'node:fs';

const RAW_EVIDENCE = /^(?:docs\/evidence\/[^/]+\/|docs\/enterprise-work\/restore-evidence-[^/]+\/)/;
const ALLOWED_FIXTURES = new Set([
  'tests/enforcement/credential-marker-cases.json',
  'tests/enforcement/repository-hygiene.test.mjs',
]);
const SECRET_PATTERNS = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['Slack token', /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/],
  ['OpenAI-style secret', /\bsk-[A-Za-z0-9]{20,}\b/],
];
const LOCAL_PATH_PATTERNS = [
  /\b[A-Z]:[\\/](?:Users|project love)[\\/]/i,
  /\/home\/runner\//,
];

export function inspectChangedFile(path, bytes) {
  const issues = [];
  const normalized = path.replaceAll('\\', '/');
  if (RAW_EVIDENCE.test(normalized)) issues.push('raw generated evidence must be a CI artifact');
  if (normalized.startsWith('docs/evidence/') && normalized.endsWith('.log')) issues.push('evidence logs must not be committed');
  if (bytes.length > 5 * 1024 * 1024) issues.push('changed file exceeds the 5 MiB source-review limit');
  if (bytes.includes(0)) {
    if (normalized.startsWith('docs/evidence/')) issues.push('binary evidence must be a CI artifact');
    return issues;
  }
  const text = bytes.toString('utf8');
  if (!ALLOWED_FIXTURES.has(normalized)) {
    for (const [label, pattern] of SECRET_PATTERNS) if (pattern.test(text)) issues.push(`possible ${label}`);
  }
  if (normalized.startsWith('docs/evidence/')) {
    for (const pattern of LOCAL_PATH_PATTERNS) if (pattern.test(text)) issues.push('local or runner path in retained evidence');
  }
  return issues;
}

function git(args) {
  return execFileSync('git', args, {encoding: 'utf8'}).trim();
}

export function changedFiles(base = process.env.AGENTBRAKE_SCAN_BASE?.trim()) {
  let validBase = base;
  if (validBase) {
    try { git(['cat-file', '-e', `${validBase}^{commit}`]); }
    catch { validBase = ''; }
  }
  const output = validBase
    ? git(['diff', '--name-only', '--diff-filter=AM', `${validBase}...HEAD`])
    : git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

export function verifyRepositoryHygiene(paths = changedFiles()) {
  const findings = [];
  for (const path of paths) {
    let bytes;
    try {
      if (!statSync(path).isFile()) continue;
      bytes = readFileSync(path);
    } catch {
      findings.push({path, issues: ['changed file cannot be inspected']});
      continue;
    }
    const issues = inspectChangedFile(path, bytes);
    if (issues.length) findings.push({path, issues});
  }
  return findings;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href) {
  const findings = verifyRepositoryHygiene();
  if (findings.length) {
    console.error(JSON.stringify({result: 'FAIL_REPOSITORY_HYGIENE', findings}, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({result: 'PASS_REPOSITORY_HYGIENE', filesScanned: changedFiles().length}));
}
