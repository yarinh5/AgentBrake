# Security event delivery implementation handoff

Status: exporter and synthetic local delivery acceptance complete; application/product and dedicated egress integration belongs to the parent task. No external sink, customer SIEM, paid service, installed product, production secret, or real GitHub credential was used.

## Cause and design

The existing ControlStore retains a hash-chained audit journal but had no durable external delivery cursor or acknowledgement protocol. Both SQLite and PostgreSQL implement `auditTrail({limit, offset})` as ascending sequence order with a **row offset**, not a sequence threshold. PostgreSQL sequence allocation can leave unused numbers after transaction rollback. Treating sequence + 1 as the next row would misclassify an intact journal as missing data.

The exporter checkpoints the acknowledged row count, original sequence, and source hash. Every tick re-reads the previous acknowledged row at offset - 1, verifies that anchor against the checkpoint, then verifies strictly increasing sequences, source hashes and `previous_hash` continuity across a bounded batch plus one lookahead row. A missing retained row, edited source bytes, or shifted offset fails closed. An intact chain with nonconsecutive sequence numbers is valid. This incremental check detects changes affecting the current anchor or delivery path; it does not replace whole-journal forensic verification of already delivered historical rows.

The checkpoint contains a versioned cursor plus SHA-256 checksum, bound to installation identity and the hash of the configured endpoint. Endpoint or installation changes, malformed/checksum-invalid checkpoints, and unsafe checkpoint targets are rejected. Missing checkpoint starts at genesis, which can replay an entire retained journal with the same IDs. Source rows must remain append-only and retained; never prune this journal as a way to relieve sink backlog.

## Integration API

```ts
const delivery = await createAuditDelivery(store, {
  installationId,        // persistent, nonpersonal [A-Za-z0-9][A-Za-z0-9_-]{7,127}
  endpoint,              // fixed HTTPS URL, no userinfo or fragment
  bearerToken,           // secret supplied by the protected application configuration
  checkpointPath,        // absolute path on persistent application-owned storage
  batchSize: 100,         // 1..500
  timeoutMs: 10000,       // 100..60000; entire transport + acknowledgement deadline
  intervalMs: 5000,       // 100..3600000
}, optionalTrustedTransport);
delivery.start();         // immediate tick, then scheduled ticks; bounded exponential outage backoff
await delivery.tick();    // at most one batch; concurrent callers share one in-flight operation
delivery.status();       // copy of sanitized monitoring state
await delivery.close();   // stop scheduling, drain current operation, release writer lock
```

`optionalTrustedTransport` is `{fetch: typeof globalThis.fetch}` and is supplied by trusted application code, never deserialized from request or environment input. It receives only the already validated configured endpoint, POST, bearer authorization, JSON body, `redirect: "error"`, and an abort signal. The adapter must honor cancellation and enforce its configured fixed egress origin. Exporter still enforces total deadline, HTTP 200, no redirected response, 64 KiB maximum acknowledgement and exact acknowledgement IDs. Without an adapter, the exporter uses actual Node HTTP/HTTPS request APIs with normal TLS trust and no redirect following. No additional dependency is required.

The only insecure transport option is `allowLoopbackHttpForTests: true`, restricted to literal `127.0.0.1` or `[::1]`. Do not expose this switch in production configuration. The parent should construct the exporter only when explicitly enabled, start it after source initialization, expose status only on the authenticated operator/control surface, and close it before closing the store. Configuration/checkpoint/lock startup failure must remain a startup failure, not an automatic disable or silent reset.

## Sink contract and data minimization

Request: `POST` to the configured endpoint, `Authorization: Bearer <secret>`, JSON:

```json
{
  "schemaVersion": 1,
  "installationId": "installation-opaque-id",
  "events": [{
    "id": "installation-opaque-id:42",
    "sequence": "42",
    "at": "2026-11-17T00:00:00.000Z",
    "type": "identity.member-changed",
    "sourceHash": "<64 hex characters>",
    "previousSourceHash": "<64 hex characters or genesis>"
  }]
}
```

The event schema includes only the listed fields. No audit `details`, raw arguments/results, names, email, token, correlation metadata, raw error body, or actor/target identifiers are exported. Known literal event categories cover control, policy, agent/grant, action/execution, account, OIDC, SCIM and transport rejection events. Unknown category strings become `audit.other`, preventing a caller-controlled type from leaking payloads. The complete original event stays in the protected source journal and can be correlated there by sequence/hash. Source hashes are integrity references, not signatures, anonymization guarantees, or independent timestamp attestations.

The sink must durably accept and deduplicate the entire batch by installation + sequence before returning HTTP 200 with **exactly**:

