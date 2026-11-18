// Emit classifications and source locations only, never raw verifier output.
export function failureDiagnostics(label, output) {
  const allowedLabels = ['node-tests','compose-up','container-logs'];
  if (!allowedLabels.includes(label)) return null;
  const text=String(output), codes=[...new Set(text.match(/\b(?:ENOENT|EACCES|EPERM|ECONNREFUSED|ETIMEDOUT|ERR_ASSERTION|EUSAGE|ENOSPC)\b/g)??[])];
  const locations=[...new Set((text.match(/(?:tests|scripts|server)[/\\][a-zA-Z0-9_./\\-]+\.(?:mjs|ts):\d+(?::\d+)?/g)??[]).map(s=>s.replaceAll('\\','/')))];
  const signatures={permissionDenied:/permission denied|EACCES/i,missingFile:/no such file|ENOENT/i,unhealthy:/unhealthy/i,buildFailure:/failed to solve/i,pullFailure:/pull access denied|manifest unknown/i,connectionRefused:/ECONNREFUSED|connection refused/i,diskFull:/no space left|ENOSPC/i,dependencyLock:/npm ci.*only install|EUSAGE/i,assertion:/ERR_ASSERTION|AssertionError/};
  const categories=Object.entries(signatures).filter(([,re])=>re.test(text)).map(([k])=>k);
  const protectedFiles=[...new Set(text.match(/\/run\/secrets\/(?:admin-key|opa-token|target-token|observer-token|postgres-bootstrap|target-read-password|target-write-password|control-password|control-owner-password|auth\.json)\b/g)??[])];
  return {label,codes,locations,categories,protectedFiles,failedTests:(text.match(/^not ok \d+ - /gm)??[]).length};
}
