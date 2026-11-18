# Bounded local HTTP/control-path profile

Final-source rerun2026-11-17: **PASS_BOUNDED_LOCAL_PROFILE**, source `cad14e08e68caf1406304a4cc171bd0152fb85c8562cb28bed054b86331f496d`, [summary](../evidence/enterprise-capacity-5b3a2995-be71-43ca-ad55-728626bc4d94/summary.json). All432requests matched expected outcomes:288allowed responses including108replays,144expected denials,180actual target executions, zero forbidden or additional duplicate executions. Target/audit checks, source stability and all cleanup assertions passed.

Read p95 at concurrency1/4/8 was16.261/57.071/119.118ms. The final release's native/UI verification was also running on this host; this is an observed bounded correctness/load profile, not an idle-machine benchmark, production capacity or SLA. The workload and limitations below remain unchanged; their earlier numerical table is historical.

Status: **measured local profile complete** on 2026-11-17. This is not a production PostgreSQL benchmark, capacity limit, high-availability test or SLA. It profiles the actual combined `createApp` HTTP action path, real verified OPA process, disposable file-backed SQLite control Store and separately authenticated HTTP fixture target. Client, API and target share one Node process; OPA is a separate local process.

The demonstrated evidence gap was the absence of a repeatable measured concurrency profile. No product behavior was changed. `tests/enterprise/capacity.mjs` adds only the measuring harness and assertions. Run it from the workspace with:

```text
node --import tsx tests/enterprise/capacity.mjs
```

Every run writes a new sanitized `docs/evidence/enterprise-capacity-<UUID>/summary.json`. It exits nonzero on unexpected outcomes, execution counts, changed target state, broken replay identities, audit failure or cleanup failure. No installed service, external network, real credential or paid service is used. It does not edit package scripts or CI.

## Frozen workload and acceptance

Before execution, the workload was fixed at concurrency 1, 4 and 8, with 48 requests per cell and three cells per level:

1. Benign `database_read` with limit 2, 48 independent request IDs; all must return HTTP 200/allowed with two rows and cause exactly 48 target executions.
2. Four copies of each of 12 identical read envelopes; all 48 must return HTTP 200/allowed, retain one action ID per request ID and cause exactly 12 target executions. Concurrency 1 is sequential replay baseline; concurrency 4/8 issues concurrent duplicate groups.
3. Unsupported/forbidden `database_delete`; all 48 must return HTTP 200/blocked and cause zero target executions. The HTTP action API expresses decisions in response content, so HTTP 200 alone is not success evidence.

Each cell receives a fresh scoped agent. The existing grant maximum of 1,000 calls is asserted, and the existing 120 requests/minute identity limit and global concurrency limit of 8 remain unchanged. No workload can exhaust its agent's quota or rate budget. Policy deadline stays at 250 ms; HTTP clients have a 10-second deadline and refuse redirects. No explicit warmup calls are excluded. Workloads run in the fixed order above, and the control database/audit chain accumulates across all cells.

Independent observation uses the existing target's authenticated `/snapshot` HTTP endpoint, not a mocked connector or Gateway counter. Before/after execution-call differences must match the fixed expected totals. Hashes over independently read target rows/issues/schema must remain unchanged. No returned row data, raw action bodies, tokens or private keys are included in the evidence. The full control audit chain is checked after each cell.

Latency measures each entire client fetch through JSON response parsing. p50/p95 use nearest-rank selection over all 48 observations; max includes every request. Worker concurrency bounds outstanding requests, and observed peak in-flight is reported. Per-cell requests/second is only observed closed-loop traffic during that short cell. It is not a supported throughput or saturation estimate.

## Observed result

Final scoped run: [summary.json](../evidence/enterprise-capacity-417bc514-94d6-46be-8d3f-bbcb2759f6c2/summary.json), 2026-11-17 07:40:02–07:40:05 UTC.

Source manifest SHA-256: `cf04df2559752eb09fadf72be8f56347469cb10a5df2ab9a603e35460848ae84`. The manifest was recomputed after execution and was unchanged. This hash binds this run's source; parent integration may produce a newer hash and must rerun before claiming final-source evidence.

| Workload | Concurrency | p50 ms | p95 ms | Max ms | Expected/observed target executions |
| --- | ---: | ---: | ---: | ---: | ---: |
| Read | 1 | 10.841 | 15.340 | 47.678 | 48 / 48 |
| Replay | 1 | 2.628 | 13.602 | 17.039 | 12 / 12 |
| Forbidden | 1 | 3.358 | 4.268 | 6.066 | 0 / 0 |
| Read | 4 | 35.361 | 40.784 | 46.871 | 48 / 48 |
| Replay | 4 | 11.554 | 15.577 | 15.735 | 12 / 12 |
| Forbidden | 4 | 12.503 | 13.072 | 13.279 | 0 / 0 |
| Read | 8 | 66.469 | 75.939 | 85.684 | 48 / 48 |
| Replay | 8 | 22.077 | 23.310 | 24.619 | 12 / 12 |
| Forbidden | 8 | 22.656 | 25.357 | 25.867 | 0 / 0 |

All **432/432 requests** matched their required outcomes: 288 allowed responses, including 108 replay responses, and 144 expected denials. Independent target observations recorded **180 executions**, no forbidden executions and no additional duplicate executions. Unexpected denials, allows and transport/action outcomes were zero. All target-state hashes and audit-chain checks passed. App/target HTTP servers and stores closed, OPA stopped, and workspace temporary files were removed.

Host metadata: Node v22.13.0, Windows 10.0.19045 x64, Intel Core i7-9700K at nominal 3.60 GHz, eight logical CPUs/available parallelism, 68,632,293,376 bytes total memory. Node peak RSS reported by the OS was 217,911,296 bytes; per-cell Node CPU and RSS measurements are in the JSON. Those resource counts cover the shared client/API/fixture process and exclude OPA CPU/RSS. They include application/dependency loading and source-manifest overhead. No claim is made about target/OPA resource isolation or availability of those resources under customer load.

An earlier successful run is retained as [initial summary](../evidence/enterprise-capacity-78566f1a-0fc7-427a-a767-1eacd63cf08a/summary.json). A small portability correction then redirected UNIX `TMPDIR` as well as Windows `TEMP`/`TMP` to the workspace temporary directory; the final run above follows that change. No failed capacity runs or production fixes occurred. Expected existing SQLite experimental/MCP informational warnings appeared; they did not affect outcome assertions.

## Remaining acceptance and stopping condition

The frozen bounded profile and cleanup assertions passed, so this scoped task stops here. No limit search, sustained soak, retry tuning or undocumented workload changes were performed.

Production PostgreSQL locking, distributed processes, TLS/proxy overhead, real IdP login, SCIM activity, durable SIEM backpressure, real external adapters, geographic networks, noisy neighbors, failure/restart behavior under load, large datasets, memory growth, resource quotas, SLO percentiles and HA remain outside this profile. The forbidden request is blocked before a policy round-trip where local validation can reject it; its lower latency cannot be used to claim OPA decision performance. Concurrent replay timing exercises the actual path, but does not prove that every duplicate arrived during rather than after the original execution. These observations establish only correctness and latency of the named short local workloads on this host and source.
