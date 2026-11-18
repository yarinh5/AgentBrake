// Public control API projections. Kept browser-only so standalone UI builds need
// no control process, target driver, policy runtime, or server credentials.
export type Policies = {
  reads: "allow" | "approval" | "deny";
  databaseWrites: "approval" | "deny";
  githubWrites: "approval" | "deny";
};
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
  tokenAudience?: string;
  tokenExpiresAt?: number;
  grant?: {
    id: string;
    agent_id: string;
    tenant: string;
    human_owner: string;
    actions: string[];
    resources: string[];
    environments: string[];
    expires_at_ms: number;
    revoked: boolean;
    policy_version: string;
    max_calls: number;
    used_calls: number;
    max_rows: number;
  };
};
export type Event = {
  id: string;
  agentId: string;
  requestId: string;
  tool: string;
  arguments: Record<string, unknown>;
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
  preview?: {
    kind: "database-update" | "git-change" | "git-branch" | "operation";
    summary: string;
    details: Record<string, unknown>;
  };
  review?: { nonce: string; fingerprint: string };
  approvalReceipt?: {
    actorId: string;
    tenant: string;
    decision: "approve" | "reject";
    at: string;
    proof: { nonce: string; fingerprint: string };
  };
};
export type Actor = {
  id: string;
  name: string;
  tenant: string;
  role: "administrator" | "operator" | "approver" | "viewer";
};
export type Session = { actor: Actor; csrfToken: string; teamMode: boolean; authMode?: "key" | "account"; assurance?: {method:'oidc'|'break-glass'} };
export type Setup = { managed: boolean; initialized: boolean; enterprise?: {enabled:true;providerLabel:string;breakGlassEnabled:boolean} };
export type Account = Actor & { email: string; active: boolean };
export type Invitation = { id: string; email: string; role: Actor["role"]; expiresAt: number };
export type Team = { members: Account[]; invitations: Invitation[] };
export type Review = {
  action: Event;
  proof: { nonce: string; fingerprint: string };
};
export type Evidence = {
  schemaVersion: 1;
  action: Event;
  decision: {
    id: string;
    policyHash: string;
    version: string;
    effect: string;
    reason: string;
  };
  review: { fingerprint?: string; receipt?: unknown; preview?: unknown };
  execution: {
    status: string;
    observation: "adapter-reported" | "not-dispatched" | "unverified";
    outcome?: "adapter-reported" | "not-applied" | "failed" | "unknown" | "unverified" | "not-dispatched";
    resultDisclosure?: "released" | "withheld" | "unavailable" | "unrecorded";
    resultRetained?: boolean;
    summary?: object;
    correlationId: string;
  };
  audit: {
    valid: boolean;
    entries: object[];
    redacted?: boolean;
    verification?: string;
  };
  coverage: string;
};
export type Workspace = {
  actor: Actor;
  teamMode: boolean;
  agents: Agent[];
  actions: Event[];
  paused: boolean;
  policies: Policies;
  connections: { github: string; database: string; repository: string };
  mcp:
    | { command: string; args: string[]; env: Record<string, string> }
    | { url: string; bearer_token_env_var: string };
  auditValid: boolean;
  updatedAt: string;
};
