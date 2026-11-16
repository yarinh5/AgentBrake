import { z } from "zod";
export const POLICY_VERSION = "stage2.v1";
export const AUDIENCE = "agentbrake-gateway";
export const grantSchema = z
  .object({
    id: z.string().uuid(),
    agent_id: z.string().uuid(),
    tenant: z.literal("local"),
    human_owner: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    actions: z.array(z.string()).min(1).max(10),
    resources: z.array(z.string()).min(1).max(10),
    environments: z.array(z.literal("sandbox")).length(1),
    expires_at_ms: z.number().int().positive(),
    revoked: z.boolean(),
    policy_version: z.literal(POLICY_VERSION),
    max_calls: z.number().int().min(1).max(1000),
    used_calls: z.number().int().min(0),
    max_rows: z.number().int().min(1).max(100),
  })
  .strict();
export type TaskGrant = z.infer<typeof grantSchema>;
export const policyInputSchema = z
  .object({
    decision_id: z.string().uuid(),
    now_ms: z.number().int().positive(),
    identity: z
      .object({
        agent_id: z.string().uuid(),
        tenant: z.literal("local"),
        audience: z.literal(AUDIENCE),
        expires_at_ms: z.number().int().positive(),
      })
      .strict(),
    grant: grantSchema,
    action: z
      .object({
        tool: z.string().max(100),
        rows: z.number().int().min(0).max(100),
      })
      .strict(),
    target: z
      .object({ id: z.string().max(120), environment: z.literal("sandbox") })
      .strict(),
    controls: z
      .object({
        paused: z.boolean(),
        agent_active: z.boolean(),
        tainted: z.boolean(),
        reads: z.enum(["allow", "approval", "deny"]),
        databaseWrites: z.enum(["approval", "deny"]),
        githubWrites: z.enum(["approval", "deny"]),
      })
      .strict(),
  })
  .strict();
export type PolicyInput = z.infer<typeof policyInputSchema>;
export const decisionSchema = z
  .object({
    effect: z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL"]),
    reason_code: z.string().regex(/^[a-z0-9-]{1,64}$/),
    decision_id: z.string().uuid(),
    policy_version: z.literal(POLICY_VERSION),
    policy_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type PolicyDecision = z.infer<typeof decisionSchema>;
export interface PolicyEvaluator {
  evaluate(input: PolicyInput): Promise<PolicyDecision>;
}
