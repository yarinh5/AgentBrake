import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { ActionPreview } from "../contracts.js";

const REPOSITORY = Object.freeze({
  id: "fixture-repo-1",
  owner: "agentbrake",
  name: "sandbox",
  fullName: "agentbrake/sandbox",
  defaultBranch: "main",
  mock: true,
});
const INITIAL_README =
  "# AgentBrake sandbox\n\nDisposable local Git fixture.\n";
const NULL_SHA = "0".repeat(40);

// A deliberately small path language also excludes traversal, platform aliases,
// alternate data streams and Git metadata. No request path reaches filesystem I/O.
const safePath = z
  .string()
  .max(120)
  .refine(
    (path) =>
      (path === "README.md" ||
        /^(?:docs\/[A-Za-z0-9][A-Za-z0-9_-]*\.md|src\/[A-Za-z0-9][A-Za-z0-9_-]*\.(?:ts|tsx|js|json))$/.test(
          path,
        )) &&
      !/(?:secret|credential|password|token|private[_-]?key)/i.test(path),
    "Unsupported fixture path",
  );
const repoSchema = z.literal(REPOSITORY.fullName);
const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const branchSchema = z.string().regex(/^agentbrake\/[a-z0-9-]{1,48}$/);
const changesSchema = z
  .array(
    z.strictObject({
      path: safePath,
      content: z
        .string()
        .max(8000)
        .refine(
          (content) =>
            Buffer.byteLength(content, "utf8") <= 8000 &&
            !content.includes("\0") &&
            !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
              content,
            ),
          "Unsupported fixture content",
        ),
    }),
  )
  .min(1)
  .max(5)
  .refine(
    (changes) =>
      new Set(changes.map(({ path }) => path.toLowerCase())).size ===
        changes.length &&
      changes.reduce(
        (bytes, { content }) => bytes + Buffer.byteLength(content, "utf8"),
        0,
      ) <= 32000,
    "Duplicate paths or total content limit exceeded",
  );
const baseFields = {
  repo: repoSchema,
  baseSha: shaSchema,
  branch: branchSchema,
};
const actionSchema = z.discriminatedUnion("tool", [
  z.object({
    tool: z.literal("github_list_repo"),
    arguments: z.strictObject({}),
    sandbox: z.literal(true),
  }),
  z.object({
    tool: z.literal("github_list_branches"),
    arguments: z.strictObject({ repo: repoSchema }),
    sandbox: z.literal(true),
  }),
  z.object({
    tool: z.literal("github_read_file"),
    arguments: z.strictObject({ repo: repoSchema, path: safePath }),
    sandbox: z.literal(true),
  }),
  z.object({
    tool: z.literal("github_propose_change"),
    arguments: z.strictObject({ ...baseFields, changes: changesSchema }),
    sandbox: z.literal(true),
  }),
  z.object({
    tool: z.literal("github_create_branch"),
    arguments: z.strictObject(baseFields),
    sandbox: z.literal(true),
  }),
  z.object({
    tool: z.literal("github_open_pull_request"),
    arguments: z.strictObject({
      ...baseFields,
      changes: changesSchema,
      title: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .refine((title) => !/[\x00-\x1f\x7f]/.test(title)),
      body: z
        .string()
        .max(4000)
        .refine((body) => !body.includes("\0"))
        .default(""),
    }),
    sandbox: z.literal(true),
  }),
]);
type Change = z.infer<typeof changesSchema>[number];
type Proposal = {
  repo: string;
  baseSha: string;
  branch: string;
  changes: Change[];
};
type TreeEntry = { mode: string; type: string; sha: string; path: string };
type PullRequest = {
  number: number;
  id: string;
  title: string;
  body: string;
  base: "main";
  head: string;
  headSha: string;
  state: "open";
  mock: true;
};

/** Local mock only. Gateway owns task grants, approval authorization and audit. */
export class GitFixtureAdapter {
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private pullRequests: PullRequest[] = [];
  private mutationCount = 0;
  private stateSha = "";

  private constructor(private directory: string) {}

