import { readFile } from "node:fs/promises";
import { PostgresStore } from "../../server/postgres-store.js";
if (
  process.env.AGENTBRAKE_PRODUCT !== "1" ||
  process.env.AGENTBRAKE_ROLE !== "control"
)
  throw Error("Recovery requires the installation maintenance control process");
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 200) throw Error("Invalid recovery envelope");
}
const { backupId } = JSON.parse(input);
if (typeof backupId !== "string" || !/^[a-f0-9-]{36}$/.test(backupId))
  throw Error("Invalid backup identifier");
const password = (
  await readFile("/run/secrets/control-password", "utf8")
).trim();
const store = await PostgresStore.open(
  "postgresql://control_runtime:" +
    password +
    "@control-db:5432/agentbrake_control_fixture",
  { reconcile: true },
);
try {
  await store.setPaused(true);
  const identity = await store.changeIdentity((state) => {
    const invalidatedInvitations = state.invitations.length;
    const invalidatedRecoveries = state.recoveries.length;
    state.invitations = [];
    state.recoveries = [];
    for (const account of state.accounts) account.revision++;
    return {
      result: { invalidatedInvitations, invalidatedRecoveries },
      audit: {
        type: "recovery.identity-authority-invalidated",
        details: {
          backupId,
          invalidatedInvitations,
          invalidatedRecoveries,
          source: "local-maintenance",
        },
      },
    };
  });
  const agents = await store.agents();
  for (const agent of agents)
    await store.changeAgent(
      agent.id,
      {
        status: "paused",
        ...(agent.grant ? { grant: { ...agent.grant, revoked: true } } : {}),
      },
      "recovery.grant-revoked",
    );
  let blocked = 0;
  for (const action of await store.actions())
    if (action.status === "pending") {
      await store.blockPending({
        ...action,
        rule: "recovery-suspension",
        reason: "Restored review requires a new task and independent review.",
      });
      blocked++;
    }
  await store.audit("recovery.completed", {
    backupId,
    agentsRevoked: agents.length,
    pendingBlocked: blocked,
    paused: true,
    ...identity,
  });
  if (!(await store.verifyAudit()))
    throw Error("Recovered audit chain is invalid");
  console.log(
    JSON.stringify({
      paused: true,
      agentsRevoked: agents.length,
      pendingBlocked: blocked,
      auditValid: true,
    }),
  );
} finally {
  await store.close();
}
