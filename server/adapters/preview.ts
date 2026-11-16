import { z } from "zod";
import type { ActionPreview } from "../contracts.js";
const rowSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(["active", "paused"]),
  version: z.number().int().nonnegative(),
});
export function databasePreview(row: unknown, status: unknown): ActionPreview {
  const before = rowSchema.parse(row),
    after = {
      ...before,
      status: z.enum(["active", "paused"]).parse(status),
      version: before.version + 1,
    };
  return {
    kind: "database-update",
    summary: "Change one fixture customer status",
    details: { template: "customer-status-v1", before, after, maximumRows: 1 },
  };
}
export function expectedVersion(preview?: ActionPreview): number | undefined {
  return preview?.kind === "database-update"
    ? rowSchema.parse(preview.details.before).version
    : undefined;
}