  static async create(
    directory: string,
    initialReadme = INITIAL_README,
  ): Promise<GitFixtureAdapter> {
    if (Buffer.byteLength(initialReadme, "utf8") > 8000)
      throw new Error("Fixture README exceeds the bootstrap bound");
    const destination = resolve(directory);
    // Do not initialize, open, clean or reuse a user repository, including empty dirs.
    // Resolve the existing parent once; mkdir is exclusive and rejects a raced path.
    const parent = await realpath(dirname(destination));
    if (!(await lstat(parent)).isDirectory())
      throw new Error("Fixture parent must be a directory");
    const target = join(
      parent,
      destination.slice(dirname(destination).length + 1),
    );
    await mkdir(target, { recursive: false, mode: 0o700 });
    const adapter = new GitFixtureAdapter(target);
    await adapter.git([
      "init",
      "--bare",
      "--object-format=sha1",
      "--initial-branch=main",
      "--template=",
      ".",
    ]);
    await adapter.git(["config", "--local", "user.name", "AgentBrake fixture"]);
    await adapter.git([
      "config",
      "--local",
      "user.email",
      "fixture@agentbrake.invalid",
    ]);
    const blob = (
      await adapter.git(
        ["hash-object", "-w", "--stdin", "--no-filters"],
        initialReadme,
      )
    ).trim();
    const tree = (
      await adapter.git(["mktree", "-z"], `100644 blob ${blob}\tREADME.md\0`)
    ).trim();
    const commit = (
      await adapter.git(
        ["commit-tree", tree],
        "Initialize disposable AgentBrake fixture\n",
      )
    ).trim();
    await adapter.git(["update-ref", "refs/heads/main", commit, NULL_SHA]);
    adapter.stateSha = await adapter.stateBlob([], 0);
    await adapter.git([
      "update-ref",
      "refs/agentbrake/state",
      adapter.stateSha,
      NULL_SHA,
    ]);
    return adapter;
  }

  static async openPersistent(directory: string, installationId: string) {
    z.string().uuid().parse(installationId);
    const destination = resolve(directory),
      info = await lstat(destination).catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
    if (!info) {
      const adapter = await this.create(destination);
      await writeFile(
        join(destination, "agentbrake-fixture.json"),
        JSON.stringify({ schema: 1, installationId }),
        { flag: "wx", mode: 0o600 },
      );
      return adapter;
    }
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error("Persistent fixture must be a real directory");
    const marker = z
      .object({
        schema: z.literal(1),
        installationId: z.literal(installationId),
      })
      .strict()
      .parse(
        JSON.parse(
          await readFile(join(destination, "agentbrake-fixture.json"), "utf8"),
        ),
      );
    if (marker.installationId !== installationId)
      throw Error("Fixture installation mismatch");
    const adapter = new GitFixtureAdapter(await realpath(destination));
    if (
      (await adapter.git(["rev-parse", "--is-bare-repository"])).trim() !==
      "true"
    )
      throw Error("Dedicated bare fixture required");
    await adapter.mainSha();
    await adapter.refreshState();
    return adapter;
  }
  private async stateBlob(pullRequests: PullRequest[], mutationCount: number) {
    const data = JSON.stringify({ schema: 1, pullRequests, mutationCount });
    if (Buffer.byteLength(data) > 200000)
      throw Error("Local fixture metadata limit reached");
    return (
      await this.git(["hash-object", "-w", "--stdin", "--no-filters"], data)
    ).trim();
  }
  private async refreshState() {
    this.stateSha = (
      await this.git(["rev-parse", "--verify", "refs/agentbrake/state"])
    ).trim();
    shaSchema.parse(this.stateSha);
    const pr = z
      .object({
        number: z.number().int().positive(),
        id: z.string().regex(/^fixture-pr-\d+$/),
        title: z.string().max(160),
        body: z.string().max(4000),
        base: z.literal("main"),
        head: branchSchema,
        headSha: shaSchema,
        state: z.literal("open"),
        mock: z.literal(true),
      })
      .strict();
    const state = z
      .object({
        schema: z.literal(1),
        pullRequests: z.array(pr).max(1000),
        mutationCount: z.number().int().nonnegative(),
      })
      .strict()
      .parse(JSON.parse(await this.git(["cat-file", "blob", this.stateSha])));
    this.pullRequests = state.pullRequests;
    this.mutationCount = state.mutationCount;
  }

