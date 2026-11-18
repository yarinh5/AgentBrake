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
| GitHub credentials | App key only in Gateway; one repo, scoped installation token, fixed private egress, no passthrough | Historical approved Sandbox REST trial28f3ddc1/source855b passed GH01–GH07. It does not prove live Codex/MCP or customer automation safety; current revision needs its own acceptance |
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

## First client/authentication profile and coverage gaps

The first supported evaluation client is Codex0.169.0 spawning the shipped STDIO bridge inside the isolated agent container. The bridge retrieves only its task bearer from its environment and calls the private AgentBrake REST route with redirects refused. It never loads .env or holds upstream credentials. Tools-only contracts are pinned by source; resources, prompts and agent-supplied metadata cannot create authority. Current protocol tests exercise2026-07-28 and the documented2025-11-25 compatibility path.

The separate `/mcp` HTTP handler uses preprovisioned opaque task credentials and a fixed local issuer/store. It is **not a general OAuth authorization server/resource-discovery implementation**: HTTP protected-resource/authorization-server metadata, resource indicators and client PKCE interoperability are not implemented. OIDC/PKCE for the human dashboard does not close this gap. Do not advertise generic remote OAuth MCP client compatibility. The first STDIO profile does not require implementing an unrelated OAuth server; a customer requiring direct OAuth HTTP needs a separate maintained-provider integration and conformance tests. This distinction follows the [selected MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), checked2026-11-17.

| Additional requested route | Actual evidence / trust boundary | Current completion |
|---|---|---|
| Child processes and inherited credentials | Real curl/psql/git child probes, UID1000, absence of named target/admin environment variables, exact mount/network inspections in tests/isolation/agent.mjs | Covered for those processes/variables; not arbitrary host credential stores |
| IPv4 literal target/DB/OPA/daemon addresses | Real TCP plus CLI probes to inspected fixture addresses; positive Gateway tool call | Covered for enumerated ports; not inferred from DNS |
| IPv6, alternate proxies and localhost helper listeners | Additional probe9a13d5c8 on sourcee972 tests IPv4-mapped IPv6 to four inspected targets, IPv4/IPv6 loopback protected ports, an actual local helper proxy and redirect, with a successful loopback/Gateway positive control | PASS for enumerated routes. Both actual fixture networks report IPv6 disabled; native routed IPv6 topology NOT_TESTED, no universal egress claim |
| Unix sockets and mounts | Named Docker sockets/control credential paths absent; only task token mounted | Named paths/configuration covered; no kernel exploit or attacker-admin resistance |
| Redirects and allowed-channel exfiltration | Bridge redirect:error, fixed connector endpoints, secret-shaped payload screening and taint restrictions | Unit/integration cases are bounded; encoded/semantic exfiltration not universally detected |
| Additional MCP servers/agent-added helpers | No upstream credentials or host mounts supplied; network boundary still applies | Configuration is operator-owned; arbitrary added server contracts not accepted |
| GitHub downstream Actions/hooks/bots | Trial disabled Actions, required protected main and no workflows; App events empty | CI-enabled customer repositories NOT_ACCEPTED. App permissions cannot prove organization hook absence; obtain operator attestation and separate synthetic automation tests before that profile |

New workflow acceptance must preserve the same container/credential boundary with Terminal enabled; the earlier two-read run disabled shell and therefore cannot prove that workflow. No exception can be self-approved by the agent. Source changes require fresh reports; the table is a coverage map, not a substitute for execution.

Additional actual probe evidence: `evidence/additional-boundaries-9a13d5c8-7df8-4292-837a-e6bfeddbbd1e/summary.json` and its hashed `probe.mjs`. Executed in the running owned isolation agent `agentbrake-a-b4262e71`, UID1000, exact recorded image. A child Node helper also inherited no named target/admin/cloud credential variables and could not connect to the target. No target mutation or protected API request was sent; only scoped socket attempts and Gateway health. This is an additional diagnostic with retained executable source, not an untested change to the main verifier or proof for arbitrary MCP servers/proxies. Its fixture lifecycle is owned by isolation runb4262e71.


Final-source rerun6c5db3b91a0c: additional-boundaries-070695fc-cfb3-48f2-a9e5-ae649b18cbde repeats all8 bounded groups on the actual current-source isolation agent3f5516ea with its recorded image/IPs. All pass; no native routed IPv6 topology is enabled or accepted. The main isolation lifecycle owns cleanup. Git-preview regression through the actual Gateway in stage2-workflow.log reports blocked/preview-unavailable for a missing branch, rejected approval and0 execution calls with unchanged target. This prevents the invalid precondition seen in the earlier coding experiment from reaching execution; it does not turn the earlier UNKNOWN observation into not-applied.
