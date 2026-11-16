import { z } from "zod";
import type { TaskGrant } from "./policy/contracts.js";
import type { ApprovalReceipt, ReviewProof } from "./security/approval.js";
// Syntax only. Gateway additionally requires the exact server-configured target
// and task grant; fixture adapters retain their literal local repository check.
const repo = z.string().max(120).regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/);
const baseSha = z.string().regex(/^[a-f0-9]{40}$/);
const branch = z.string().regex(/^agentbrake\/[a-z0-9-]{1,48}$/);
const changePath = z
  .string()
  .min(1)
  .max(300)
  .refine(
    (path) =>
      /^(?:README\.md|docs\/[a-zA-Z0-9_/-]+\.md|src\/[a-zA-Z0-9_/-]+\.(?:ts|tsx|js|json))$/.test(
        path,
      ) &&
      !path
        .split("/")
        .some(
          (s) =>
            !s ||
            s === "." ||
            s === ".." ||
            /^(?:secrets?|credentials)$/i.test(s),
        ),
  );
const changes = z
  .array(z.object({ path: changePath, content: z.string().max(8000) }).strict())
  .min(1)
  .max(5);
export const toolSchemas = {
  database_schema: z.object({}).strict(),
  github_list_repo: z.object({}).strict(),
  github_list_branches: z.object({ repo }).strict(),
  github_propose_change: z.object({ repo, baseSha, branch, changes }).strict(),
  github_create_branch: z.object({ repo, baseSha, branch }).strict(),
  github_open_pull_request: z
    .object({
      repo,
      baseSha,
      branch,
      title: z.string().min(1).max(200),
      body: z.string().max(8000).default(""),
      changes,
    })
    .strict(),
  database_read: z
    .object({ limit: z.number().int().min(1).max(100).default(10) })
    .strict(),
  database_update: z
    .object({
      id: z.number().int().positive(),
      status: z.enum(["active", "paused"]),
    })
    .strict(),
  github_read_file: z
    .object({
      repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      path: z
        .string()
        .min(1)
        .max(300)
        .regex(/^[a-zA-Z0-9_.\-/]+$/),
    })
    .strict(),
  github_create_issue: z
    .object({
      repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      title: z.string().min(1).max(200),
      body: z.string().max(8000).default(""),
    })
    .strict(),
};
export type Tool = keyof typeof toolSchemas;
export const githubWrites = new Set([
  "github_create_issue",
  "github_create_branch",
  "github_open_pull_request",
]);
export const readTools = new Set(
  Object.keys(toolSchemas).filter(
    (tool) => tool !== "database_update" && !githubWrites.has(tool),
  ),
);
export const actionSchema = z
  .object({
    requestId: z.string().uuid(),
    tool: z.string().min(1).max(100),
    arguments: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type Action = z.infer<typeof actionSchema>;
export const policiesSchema = z
  .object({
    reads: z.enum(["allow", "approval", "deny"]),
    databaseWrites: z.enum(["approval", "deny"]),
    githubWrites: z.enum(["approval", "deny"]),
  })
  .strict();
export type Policies = z.infer<typeof policiesSchema>;
export type Agent = {
  id: string;
  name: string;
  status: "active" | "paused";
  tools: string[];
  resources: string[];
  sandbox: boolean;
  tainted: boolean;
  createdAt: string;
  ownerId?: string;
  grant?: TaskGrant;
  tokenAudience?: string;
  tokenExpiresAt?: number;
};
export type ActionRecord = {
  id: string;
  agentId: string;
  requestId: string;
  tool: string;
  arguments: Record<string, unknown>;
  digest: string;
  destination: string;
  correlationId: string;
  grantId?: string;
  grantFingerprint: string;
  policyRevision: number;
  policyDecisionId: string;
  policyVersion: string;
  policyHash: string;
  policyEffect: "ALLOW" | "DENY" | "REQUIRE_APPROVAL";
  status:
    | "queued"
    | "pending"
    | "executing"
    | "allowed"
    | "blocked"
    | "failed"
    | "unknown";
  rule: string;
  reason: string;
  resource: string;
  sandbox: boolean;
  createdAt: string;
  expiresAt: string;
  durationMs: number;
  result?: unknown;
  resultPurgedAt?: string;
  review?: ReviewProof;
  approvalReceipt?: ApprovalReceipt;
  preview?: ActionPreview;
};
export const actionPreviewSchema = z
  .object({
    kind: z.enum(["database-update", "git-change", "git-branch", "operation"]),
    summary: z.string().max(200),
    details: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ActionPreview = z.infer<typeof actionPreviewSchema>;
export class TargetChangedError extends Error {
  constructor() {
    super("Reviewed target state changed; no mutation applied");
  }
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const toolDescriptions: Record<Tool, string> = {
  database_schema:
    "Inspect the fixed approved fixture customer schema. No arbitrary SQL.",
  github_list_repo: "Inspect the configured repository identity (local fixture or authorized GitHub App sandbox).",
  github_list_branches:
    "List branches of the configured repository.",
  github_propose_change:
    "Preview a bounded file change against an exact base commit; does not modify the repository.",
  github_create_branch:
    "Create a feature branch after independent human approval; main is protected.",
  github_open_pull_request:
    "Commit exact approved changes to a feature branch and open a mock PR or GitHub draft PR, according to the configured connection. Never merges.",
  database_read:
    "Read up to 100 approved customer records. Marks this identity as having accessed protected data.",
  database_update:
    "Change one customer status. Queued for an administrator to approve; never executes before approval.",
  github_read_file:
    "Read a file from the configured repository. Secret paths and traversal are blocked.",
  github_create_issue:
    "Create a GitHub issue after administrator approval. Blocked after protected data access.",
};