```json
{"schemaVersion":1,"acceptedEventIds":["installation-opaque-id:42"]}
```

IDs must match the whole batch in order. Unknown IDs, partial acknowledgements, extra acknowledgement properties, non-200 responses (including 429/500/redirects), malformed or oversized bodies, timeout and network failure do not advance the cursor. A previously accepted duplicate must be acknowledged again using its original ID. If the sink commits but its ACK is lost, or local checkpoint persistence fails after ACK, the exporter resends the same IDs and payload. This is **at least once**, not exactly once. No exporter can verify a remote sink's durability promise merely from its HTTP response.

Checkpoint writes use a private uniquely created temporary file, fsync, and atomic same-directory rename; POSIX additionally fsyncs the directory. Windows does not offer the same directory fsync path, so sudden machine/power-loss durability requires platform/storage acceptance. Losing the newest checkpoint can replay earlier events; it does not authorize skipping retained data. The checksum detects accidental corruption, not a malicious administrator who can rewrite both data and checksum. Protect the state directory with OS ownership/ACLs; creation modes alone do not configure Windows ACL policy.

## Monitoring and crash recovery

Status exposes `running`, `lastAckSequence`, `acknowledgedEvents`, `pendingAtLeast`, `hasMore`, `oldestPendingAt`, `lastAttemptAt`, `lastSuccessAt`, `lastError`, and `consecutiveFailures`. `pendingAtLeast` is a bounded lower bound based on the most recent read, not a full table count or a claim about subsequent concurrent appends. `hasMore` means the last read saw another batch candidate. Unknown lag is `null`, including before the first read and on source failure. Alert on failures, rising lower-bound backlog/oldest pending age, stale attempts, and stopped delivery. Only finite error codes leave the module: `source_integrity`, `source_unavailable`, `transport`, `sink_status`, `invalid_ack`, `checkpoint_write`.

An exclusive `<checkpointPath>.lock` is held across the worker lifetime. Close is idempotent and waits for in-flight delivery. A second worker using the same cursor path is rejected. A crashed writer deliberately leaves the lock in place; automatic PID-based lock stealing would risk concurrent writers. Recovery: stop the owning service, verify no exporter process remains and storage ownership is correct, remove **only that stale lock**, retain the checkpoint, restart, and monitor acknowledgement progress. The actual child-process crash test demonstrates this recovery sequence. Do not delete a lock from a live worker, reset a corrupt checkpoint, or change the installation ID to suppress an integrity error. Investigate/restore the retained source and cursor from a consistent trusted backup instead. Restoring a database to an earlier point than its cursor fails closed; rolling both back can replay already accepted IDs.

## Verification and remaining gaps

Initial test-first run: 14 expected failures against an unimplemented API. The first implementation passed 13/14; the remaining assertion incorrectly expected a bare checkpoint rather than its checksum envelope, and was corrected to inspect the persisted cursor. A later category test demonstrated that real account/grant categories needed their exact hyphenated names in the allowlist, and an adapter test failed until the integration seam was implemented.

Final focused command: `node --import tsx --test tests/enterprise/audit-delivery.test.ts`: **23 passed, 0 failed**. It exercises real temporary SQLite/filesystem state and real local HTTP sockets: authenticated/redacted bounded batches, restart, 429/500, bad/partial/oversized ACK, redirects, lost ACK duplicate replay, writer exclusion, concurrent ticks, missing rows, edited bytes, valid sequence allocation gaps, corrupt/mismatched checkpoint, insecure configuration, timeout and close drain, checkpoint write failure, scheduler stop, actual child-process crash/stale-lock recovery, fixed-egress adapter, adapter timeout/redirect/body cap.

Scoped strict TypeScript check: `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --esModuleInterop --types node server/enterprise/audit-delivery.ts tests/enterprise/audit-delivery.test.ts`: passed. Whole-project typecheck encountered work-in-progress identity errors in the concurrent identity task, reported to parent; final integrated typecheck belongs to parent. A whole `npm test` run was initiated, then interrupted at parent request to leave shared-suite verification until integration; its partial log is `.agentbrake-local/enterprise-audit-suite.log` and is not a passing suite claim.

Not locally accepted here: real SIEM adapter/durable deduplication, customer credentials and certificate trust, external TLS/egress service deployment, PostgreSQL integration execution, operating-system crash/power failure, network filesystem locking/rename semantics, host ACL enforcement, HA or independent compliance acceptance. The default HTTPS code keeps normal TLS validation, but this task's network fixtures use the explicit local HTTP exception. Full application/proxy isolation and integrated release checks are parent-owned.
