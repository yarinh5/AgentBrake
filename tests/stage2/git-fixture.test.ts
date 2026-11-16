import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { test } from "node:test";
import { GitFixtureAdapter } from "../../server/adapters/git-fixture.js";

const repo = "agentbrake/sandbox";
const branch = "agentbrake/documentation";
const changes = [{ path: "README.md", content: "# Revised fixture\n" }];

test("persistent fixture reopens exact branch/PR state and refuses another installation or unmarked repository", async () => {
  await disposable(async (root) => {
    const directory = join(root, "persistent.git"),
      installation = randomUUID();
    const first = await GitFixtureAdapter.openPersistent(
      directory,
      installation,
    );
    const { mainSha: baseSha } = await first.snapshot();
    await call(first, "github_create_branch", { repo, branch, baseSha });
    await call(first, "github_open_pull_request", {
      repo,
      branch,
      baseSha,
      changes,
      title: "Persisted local review",
      body: "",
    });
    const before = await first.snapshot();
    await first.close();
    await assert.rejects(
      GitFixtureAdapter.openPersistent(directory, randomUUID()),
    );
    const second = await GitFixtureAdapter.openPersistent(
      directory,
      installation,
    );
    try {
      assert.deepEqual(await second.snapshot(), before);
      await assert.rejects(
        call(second, "github_open_pull_request", {
          repo,
          branch,
          baseSha,
          changes,
          title: "Replay",
          body: "",
        }),
      );
      assert.deepEqual(await second.snapshot(), before);
    } finally {
      await second.close();
    }
    const unmarked = join(root, "unmarked.git"),
      temporary = await GitFixtureAdapter.create(unmarked);
    await temporary.close();
    const digest = await filesDigest(unmarked);
    await assert.rejects(
      GitFixtureAdapter.openPersistent(unmarked, installation),
    );
    assert.equal(await filesDigest(unmarked), digest);
  });
});

async function git(directory: string, args: string[], input = "") {
  return new Promise<string>((resolveResult, reject) => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATHEXT"].includes(
          key.toUpperCase(),
        ),
      ),
    );
    const child = execFile(
      "git",
      ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
      {
        cwd: directory,
        windowsHide: true,
        env: {
          ...env,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
          GIT_ALLOW_PROTOCOL: "",
        },
      },
      (error, stdout) =>
        error ? reject(error) : resolveResult(stdout.trimEnd()),
    );
    if (input.length) child.stdin!.end(input);
    else child.stdin!.end();
  });
}

async function disposable<T>(run: (root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), "agentbrake-git-"));
  try {
    return await run(root);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    assert.ok(basename(root).startsWith("agentbrake-git-"));
    await rm(root, { recursive: true, force: true });
  }
}

async function fixture<T>(
  run: (
    adapter: GitFixtureAdapter,
    directory: string,
    root: string,
  ) => Promise<T>,
) {
  return disposable(async (root) => {
    const directory = join(root, "repository.git");
    const adapter = await GitFixtureAdapter.create(directory);
    try {
      return await run(adapter, directory, root);
    } finally {
      await adapter.close();
    }
  });
}

type Result = Awaited<ReturnType<GitFixtureAdapter["execute"]>>;

test("human PR review computes the canonical diff from a full PR request without mutating Git", async () => {
  await fixture(async (adapter, directory) => {
    const { mainSha: baseSha } = await adapter.snapshot(),
      before = await filesDigest(directory);
    const preview = await adapter.preview({
      tool: "github_open_pull_request",
      arguments: {
        repo,
        baseSha,
        branch,
        changes,
        title: "Local reviewed change",
        body: "Fixture",
      },
      sandbox: true,
    });
    assert.equal(preview.kind, "git-change");
    assert.match(String(preview.details.diff), /Revised fixture/);
    assert.equal(await filesDigest(directory), before);
  });
});
type Results = {
  github_list_repo: Extract<Result, { repository: object }>;
  github_list_branches: Extract<Result, { branches: unknown[] }>;
  github_read_file: Extract<Result, { content: string }>;
  github_propose_change: Extract<Result, { diff: string }>;
  github_create_branch: Extract<Result, { sha: string; branch: string }>;
  github_open_pull_request: Extract<Result, { headSha: string }>;
};
const call = <Tool extends string>(
  adapter: GitFixtureAdapter,
  tool: Tool,
  args: Record<string, unknown> = {},
) =>
  adapter.execute({ tool, arguments: args, sandbox: true }) as Promise<
    Tool extends keyof Results ? Results[Tool] : Result
  >;

