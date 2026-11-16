# Milestone A closure and Stage 2 — local fixtures only

Authorized 2026-11-16 by the user's explicit continuation. This supersedes the previous turn's no-Docker-restart constraint for repair, but never authorizes data deletion/reset, unrelated workloads, production connections, paid services or external deployment. Preserve `.env`, `data/`, prior evidence and the existing gateway.

## Acceptance and sequence

1. Diagnose Docker with local logs and component checks. Restore its engine without deleting images/volumes or changing unrelated WSL distributions. Record actual cause/evidence; distinguish a recovered runtime from a verified underlying OS defect fix.
2. REST rejection audit: malformed JSON/envelope, nesting, size, auth, replay mismatch and rate/concurrency refusal receive a bounded redacted event with server-generated correlation and trusted identity where available. Never log raw payload/header/token/URL. Audit sink failure must not dispatch or turn rejection into success. Tests must fail first.
3. Milestone A isolation: isolated agent fixture has only its gateway token, no host/socket/credential mounts and no direct target network. Typed gateway path uses authenticated OPA; fake upstream counts calls. Exercise real curl/psql/git attempts to target/OPA/control/host engine and positive mediated reads. Prove T02,T07,T10,T14,T20 with snapshots/counters; only then close A.
4. Run existing 67 Node +12 Rego +2 browser checks, build/typecheck and new isolation/evidence cases. Retain failures and command logs. Hash source; there is no Git repository.
5. Stage 2 after A: add separate local PostgreSQL fixture with read-only role, approved parameterized templates, read-only transaction/statement/row limits; fixture-only bounded writes behind approval. Underlying role must independently reject DDL/privilege escalation. Separate control/audit PostgreSQL instance and versioned schema; no existing DB migration.
6. Stage 2 GitHub mock: local repository identity, approved file/branch listing, canonical change preview, feature branch and PR flow with main/workflow/secret/force/merge restrictions; actual local Git before/after where applicable. No GitHub network or PAT path. Task grants are explicit bounded admin-created scopes/expiry/quotas/revision; agent cannot mint authority.
7. Full local verification, fresh-context final security review as required by executing-plans, regressions for demonstrated important findings, updated test matrix/threat model/operations/limits. Actual Codex live workflow, GitHub App connection, Next.js UI migration and later product gates are not inferred from synthetic clients.

## Initial evidence and risks

- Existing final Stage 1 run: `aaaebc16-8777-4a47-9605-99a9c5a8f83d`, scoped PASS, T20 NOT RUN.
- Docker27.1.1/Desktop4.33.1: backend logs show `192.168.65.7:2375: no route to host`; generic API-version500 is a proxy symptom. `wsl -d docker-desktop ... ip route` hung. Only other listed WSL distribution is stopped. Root cause below the WSL/VM boundary not yet established.
- Use named AgentBrake containers/networks/volumes and scoped cleanup; no prune/reset. Do not claim isolation against host administrator or arbitrary pre-existing credentials.
- Async PostgreSQL persistence must preserve consume-once/audit-before-dispatch and task revocation semantics; test transaction/race failures against real local DB.
- New local adapters must not create a second permissive path around the existing PEP.

## Execution ledger

- 2026-11-16: inspected existing code/specification and reproduced Docker proxy500; began targeted Desktop shutdown, no data reset.
- Desktop restart exposed a WSL service deadlock: distro listing/termination hung; elevated Restart-Service remained StopPending. After VM exit, a targeted service-process recovery (identity checked, refused while any VM remained) restored WSL. User approved the UAC repair and update; one canceled/missing UAC attempt was not retried until explicitly reauthorized.
- Official Docker Desktop4.99.0 installer SHA-256 `a5e299131c9c53d60f3f752b162078945eb5faf6eedcf0be20a214c6e6cea444`, Authenticode Docker Inc Valid. Upgrade exit0, no reboot required; engine29.9.3/Compose5.7.0 responds and no unrelated containers are running. No reset/unregister/prune. Exact underlying OS deadlock trigger remains unknown; runtime recovery is observed.
- The previous4.33.1 predates Docker's CVE-2025-9074 fix; upgraded before isolation acceptance. Primary reference: https://docs.docker.com/security/security-announcements/#docker-desktop-4443-security-update-cve-2025-9074 .
- REST audit: seven initial failures reproduced the missing events/sink failure behavior; implementation passed, plus replay and concurrency cases. Separate HTTP fixture transport: two fail-first tests demonstrated absent remote dispatch/fallback, then passed with counted target and explicit unavailable-target failure.
- Native interim run `2954699e-b44e-4908-9cf0-5d6d5131e4d7`: 78 Node,12 Rego,2 browser,typecheck/build,10 proof cases PASS. It preceded final Docker recovery; its Docker preflight failure remains in the record. Compose syntax validated separately; container tests now pending.

- Milestone A closed with matching source manifest c5b6e3...: native f1507535 + isolation04a1a0e8. Full closure artifact is evidence/milestone-a.json.
- Stage2 implemented separate PG control/target with versioned fixture bootstrap, asynchronous store and atomic reservation/audit, fixed safe DB operations and roles, local Git canonical diff/feature branch/mock PR, explicit admin grant issue/revoke and policy stage2.v1. No old application data migrated.
- Fresh security review identified two async approval races; both reproduced, fixed and re-reviewed. Runtime evidence and retained failures are in SECURITY_EVIDENCE.md. Full final verification pointer is evidence/stage2-latest.json; B is not closed without actual Codex and remaining workflow metrics.

- Final full gate PASS_BOUNDED: native 94f60177-35ba-4138-aa81-f43aa9a97f5e, isolation c866eaf9-019c-4f5f-b5db-cb9c0a8c2007, source 8acfcc4d0763d00350b314edc20b848b91f493527e1a25baf92e6bcccc3c44fa. Counts: 97 native pass/3 intentional PG skips;18 actual PG pass/0skip;12Rego;2browser;10nativeproof;14workflow. Final review fixes verified, unique Docker project cleaned. Stop condition for this authorized local stage met; later B/C/D gates remain explicit.