  async execute(action: {
    tool: string;
    arguments: Record<string, unknown>;
    sandbox: boolean;
  }) {
    // Parse before the first await, copying accepted values so queued callers cannot
    // swap a mutable arguments object after validation. Never echo raw Zod errors.
    const parsed = actionSchema.safeParse(action);
    if (!parsed.success)
      throw new Error("Unsupported Git fixture action or arguments");
    return this.serial(async () => {
      await this.refreshState();
      const request = parsed.data;
      switch (request.tool) {
        case "github_list_repo":
          return { repository: { ...REPOSITORY } };
        case "github_list_branches":
          return {
            repository: { ...REPOSITORY },
            branches: await this.branches(),
          };
        case "github_read_file": {
          const sha = await this.mainSha();
          const entries = await this.entries(sha);
          const entry = entries.find(
            ({ path }) => path === request.arguments.path,
          );
          if (!entry) throw new Error("Fixture file not found");
          const content = await this.content(entry);
          return {
            repo: REPOSITORY.fullName,
            ref: "main",
            sha,
            path: entry.path,
            content,
          };
        }
        case "github_propose_change":
          return this.proposal(request.arguments);
        case "github_create_branch": {
          const { baseSha, branch } = request.arguments;
          await this.checkBase(baseSha);
          if ((await this.branches()).some(({ name }) => name === branch))
            throw new Error("Feature branch already exists");
          // Both checks and creation happen atomically even if another process moves main.
          const stateSha = await this.stateBlob(
            this.pullRequests,
            this.mutationCount + 1,
          );
          await this.git(
            ["update-ref", "--stdin"],
            `start\nverify refs/heads/main ${baseSha}\ncreate refs/heads/${branch} ${baseSha}\nupdate refs/agentbrake/state ${stateSha} ${this.stateSha}\nprepare\ncommit\n`,
          );
          this.stateSha = stateSha;
          this.mutationCount++;
          return { repo: REPOSITORY.fullName, branch, sha: baseSha };
        }
        case "github_open_pull_request": {
          const { baseSha, branch, title, body } = request.arguments;
          await this.checkPullRequestBranch(baseSha, branch);
          const preview = await this.proposal(request.arguments);
          const entries = await this.entries(baseSha);
          const byPath = new Map(entries.map((entry) => [entry.path, entry]));
          for (const change of preview.changes) {
            const sha = (
              await this.git(
                ["hash-object", "-w", "--stdin", "--no-filters"],
                change.content,
              )
            ).trim();
            byPath.set(change.path, {
              mode: "100644",
              type: "blob",
              sha,
              path: change.path,
            });
          }
          const tree = await this.writeTree([...byPath.values()]);
          // A fixed commit message avoids interpreting or logging agent-controlled metadata.
          const headSha = (
            await this.git(
              ["commit-tree", tree, "-p", baseSha],
              "Apply approved fixture proposal\n",
            )
          ).trim();
          const number = this.pullRequests.length + 1;
          const pullRequest: PullRequest = {
            number,
            id: `fixture-pr-${number}`,
            title,
            body,
            base: "main",
            head: branch,
            headSha,
            state: "open",
            mock: true,
          };
          const stateSha = await this.stateBlob(
            [...this.pullRequests, pullRequest],
            this.mutationCount + 1,
          );
          await this.git(
            ["update-ref", "--stdin"],
            `start\nverify refs/heads/main ${baseSha}\nupdate refs/heads/${branch} ${headSha} ${baseSha}\nupdate refs/agentbrake/state ${stateSha} ${this.stateSha}\nprepare\ncommit\n`,
          );
          this.stateSha = stateSha;
          this.pullRequests.push(pullRequest);
          this.mutationCount++;
          return {
            repo: REPOSITORY.fullName,
            baseSha,
            branch,
            headSha,
            proposalFingerprint: preview.proposalFingerprint,
            pullRequest: { ...pullRequest },
          };
        }
      }
    });
  }

  async snapshot() {
    return this.serial(async () => {
      await this.refreshState();
      return {
        repository: { ...REPOSITORY },
        mainSha: await this.mainSha(),
        branches: await this.branches(),
        pullRequests: this.pullRequests.map((pr) => ({ ...pr })),
        mutationCount: this.mutationCount,
      };
    });
  }

