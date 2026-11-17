# Enforcement boundary review

Reviewed 2026-11-17. Scope: current source and existing disposable Docker verification paths. This is an engineering review, not an independent penetration test. Fresh run IDs/results are recorded in PLAN_COMMERCIAL_READINESS.md and SECURITY_EVIDENCE.md; historical passes apply only to their source hashes.

## Supported security claim

An agent running in the supplied isolated network, with only its bounded AgentBrake credential, cannot use the tested direct routes to the protected fixtures. Typed operations go through authentication, task grant, OPA, current-authority recheck, atomic reservation and adapter. This does not establish security for an unrestricted host process or a different deployment topology.

| Route/asset | Enforcement and executable evidence | Limits |
|---|---|---|
| Terminal curl/psql/git | scripts/verify-isolation.mjs and tests/isolation/agent.mjs: actual CLI/TCP probes and target snapshots; internal agent network | Negative tests cover listed addresses/ports, not every possible network escape |
| Direct protected IP | verify-isolation plus verify-candidate agent probe using inspected container IPs | DNS failure alone is insufficient; IP probes are required |
| External egress | internal agent network; credential-free inference network for Codex; verifier asserts exact network attachments | Docker/host firewall correctness is trusted; host administrator can reconnect containers |
| Keys and host files | exact one read-only agent token mount; no Docker socket/host home; UID1000, read-only root, no capabilities | Host, daemon, kernel, build process and operator are trusted; no container-escape proof |
| Direct database credentials | separate reader/writer; fixture_reader cannot write/DDL; writer can execute only fixed CAS update function; tests/stage2/postgres-target.test.ts | A stolen writer credential can invoke its bounded function outside Gateway approval if network access is also obtained. Do not distribute it to agents |
| GitHub credentials | App key only in Gateway; one repo, scoped installation token, fixed private egress, no passthrough | Offline contracts and network tests only. Live GitHub rights/branch protection and other authorized actors remain external gates |
| REST/MCP alternative entry | server identity, same Gateway submit path; tests/enforcement/rest-audit.test.ts, mcp-protocol.test.ts, gateway-bridge.test.ts | UI is not an enforcement boundary by itself; control credentials confer administrative authority |
| OPA/control endpoints | private separate networks; authenticated limited PDP API, private bridge, no published target/OPA ports | Compromised Gateway/control/OPA or policy supply chain is outside hostile-agent model |
| Approval/replay | immutable preview/proof, distinct approver, atomic consumption, idempotency and final authority check | Stop/revoke prevents new reservations, not an already reserved effect; UNKNOWN is never blindly retried |
| Sensitive response | heuristic payload withholding after execution, separate disclosure field | Not a prevention of the already executed action, universal DLP or semantic prompt-injection protection |

## Findings and disposition

- Important, fixed in source: successful execution followed by secret-like output used status blocked. New records keep executionOutcome=adapter-reported and resultDisclosure=withheld; the authorization rule is preserved. No sensitive result is persisted or returned. Replay returns the same record without re-execution.
- Important, fixed in source: TargetChangedError after dispatch used blocked. It now uses failed with executionOutcome=not-applied and resultDisclosure=unavailable. The adapter contract guarantees no mutation for this error; generic mutation failure remains UNKNOWN. Preview reads may occur before authorization to mutate; zero mutation dispatch is not zero network traffic.
- Known high deployment risk: installing the MCP bridge in a host agent with its own PAT/DB credentials or unrestricted network does not prevent bypass. Pilot admission rejects that topology; revoke/remove those credentials or use the supplied isolated runner.
- Known integrity limit: host owner can rewrite the audit database and code. Hash-chain verification is not WORM storage, external anchoring or independent proof of target effects.
- Historical blocked/secret-output records are not rewritten. Their observation remains unverified, disclosure withheld; historical aggregate blocked counts must not be sold as prevented mutations. Use current correlated records and target checks for pilot metrics.

## Repeatable local checks

Run npm run verify:stage1, npm run verify:isolation, npm run verify:product and npm run verify:candidate on the final source. verify:release also exercises actual Codex with local inference when its verified model cache/GPU prerequisites are present. Check each report's sourceHash, test counts, credential scan and cleanup. Preserve the installed service; all verifiers create their own named disposable projects.

Not tested/claimed: kernel exploits, Docker daemon compromise, arbitrary host agents, universal network exfiltration, prompt-injection intent classification, cloud IAM, real organizational databases, malicious administrators, multi-tenant SaaS isolation, external penetration testing.
