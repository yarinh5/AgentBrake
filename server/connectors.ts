import { createHmac } from "node:crypto";
import { Store } from "./store.js";
import type { ControlStore } from "./control-store.js";
import { TargetChangedError, type ActionPreview } from "./contracts.js";
import { databasePreview, expectedVersion } from "./adapters/preview.js";
import { GitHubAppAdapter, type GitHubAppConfig } from "./adapters/github-app.js";
import {
  FixtureHttpAdapter,
  type ExecutionAction,
} from "./adapters/fixture-http.js";
export type ConnectionConfig = {
  githubApp?: GitHubAppConfig;
  githubToken?: string;
  githubRepository?: string;
  databaseUrl?: string;
  fixture?: { url: string; token: string };
};
export class Connectors {
  private fixture?: FixtureHttpAdapter;
  private githubApp?: GitHubAppAdapter;
  constructor(
    private store: ControlStore,
    public config: ConnectionConfig,
    private bindingKey: string,
    githubTransport?: typeof fetch,
  ) {
    if (config.githubApp) {
      if (config.githubToken || config.githubRepository) throw Error("Choose one explicit GitHub connection");
      this.githubApp = new GitHubAppAdapter(config.githubApp, githubTransport);
    }
    if (config.fixture)
      this.fixture = new FixtureHttpAdapter(
        config.fixture.url,
        config.fixture.token,
      );
  }
  binding(tool: string, sandbox: boolean) {
    const destination = sandbox
      ? this.config.fixture
        ? JSON.stringify(this.config.fixture)
        : "sandbox"
      : tool.startsWith("database_")
        ? this.config.databaseUrl || "sandbox"
        : this.githubApp ? JSON.stringify(this.githubApp.config) : JSON.stringify([
            this.config.githubRepository,
            this.config.githubToken,
          ]);
    return createHmac("sha256", this.bindingKey)
      .update(destination)
      .digest("hex");
  }
  modes() {
    return {
      github:
        this.githubApp ? "github-app-sandbox" : this.config.githubToken && this.config.githubRepository
          ? "configured"
          : "sandbox",
      database: this.config.databaseUrl ? "configured" : "sandbox",
      repository: this.githubApp?.config.repository || this.config.githubRepository || "agentbrake/sandbox",
    };
  }
  supportsLive(tool: string) {
    return !!this.githubApp && ["github_list_repo", "github_list_branches", "github_read_file", "github_propose_change", "github_create_branch", "github_open_pull_request"].includes(tool);
  }
  async preview(a: ExecutionAction): Promise<ActionPreview> {
    if (!a.sandbox && this.supportsLive(a.tool)) return this.githubApp!.preview(a);
    if (!a.sandbox) throw Error("Only local fixture previews are available");
    if (this.fixture) return this.fixture.preview(a);
    if (!(this.store instanceof Store))
      throw Error("Target preview unavailable");
    if (a.tool === "database_update") {
      const row = this.store.db
        .prepare("SELECT id,status,version FROM customers WHERE id=?")
        .get(a.arguments.id as number);
      if (!row) throw Error("Record not found");
      return databasePreview(row, a.arguments.status);
    }
    return {
      kind: "operation",
      summary: "Exact local fixture operation",
      details: { tool: a.tool, arguments: a.arguments },
    };
  }
  async execute(a: ExecutionAction): Promise<unknown> {
    if (!a.sandbox && this.supportsLive(a.tool)) return this.githubApp!.execute(a);
    if (!a.sandbox)
      throw new Error(
        "Real service execution is disabled. A separately approved sandbox connector is required.",
      );
    if (this.fixture) return this.fixture.execute(a);
    if (!(this.store instanceof Store))
      throw new Error(
        "PostgreSQL control store requires explicit isolated target transport",
      );
    const args = a.arguments;
    if (a.tool === "database_read") {
      return {
        rows: this.store.db
          .prepare("SELECT * FROM customers ORDER BY id LIMIT ?")
          .all(args.limit as number),
      };
    }
    if (a.tool === "database_update") {
      const version = a.precondition?.version ?? expectedVersion(a.preview);
      const row = this.store.db
        .prepare(
          "UPDATE customers SET status=?,version=version+1 WHERE id=? AND (? IS NULL OR version=?) RETURNING id,status,version",
        )
        .get(
          args.status as string,
          args.id as number,
          version ?? null,
          version ?? null,
        );
      if (!row) {
        if (version !== undefined) throw new TargetChangedError();
        throw new Error("Record not found");
      }
      return row;
    }
    if (a.tool === "github_read_file" || a.tool === "github_create_issue") {
      if (a.sandbox || !this.config.githubToken) {
        if (a.tool === "github_read_file")
          return {
            path: args.path,
            content:
              "# AgentBrake sandbox\nA local repository fixture. No GitHub request was sent.",
            sandbox: true,
          };
        const row = this.store.db
          .prepare(
            "INSERT INTO sandbox_issues(title,body) VALUES (?,?) RETURNING id",
          )
          .get(args.title as string, args.body as string)!;
        return { number: row.id, title: args.title, sandbox: true };
      }
    }
    throw new Error("Unsupported tool");
  }
  async close() {
    // Local in-memory fixture has no outbound session.
  }
}
