import type { ActionRecord, Agent, Policies } from "./contracts.js";
import type { TaskGrant } from "./policy/contracts.js";
import type { IdentityState, IdentityChange } from "./security/accounts-state.js";
export type Awaitable<T> = T | Promise<T>;
// A control handler supplies only authenticated attribution, never a session.
export type AuditContext = {
  actorId: string;
  tenant: string;
  correlationId?: string;
};
export const auditDetails = (context?: AuditContext) => ({
  actor: context
    ? { actorId: context.actorId, tenant: context.tenant }
    : { source: "internal" as const },
  ...(context?.correlationId ? { correlationId: context.correlationId } : {}),
});
export type Settings = {
  paused: boolean;
  policies: Policies;
  revision: number;
};
export type AgentInput = Pick<
  Agent,
  "name" | "tools" | "resources" | "sandbox"
> & { ownerId?: string };
export type ReservationCheck = (
  agent: Agent,
  settings: Settings,
  persisted: ActionRecord,
) => { rule: string; reason: string } | undefined;
export type ActivityQuery = {
  agentId?: string;
  grantId?: string;
  tool?: string;
  status?: string;
  resource?: string;
  from?: string;
  to?: string;
  offset: number;
  limit: number;
};
export type AuditQuery = { limit: number; offset?: number; actionId?: string };
export interface ControlStore {
  identityState(): Awaitable<IdentityState>;
  changeIdentity<T>(change: IdentityChange<T>): Awaitable<T>;
  settings(): Awaitable<Settings>;
  setPaused(paused: boolean, context?: AuditContext): Awaitable<void>;
  setPolicies(policies: Policies, context?: AuditContext): Awaitable<void>;
  agents(): Awaitable<Agent[]>;
  agent(id: string): Awaitable<Agent | undefined>;
  authenticate(token: string): Awaitable<Agent | undefined>;
  createAgent(
    input: AgentInput,
    context?: AuditContext,
  ): Awaitable<{ agent: Agent; token: string }>;
  saveAgent(agent: Agent): Awaitable<void>;
  changeAgent(
    id: string,
    patch: { status?: Agent["status"]; grant?: TaskGrant },
    event: string,
    context?: AuditContext,
  ): Awaitable<Agent | undefined>;
  actions(): Awaitable<ActionRecord[]>;
  actionsPage(query: ActivityQuery): Awaitable<{
    items: ActionRecord[];
    total: number;
    offset: number;
    limit: number;
  }>;
  policyHistory(
    limit?: number,
  ): Awaitable<{ version: number; policies: Policies }[]>;
  pruneResults(before: string): Awaitable<number>;
  action(id: string): Awaitable<ActionRecord | undefined>;
  previous(
    agentId: string,
    requestId: string,
  ): Awaitable<ActionRecord | undefined>;
  insertAction(action: ActionRecord): Awaitable<void>;
  saveAction(action: ActionRecord): Awaitable<void>;
  blockPending(action: ActionRecord): Awaitable<void>;
  // Atomic action claim + authority recheck + quota/taint update + pre-dispatch audit.
  // false means check denied, with record changed to blocked and persisted; conflict throws.
  reserve(action: ActionRecord, check: ReservationCheck): Awaitable<boolean>;
  audit(type: string, details: unknown): Awaitable<void>;
  auditTrail(query?: AuditQuery): Awaitable<
    {
      seq: number | bigint;
      data: string;
      previous_hash: string;
      hash: string;
    }[]
  >;
  verifyAudit(): Awaitable<boolean>;
  close(): Awaitable<void>;
}
