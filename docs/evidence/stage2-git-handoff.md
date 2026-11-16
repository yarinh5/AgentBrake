# Stage 2 local Git mock adapter handoff

Status: assigned adapter scope complete; local executable evidence only. No real GitHub connection, organization/repository access, deployment or paid service was used. No existing `.env` or `data` contents were read. This is not evidence of live GitHub integration or whole-product completion.

## Requirement, cause and implementation

FR-06 / Master Stage 2 required a real local feature-branch workflow behind the GitHub mock interface. The missing implementation was confirmed by the initial focused test command failing to resolve `server/adapters/git-fixture.js`; this initial failure establishes absence, not a behavioral regression proof.

The adapter now creates a new disposable bare Git repository with protected `main`, fixed local fixture author configuration, and trusted mock identity `fixture-repo-1` / owner `agentbrake` / `agentbrake/sandbox`. It refuses every existing destination, including an empty directory, so callers must pass a nonexistent child of their disposable directory. It never opens, cleans, or resets an existing repository.

Inputs are independently parsed with strict per-tool argument schemas. Unknown tools, non-sandbox execution, other repositories, protected/invalid branches, stale base SHAs, unsupported paths, symlink entries, duplicate paths, oversized payloads and unexpected argument keys are rejected. Only `README.md`, direct `docs/*.md` and direct `src/*.{ts,tsx,js,json}` files in the small ASCII filename grammar are supported; secret-like filenames are denied. Limits: 1–5 files, 8,000 UTF-8 bytes/file, 32,000 total bytes. No deletes, workflow/secrets edits, direct-main writes, merges, releases, force pushes or network operations exist.

Git runs without a shell, global/system config, inherited Git variables, hooks, signing, external protocols or automatic GC. Requests are serialized in one adapter instance. Blob/tree/commit plumbing avoids worktree path resolution. `update-ref --stdin` transactions verify main and conditionally create/update the feature ref atomically. The feature must still equal the supplied authoritative main SHA before a PR can commit, and replay after a successful PR is rejected. The adapter never retries Git mutations.

`propose_change` reads immutable objects, sorts changes and returns a canonical fingerprint and unified diff without writing refs, objects or any fixture files. A meaningful follow-up test demonstrated that empty-file additions originally produced a corrupt patch (`git apply --cached --check`: `corrupt patch at line 14`). The fix emits Git's empty-file metadata form instead of a zero-line hunk. The final test applies the preview using real Git and proves its resulting tree equals the actual PR commit tree, including empty files and missing terminal newlines.

## Public API

`GitFixtureAdapter.create(directory: string): Promise<GitFixtureAdapter>`; `execute({tool, arguments, sandbox})`; `snapshot()`; `close()`.

| Tool | Strict arguments | Result |
|---|---|---|
| `github_list_repo` | `{}` | `{repository}` with trusted fixture identity |
| `github_list_branches` | `{repo}` | `{repository, branches:[{name,sha,protected}]}` |
| `github_read_file` | `{repo,path}` | `{repo,ref:'main',sha,path,content}` |
| `github_propose_change` | `{repo,baseSha,branch,changes:[{path,content}]}` | `{repo,baseSha,branch,changes,diff,proposalFingerprint,sideEffects:false}` |
| `github_create_branch` | `{repo,baseSha,branch}` | `{repo,branch,sha}` |
| `github_open_pull_request` | `{repo,baseSha,branch,title,body?,changes:[{path,content}]}` | `{repo,baseSha,branch,headSha,proposalFingerprint,pullRequest}` |

Branches must match `agentbrake/[a-z0-9-]{1,48}`. `body` defaults to an empty string. A mock PR contains `{number,id,title,body,base:'main',head,headSha,state:'open',mock:true}`. `snapshot()` returns `{repository,mainSha,branches,pullRequests,mutationCount}`. `close()` drains accepted work, rejects new requests and preserves the repository for evidence; the caller owns cleanup.

`proposalFingerprint` binds trusted repository identity, base SHA, branch and sorted file content. It is a **proposal** fingerprint, not an approval token: Gateway must separately bind the whole action including PR title/body, actor, task grant and policy, and must authorize both mutations. No authorization is inferred from natural-language content.

## Checks actually run

Run ID: `stage2-git-native-20261116-104940Z`. Recorded at `2026-11-16T12:49:40+02:00`. Environment: Windows, Node `v22.13.0`, Git `2.46.0.windows.1`, native disposable Git repositories under the OS temporary directory. Owned files only: adapter, test file and this handoff. Workspace build SHA is unavailable: `git rev-parse HEAD` reported that the workspace is not a Git repository; no SHA is invented. The tests independently assert actual temporary repository commit IDs.

- `node --import tsx --test tests/stage2/git-fixture.test.ts`: initial failure was the missing module. First implemented revision: 11/11 pass. Final revision: **13/13 pass**, 0 failures, 0 skips, 16.064 seconds.
- `node --import tsx --test --test-name-pattern 'diff applies exactly|queued requests' tests/stage2/git-fixture.test.ts`: initially 1/2 passed; empty-file diff test failed as described. After the targeted fix, **2/2 pass**.
- `npx tsc --noEmit --pretty false`: **PASS** on the final revision. Earlier check found test result-union narrowing issues (fixed in the owned test helper), plus concurrent unfinished shared-work errors in `server/app.ts` and `tests/stage2/postgres-control.test.ts`; the subsequent check exited 0.

The 13 final tests cover trusted identity and actual Git reads; refusal of existing directories/repos; pure canonical previews; exact applicable diff; queued-argument swap resistance; actual branch/commit/mock PR effect with unchanged main; forbidden tools/branches/repos/extra keys; workflow/secret/traversal paths with outside sentinel unchanged; size/UTF-8/schema/duplicate bounds; stale and missing refs/no-op proposals; eight-way branch and PR races with one effect each; tracked symlink rejection; and closing without deleting evidence. Denial/preview tests hash all Git files, including objects and config, before/after.

## Remaining boundaries

- This adapter does not implement approval authorization, task grants, Gateway audit, network/container isolation or persistent control storage. Parent integration owns those checks and the full project/Docker suite; they were not run by this adapter task.
- PR records/counters are in-memory mock state. Git commits/refs are real. There is no reopening or crash recovery API. On subprocess timeout/failure or a process crash, partial unreachable objects or an already-updated ref may remain; callers must report an uncertain outcome and reconcile, never blindly retry.
- The supplied disposable directory and the Git executable are operator-trusted. A host administrator/process with direct filesystem access can bypass or corrupt the fixture; this adapter is not a host-wide Git firewall.
- No automatic semantic code/secret scanner is claimed. The file allowlist blocks sensitive path classes; allowed file contents can still contain unsafe code or secrets supplied by a caller. Gateway result/audit redaction remains a separate responsibility.
- Initial module-absence failure is not counted as a demonstrated behavioral regression. The empty-file formatting defect has an observed behavioral red/green test, and all supported final paths have actual-Git assertions.

Acceptance/stopping conditions were met for this assignment: supported local workflow changes only a feature ref; main is unchanged; denial and preview leave Git/outside-file state unchanged; stale/racing/replayed mutations fail; exact preview applies to the same tree as execution; final scoped tests and type-check pass. No further scope was added.