  async preview(action: {
    tool: string;
    arguments: Record<string, unknown>;
    sandbox: boolean;
  }): Promise<ActionPreview> {
    const parsed = actionSchema.safeParse(action);
    if (!parsed.success) throw Error("Invalid Git preview");
    const request = parsed.data;
    if (request.tool === "github_open_pull_request") {
      return this.serial(async () => {
        await this.refreshState();
        const { baseSha, branch } = request.arguments;
        await this.checkPullRequestBranch(baseSha, branch);
        const details = await this.proposal(request.arguments);
        return {
          kind: "git-change",
          summary: "Commit reviewed changes and open a local mock pull request",
          details,
        };
      });
    }
    if (request.tool === "github_create_branch")
      return this.serial(async () => {
        await this.checkBase(request.arguments.baseSha);
        if (
          (await this.branches()).some(
            (b) => b.name === request.arguments.branch,
          )
        )
          throw Error("Feature branch already exists");
        return {
          kind: "git-branch",
          summary: "Create a feature branch at the reviewed base commit",
          details: { ...request.arguments, mainUnchanged: true },
        };
      });
    return {
      kind: "operation",
      summary: "Exact local read operation",
      details: { tool: request.tool, arguments: request.arguments },
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.queue;
    // Keep the disposable repository for evidence; its owner controls cleanup.
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Git fixture is closed"));
    const result = this.queue.then(run);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async mainSha() {
    return (
      await this.git(["rev-parse", "--verify", "refs/heads/main^{commit}"])
    ).trim();
  }

  private async checkBase(baseSha: string) {
    if ((await this.mainSha()) !== baseSha)
      throw new Error("Stale fixture base SHA");
  }

  private async checkPullRequestBranch(baseSha: string, branch: string) {
    await this.checkBase(baseSha);
    const feature = (await this.branches()).find(({ name }) => name === branch);
    if (!feature || feature.sha !== baseSha || this.pullRequests.some(({ head }) => head === branch))
      throw new Error("Feature branch missing, changed or already used");
  }

  private async branches() {
    const output = await this.git([
      "for-each-ref",
      "--format=%(refname:strip=2) %(objectname)",
      "refs/heads/",
    ]);
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, sha] = line.trim().split(" ");
        return { name, sha, protected: name === "main" };
      });
  }

  private async entries(sha: string): Promise<TreeEntry[]> {
    const output = await this.git(["ls-tree", "-rz", "--full-tree", sha]);
    return output
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40})\t(.+)$/s.exec(
          line,
        );
        if (!match) throw new Error("Unsupported fixture tree");
        return {
          mode: match[1],
          type: match[2],
          sha: match[3],
          path: match[4],
        };
      });
  }

  private async content(entry: TreeEntry) {
    if (entry.type !== "blob" || entry.mode !== "100644")
      throw new Error("Unsupported fixture file type");
    const size = Number((await this.git(["cat-file", "-s", entry.sha])).trim());
    if (!Number.isSafeInteger(size) || size > 8000)
      throw new Error("Fixture file exceeds read limit");
    const content = await this.git(["cat-file", "blob", entry.sha]);
    if (content.includes("\0"))
      throw new Error("Unsupported binary fixture content");
    return content;
  }

  private async proposal(args: Proposal) {
    await this.checkBase(args.baseSha);
    const entries = await this.entries(args.baseSha);
    const changes = args.changes
      .map((change) => ({ ...change }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const diffs: string[] = [];
    for (const change of changes) {
      const existing = entries.find(({ path }) => path === change.path);
      if (
        entries.some(
          ({ path }) =>
            path !== change.path &&
            (path.toLowerCase() === change.path.toLowerCase() ||
              path.startsWith(change.path + "/") ||
              change.path.startsWith(path + "/")),
        )
      )
        throw new Error("Fixture path conflicts with existing tree");
      const previous = existing ? await this.content(existing) : "";
      if (existing && previous === change.content) continue;
      if (!existing && change.content === "") {
        // Git represents an empty added file with metadata, never a zero-line hunk.
        diffs.push(
          `diff --git a/${change.path} b/${change.path}\nnew file mode 100644\nindex 0000000..e69de29\n`,
        );
        continue;
      }
      const lines = (text: string, prefix: string) => {
        if (!text) return [];
        const parts = text.split("\n");
        if (parts.at(-1) === "") parts.pop();
        const result = parts.map((line) => prefix + line);
        if (!text.endsWith("\n")) result.push("\\ No newline at end of file");
        return result;
      };
      const count = (text: string) =>
        text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;
      const oldCount = count(previous),
        newCount = count(change.content);
      diffs.push(
        [
          `diff --git a/${change.path} b/${change.path}`,
          ...(existing ? [] : ["new file mode 100644"]),
          `--- ${existing ? `a/${change.path}` : "/dev/null"}`,
          `+++ b/${change.path}`,
          `@@ -${oldCount ? 1 : 0},${oldCount} +${newCount ? 1 : 0},${newCount} @@`,
          ...lines(previous, "-"),
          ...lines(change.content, "+"),
          "",
        ].join("\n"),
      );
    }
    if (diffs.length === 0) throw new Error("Proposal has no changes");
    const canonical = {
      repositoryId: REPOSITORY.id,
      owner: REPOSITORY.owner,
      repo: REPOSITORY.fullName,
      baseSha: args.baseSha,
      branch: args.branch,
      changes,
    };
    return {
      repo: REPOSITORY.fullName,
      baseSha: args.baseSha,
      branch: args.branch,
      changes,
      diff: diffs.join(""),
      proposalFingerprint: createHash("sha256")
        .update(JSON.stringify(canonical))
        .digest("hex"),
      sideEffects: false,
    };
  }

  private async writeTree(entries: TreeEntry[]): Promise<string> {
    const leaves: string[] = [];
    const children = new Map<string, TreeEntry[]>();
    for (const entry of entries) {
      const slash = entry.path.indexOf("/");
      if (slash < 0)
        leaves.push(
          `${entry.mode} ${entry.type} ${entry.sha}\t${entry.path}\0`,
        );
      else {
        const directory = entry.path.slice(0, slash);
        const group = children.get(directory) ?? [];
        group.push({ ...entry, path: entry.path.slice(slash + 1) });
        children.set(directory, group);
      }
    }
    for (const [directory, group] of children)
      leaves.push(`040000 tree ${await this.writeTree(group)}\t${directory}\0`);
    return (await this.git(["mktree", "-z"], leaves.join(""))).trim();
  }

  private git(args: string[], input = ""): Promise<string> {
    const nullFile = process.platform === "win32" ? "NUL" : "/dev/null";
    // Inherit only OS executable lookup/temp paths, never credentials, Git config,
    // object directories, command injection variables or the user's home config.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATHEXT"].includes(
          key.toUpperCase(),
        ),
      ),
    );
    return new Promise((resolveResult, reject) => {
      const child = spawn(
        "git",
        [
          "-c",
          `core.hooksPath=${nullFile}`,
          "-c",
          "commit.gpgsign=false",
          "-c",
          "tag.gpgsign=false",
          "-c",
          "core.fsmonitor=false",
          "-c",
          "gc.auto=0",
          "-c",
          "protocol.allow=never",
          ...args,
        ],
        {
          cwd: this.directory,
          env: {
            ...env,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: nullFile,
            GIT_CONFIG_SYSTEM: nullFile,
            GIT_TERMINAL_PROMPT: "0",
            GIT_ALLOW_PROTOCOL: "",
            LC_ALL: "C",
          },
          shell: false,
          windowsHide: true,
          stdio: [input.length ? "pipe" : "ignore", "pipe", "pipe"],
        },
      );
      const chunks: Buffer[] = [];
      let bytes = 0,
        failed = false,
        stdinErrorCode: string | undefined,
        timedOut = false;
      const fail = () => {
        failed = true;
        child.kill();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        fail();
      }, 5000);
      child.stdout!.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 256000) fail();
        else chunks.push(chunk);
      });
      child.stderr!.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 256000) fail();
      });
      child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
        stdinErrorCode = error.code;
        fail();
      });
      child.on("error", () => {
        clearTimeout(timer);
        reject(new Error("Git fixture process unavailable"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (failed || code !== 0)
          reject(
            new Error(
              "Git fixture operation failed; reconcile before retrying",
              {
                cause: {
                  operation: args[0],
                  exitCode: code,
                  stdinErrorCode,
                  timedOut,
                  outputLimit: bytes > 256000,
                },
              },
            ),
          );
        else resolveResult(Buffer.concat(chunks).toString("utf8"));
      });
      child.stdin?.end(input);
    });
  }
}
