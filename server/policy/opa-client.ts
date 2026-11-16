import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  POLICY_VERSION,
  policyInputSchema,
  decisionSchema,
  type PolicyInput,
  type PolicyDecision,
  type PolicyEvaluator,
} from "./contracts.js";
export function policyHash() {
  return createHash("sha256")
    .update(
      readFileSync(
        new URL("../../services/policy/agentbrake.rego", import.meta.url),
      ),
    )
    .update(
      readFileSync(
        new URL("../../services/policy/authz.rego", import.meta.url),
      ),
    )
    .digest("hex");
}
export class OpaEvaluator implements PolicyEvaluator {
  constructor(
    private options: { url?: string; token?: string; timeoutMs?: number } = {
      url: process.env.OPA_URL,
      token: process.env.OPA_TOKEN,
    },
  ) {}
  async evaluate(input: PolicyInput): Promise<PolicyDecision> {
    const hash = policyHash();
    const deny = (reason_code: string): PolicyDecision => ({
      effect: "DENY",
      reason_code,
      decision_id: input.decision_id,
      policy_version: POLICY_VERSION,
      policy_hash: hash,
    });
    if (!policyInputSchema.safeParse(input).success)
      return deny("invalid-policy-input");
    if (!this.options.url || !this.options.token)
      return deny("pdp-unavailable");
    try {
      const url = new URL("/v1/data/agentbrake/decision", this.options.url);
      if (
        url.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "opa"].includes(url.hostname) ||
        url.username ||
        url.password
      )
        return deny("pdp-invalid-configuration");
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 250),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.token}`,
        },
        body: JSON.stringify({ input }),
      });
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("application/json")
      )
        return deny("pdp-error");
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16384) {
          await reader.cancel();
          return deny("pdp-invalid-response");
        }
        chunks.push(value);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const result = decisionSchema.safeParse(body.result);
      if (
        !result.success ||
        result.data.decision_id !== input.decision_id ||
        result.data.policy_hash !== hash
      )
        return deny("pdp-invalid-response");
      return result.data;
    } catch (error) {
      return deny(
        error instanceof Error &&
          ["TimeoutError", "AbortError"].includes(error.name)
          ? "pdp-timeout"
          : "pdp-unavailable",
      );
    }
  }
}