// Include Git objects and config, not only refs: denied requests and previews must be pure.
async function filesDigest(directory: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(path: string, prefix: string) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const relative = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(join(path, entry.name), relative);
      else {
        hash.update(relative);
        hash.update(await readFile(join(path, entry.name)));
      }
    }
  }
  await walk(directory, "");
  return hash.digest("hex");
}

test("creates a new real Git fixture with trusted identity, protected main and bounded reads", async () => {
  await fixture(async (adapter, directory) => {
    const snapshot = await adapter.snapshot();
    assert.equal(snapshot.repository.id, "fixture-repo-1");
    assert.equal(snapshot.repository.owner, "agentbrake");
    assert.equal(snapshot.repository.fullName, repo);
    assert.deepEqual(snapshot.branches, [
      { name: "main", sha: snapshot.mainSha, protected: true },
    ]);
    assert.equal(
      await git(directory, ["rev-parse", "refs/heads/main"]),
      snapshot.mainSha,
    );
    assert.equal(
      (await call(adapter, "github_list_repo")).repository.fullName,
      repo,
    );
    assert.equal(
      (await call(adapter, "github_list_branches", { repo })).branches[0]
        .protected,
      true,
    );
    const file = await call(adapter, "github_read_file", {
      repo,
      path: "README.md",
    });
    assert.equal(file.ref, "main");
    assert.equal(
      file.content,
      "# AgentBrake sandbox\n\nDisposable local Git fixture.\n",
    );
    assert.equal(await git(directory, ["remote"]), "");
  });
});

test("refuses existing directories and repositories without changing their contents", async () => {
  await disposable(async (root) => {
    const empty = join(root, "empty");
    await mkdir(empty);
    await assert.rejects(GitFixtureAdapter.create(empty));
    assert.deepEqual(await readdir(empty), []);
    await writeFile(join(empty, "keep.md"), "user content");
    await assert.rejects(GitFixtureAdapter.create(empty));
    assert.equal(
      await readFile(join(empty, "keep.md"), "utf8"),
      "user content",
    );
    const directory = join(root, "new.git");
    const adapter = await GitFixtureAdapter.create(directory);
    const before = await filesDigest(directory);
    await assert.rejects(GitFixtureAdapter.create(directory));
    assert.equal(await filesDigest(directory), before);
    await adapter.close();
  });
});

