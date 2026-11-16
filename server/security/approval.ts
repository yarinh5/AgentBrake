import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ActionRecord } from "../contracts.js";
import { canonical, digest } from "../store.js";
import type { OperatorIdentity } from "./operators.js";
export const reviewProofSchema = z
  .object({
    nonce: z.string().uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type ReviewProof = z.infer<typeof reviewProofSchema>;
export type ApprovalReceipt = {
  actorId: string;
  tenant: string;
  decision: "approve" | "reject";
  at: string;
  proof: ReviewProof;
};
export type ReviewContext = {
  actor: OperatorIdentity;
  proof?: ReviewProof;
  team: boolean;
};
export function reviewFingerprint(action: ActionRecord) {
  return digest(
    canonical({
      id: action.id,
      agentId: action.agentId,
      requestId: action.requestId,
      tool: action.tool,
      arguments: action.arguments,
      digest: action.digest,
      destination: action.destination,
      grantId: action.grantId,
      grantFingerprint: action.grantFingerprint,
      policyRevision: action.policyRevision,
      policyHash: action.policyHash,
      expiresAt: action.expiresAt,
      sandbox: action.sandbox,
      preview: action.preview ?? null,
    }),
  );
}
export function issueReview(action: ActionRecord): ReviewProof {
  return { nonce: randomUUID(), fingerprint: reviewFingerprint(action) };
}
export function matchesReview(action: ActionRecord, proof: ReviewProof) {
  return (
    !!action.review &&
    proof.nonce === action.review.nonce &&
    proof.fingerprint === action.review.fingerprint &&
    proof.fingerprint === reviewFingerprint(action)
  );
}
