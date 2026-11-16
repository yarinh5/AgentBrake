export function assessProduction({ sourceHash, localRelease, candidate, images }) {
  const checked = (id, evidence, expected, description) => ({ id, description,
    status: !evidence ? 'NOT_RUN' : evidence.sourceHash === sourceHash && evidence.result === expected ? 'PASS' : 'STALE_OR_FAILED' });
  const gates = [
    checked('local-release', localRelease, 'LOCAL_MVP_VERIFIED_EXTERNAL_GATES_OPEN', 'Full local release gate for the exact source revision'),
    checked('https-candidate', candidate?.cleanup?.result === 'PASS' ? candidate : candidate ? { ...candidate, result: 'FAIL_CLEANUP' } : undefined, 'PASS_LOCAL_CANDIDATE', 'Actual local TLS, installed UI and agent network boundary'),
    checked('container-vulnerabilities', images, 'PASS_IMAGE_SCAN', 'Offline scan of built runtime/dashboard and pinned PostgreSQL/OPA images'),
    { id: 'live-github', status: 'NOT_OBTAINED', description: 'Named disposable repository, selected-repository GitHub App and real approved/denied workflow evidence' },
    { id: 'clean-host', status: 'NOT_OBTAINED', description: 'Independent clean Linux host installation, certificate validation, backup restore and isolation proof' },
    { id: 'human-security-review', status: 'NOT_OBTAINED', description: 'Independent human review of this revision, threat boundaries and acceptance evidence; critical/high findings resolved' },
    { id: 'deployment-authorization', status: 'NOT_OBTAINED', description: 'Named host/account, DNS/TLS, private access path and explicit deployment/budget approval' },
    { id: 'operations-owner', status: 'NOT_OBTAINED', description: 'Named incident/patch owner, external encrypted backup destination and tested restore/revocation procedure' },
  ];
  return { result: gates.every(g => g.status === 'PASS') ? 'ELIGIBLE_FOR_DEPLOYMENT_REVIEW' : 'BLOCKED', sourceHash, gates,
    limitation: 'External gates require actual separately reviewed evidence. This command has no flag to relabel an offline fixture as live or approve deployment.' };
}