test("canonical proposals return an exact diff and fingerprint without writing Git objects", async () => {
  await fixture(async (adapter, directory) => {
    const { mainSha: baseSha } = await adapter.snapshot();
    const before = await filesDigest(directory);
    const first = await call(adapter, "github_propose_change", {
      repo,
      baseSha,
      branch,
      changes: [
        { path: "src/example.ts", content: "export const example = 1;\n" },
        ...changes,
      ],
    });
    const second = await call(adapter, "github_propose_change", {
      branch,
      changes: [
        ...changes,
        { path: "src/example.ts", content: "export const example = 1;\n" },
      ],
      baseSha,
      repo,
    });
    assert.match(first.diff, /-# AgentBrake sandbox/);
    assert.match(first.diff, /\+# Revised fixture/);
    assert.match(first.diff, /\+export const example = 1;/);
    assert.match(first.proposalFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(first.proposalFingerprint, second.proposalFingerprint);
    assert.equal(first.diff, second.diff);
    assert.equal(first.sideEffects, false);
    const altered = await call(adapter, "github_propose_change", {
      repo,
      baseSha,
      branch,
      changes: [{ path: "README.md", content: "different\n" }],
    });
    assert.notEqual(first.proposalFingerprint, altered.proposalFingerprint);
    assert.equal(await filesDigest(directory), before);
  });
});

test("proposal diff applies exactly, including empty files and missing terminal newlines", async () => {
  await fixture(async (adapter, directory) => {
    const { mainSha: baseSha } = await adapter.snapshot();
    const proposed = [
      { path: "README.md", content: "Replacement without terminal newline" },
      { path: "docs/empty.md", content: "" },
      { path: "src/answer.ts", content: "export const answer = 42;\n" },
    ];
    const preview = await call(adapter, "github_propose_change", {
      repo,
      baseSha,
      branch,
      changes: proposed,
    });
    await git(directory, ["read-tree", baseSha]);
    await git(directory, ["apply", "--cached", "--check", "-"], preview.diff);
    await git(directory, ["apply", "--cached", "-"], preview.diff);
    const previewTree = await git(directory, ["write-tree"]);
    await call(adapter, "github_create_branch", { repo, baseSha, branch });
    const result = await call(adapter, "github_open_pull_request", {
      repo,
      baseSha,
      branch,
      changes: proposed,
      title: "Exact diff",
    });
    assert.equal(
      await git(directory, ["rev-parse", `${result.headSha}^{tree}`]),
      previewTree,
    );
    assert.equal(
      await git(directory, [
        "cat-file",
        "-s",
        `${result.headSha}:docs/empty.md`,
      ]),
      "0",
    );
  });
});

test("queued requests cannot swap validated branch or content before execution", async () => {
  await fixture(async (adapter, directory) => {
    const { mainSha: baseSha } = await adapter.snapshot();
    const args = { repo, baseSha, branch };
    const pendingBranch = call(adapter, "github_create_branch", args);
    args.branch = "main";
    await pendingBranch;
    const requested = [{ path: "README.md", content: "approved content\n" }];
    const pendingPr = call(adapter, "github_open_pull_request", {
      repo,
      baseSha,
      branch,
      changes: requested,
      title: "Bound content",
    });
    requested[0].content = "swapped content\n";
    requested[0].path = ".github/workflows/unsafe.yml";
    const result = await pendingPr;
    assert.equal(
      await git(directory, ["show", `${result.headSha}:README.md`]),
      "approved content",
    );
    assert.equal(
      await git(directory, ["rev-parse", "refs/heads/main"]),
      baseSha,
    );
  });
});

test("approved feature branch and mock PR produce one real commit while main remains unchanged", async () => {
  await fixture(async (adapter, directory) => {
    const { mainSha: baseSha } = await adapter.snapshot();
    const mainTree = await git(directory, [
      "rev-parse",
      "refs/heads/main^{tree}",
    ]);
    const args = {
      repo,
      baseSha,
      branch,
      changes: [...changes, { path: "docs/guide.md", content: "A guide\n" }],
      title: "Update fixture",
    };
    await call(adapter, "github_create_branch", { repo, baseSha, branch });
    assert.equal(
      await git(directory, ["rev-parse", `refs/heads/${branch}`]),
      baseSha,
    );
    const result = await call(adapter, "github_open_pull_request", args);
    assert.equal(result.pullRequest.body, "");
    assert.equal(result.pullRequest.base, "main");
    assert.equal(result.pullRequest.head, branch);
    assert.equal(result.pullRequest.mock, true);
    assert.notEqual(result.headSha, baseSha);
    assert.equal(
      await git(directory, ["rev-parse", `refs/heads/${branch}`]),
      result.headSha,
    );
    assert.equal(
      await git(directory, ["show", `${result.headSha}:README.md`]),
      "# Revised fixture",
    );
    assert.equal(
      await git(directory, ["show", `${result.headSha}:docs/guide.md`]),
      "A guide",
    );
    assert.equal(
      await git(directory, ["rev-parse", `${result.headSha}^`]),
      baseSha,
    );
    assert.equal(
      await git(directory, ["rev-parse", "refs/heads/main"]),
      baseSha,
    );
    assert.equal(
      await git(directory, ["rev-parse", "refs/heads/main^{tree}"]),
      mainTree,
    );
    const after = await filesDigest(directory);
    await assert.rejects(call(adapter, "github_open_pull_request", args));
    assert.equal(await filesDigest(directory), after);
    const snapshot = await adapter.snapshot();
    assert.equal(snapshot.pullRequests.length, 1);
    assert.equal(snapshot.mutationCount, 2);
    assert.equal(
      (await call(adapter, "github_read_file", { repo, path: "README.md" }))
        .content,
      "# AgentBrake sandbox\n\nDisposable local Git fixture.\n",
    );
  });
});

test("rejects protected branches, external repos, extra arguments and forbidden tools with no effects", async () => {
  await fixture(async (adapter, directory) => {
    const { mainSha: baseSha } = await adapter.snapshot();
    const before = await filesDigest(directory);
    const invalid: Array<[string, Record<string, unknown>]> = [
      ["github_create_branch", { repo, baseSha, branch: "main" }],
      ["github_create_branch", { repo, baseSha, branch: "agentbrake/../main" }],
      ["github_create_branch", { repo, baseSha, branch: "agentbrake/UPPER" }],
      ["github_create_branch", { repo: "other/repo", baseSha, branch }],
      ["github_list_repo", { repo }],
      ["github_list_branches", { repo, owner: "forged" }],
      ["github_read_file", { repo, path: "README.md", ref: "main" }],
      ["github_force_push", { repo, branch: "main" }],
      ["github_delete_repo", { repo }],
      ["github_merge_pull_request", { repo }],
      ["github_publish_release", { repo }],
      ["github_change_permissions", { repo }],
    ];
    for (const [tool, args] of invalid)
      await assert.rejects(
        call(adapter, tool, args),
        `${tool} ${JSON.stringify(args)}`,
      );
    await assert.rejects(
      adapter.execute({
        tool: "github_list_repo",
        arguments: {},
        sandbox: false,
      }),
    );
    assert.equal(await filesDigest(directory), before);
  });
});

test("rejects workflow, secret, traversal and ambiguous paths before reading or writing", async () => {
  await fixture(async (adapter, directory, root) => {
    await writeFile(join(root, "outside.md"), "outside sentinel");
    const { mainSha: baseSha } = await adapter.snapshot();
    const before = await filesDigest(directory);
    const paths = [
      ".github/workflows/test.yml",
      ".env",
      ".git/config",
      "../outside.md",
      "/outside.md",
      "docs/../../outside.md",
      "docs\\guide.md",
      "docs/./guide.md",
      "docs//guide.md",
      "src/secrets.json",
      "src/.env.ts",
      "src/credentials.json",
      "docs/secret.md",
      "docs/guide.md:stream",
      "docs/%2e%2e.md",
      "docs/guide.md\n",
      "src/nested/file.ts",
      "README.md/other.ts",
    ];
    for (const path of paths) {
      await assert.rejects(
        call(adapter, "github_propose_change", {
          repo,
          baseSha,
          branch,
          changes: [{ path, content: "unsafe" }],
        }),
        path,
      );
      await assert.rejects(
        call(adapter, "github_read_file", { repo, path }),
        path,
      );
    }
    assert.equal(await filesDigest(directory), before);
    assert.equal(
      await readFile(join(root, "outside.md"), "utf8"),
      "outside sentinel",
    );
  });
});

test("enforces file count, UTF-8 bytes, total bytes, duplicate paths and exact nested schemas", async () => {
  await fixture(async (adapter, directory) => {
    const { mainSha: baseSha } = await adapter.snapshot();
    const before = await filesDigest(directory);
    const invalidChanges = [
      [],
      Array.from({ length: 6 }, (_, i) => ({
        path: `src/a${i}.ts`,
        content: "a",
      })),
      [{ path: "README.md", content: "a".repeat(8001) }],
      [{ path: "README.md", content: "é".repeat(4001) }],
      Array.from({ length: 5 }, (_, i) => ({
        path: `src/a${i}.ts`,
        content: "a".repeat(6500),
      })),
      [...changes, ...changes],
      [{ ...changes[0], mode: "120000" }],
      [{ path: "README.md", content: 42 }],
      [{ path: "README.md", content: "nul\0byte" }],
    ];
    for (const proposed of invalidChanges)
      await assert.rejects(
        call(adapter, "github_propose_change", {
          repo,
          baseSha,
          branch,
          changes: proposed,
        }),
      );
    assert.equal(await filesDigest(directory), before);
    const valid = await call(adapter, "github_propose_change", {
      repo,
      baseSha,
      branch,
      changes: Array.from({ length: 4 }, (_, i) => ({
        path: `src/a${i}.ts`,
        content: "a".repeat(8000),
      })),
    });
    assert.match(valid.proposalFingerprint, /^[a-f0-9]{64}$/);
  });
});

test("stale main, stale feature, missing feature and no-op proposals fail before mutation", async () => {
  await fixture(async (adapter, directory) => {
    const { mainSha: baseSha } = await adapter.snapshot();
    const before = await filesDigest(directory);
    await assert.rejects(
      call(adapter, "github_create_branch", {
        repo,
        baseSha: "0".repeat(40),
        branch,
      }),
    );
    await assert.rejects(
      call(adapter, "github_open_pull_request", {
        repo,
        baseSha,
        branch,
        changes,
        title: "Missing branch",
      }),
    );
    await assert.rejects(
      call(adapter, "github_propose_change", {
        repo,
        baseSha,
        branch,
        changes: [
          {
            path: "README.md",
            content: "# AgentBrake sandbox\n\nDisposable local Git fixture.\n",
          },
        ],
      }),
    );
    assert.equal(await filesDigest(directory), before);
    await call(adapter, "github_create_branch", { repo, baseSha, branch });
    const tree = await git(directory, ["rev-parse", `${baseSha}^{tree}`]);
    const different = await git(
      directory,
      ["commit-tree", tree, "-p", baseSha],
      "external fixture change\n",
    );
    await git(directory, [
      "update-ref",
      `refs/heads/${branch}`,
      different,
      baseSha,
    ]);
    const changed = await filesDigest(directory);
    await assert.rejects(
      call(adapter, "github_open_pull_request", {
        repo,
        baseSha,
        branch,
        changes,
        title: "Stale feature",
      }),
    );
    assert.equal(await filesDigest(directory), changed);
    await git(directory, ["update-ref", "refs/heads/main", different, baseSha]);
    const advanced = await filesDigest(directory);
    await assert.rejects(
      call(adapter, "github_propose_change", {
        repo,
        baseSha,
        branch,
        changes,
      }),
    );
    await assert.rejects(
      call(adapter, "github_create_branch", {
        repo,
        baseSha,
        branch: "agentbrake/another",
      }),
    );
    assert.equal(await filesDigest(directory), advanced);
  });
});

test("concurrent branch and PR requests produce at most one effect each", async () => {
  await fixture(async (adapter, directory) => {
    const { mainSha: baseSha } = await adapter.snapshot();
    const branches = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        call(adapter, "github_create_branch", { repo, baseSha, branch }),
      ),
    );
    assert.equal(
      branches.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const prs = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        call(adapter, "github_open_pull_request", {
          repo,
          baseSha,
          branch,
          changes,
          title: "Concurrent",
        }),
      ),
    );
    assert.equal(
      prs.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal((await adapter.snapshot()).pullRequests.length, 1);
    assert.equal(
      await git(directory, [
        "rev-list",
        "--count",
        `${baseSha}..refs/heads/${branch}`,
      ]),
      "1",
    );
    assert.equal(
      await git(directory, ["rev-parse", "refs/heads/main"]),
      baseSha,
    );
  });
});

test("Git tree symlinks are never resolved or overwritten through an allowed path", async () => {
  await fixture(async (adapter, directory, root) => {
    await writeFile(join(root, "outside.md"), "outside sentinel");
    const original = (await adapter.snapshot()).mainSha;
    const blob = await git(
      directory,
      ["hash-object", "-w", "--stdin"],
      join(root, "outside.md"),
    );
    const tree = await git(
      directory,
      ["mktree"],
      `120000 blob ${blob}\tREADME.md\n`,
    );
    const commit = await git(
      directory,
      ["commit-tree", tree, "-p", original],
      "symlink adversarial fixture\n",
    );
    await git(directory, ["update-ref", "refs/heads/main", commit, original]);
    const before = await filesDigest(directory);
    await assert.rejects(
      call(adapter, "github_read_file", { repo, path: "README.md" }),
    );
    await assert.rejects(
      call(adapter, "github_propose_change", {
        repo,
        baseSha: commit,
        branch,
        changes,
      }),
    );
    assert.equal(await filesDigest(directory), before);
    assert.equal(
      await readFile(join(root, "outside.md"), "utf8"),
      "outside sentinel",
    );
  });
});

test("closing preserves evidence and rejects subsequent execution", async () => {
  await fixture(async (adapter, directory) => {
    const before = await filesDigest(directory);
    await adapter.close();
    await assert.rejects(call(adapter, "github_list_repo"));
    assert.equal(await filesDigest(directory), before);
  });
});
test("fast Git read commands do not fail after an unused stdin pipe closes", async () => {
  await fixture(async (adapter) => {
    const initial = await adapter.snapshot();
    for (let i = 0; i < 30; i++)
      assert.deepEqual(await adapter.snapshot(), initial);
  });
});
