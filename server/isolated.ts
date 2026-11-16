// Container-only fixture launcher; no host .env, customer state, or real integrations.
import { readFile, writeFile } from "node:fs/promises";
import { createApp } from "./app.js";
import { OpaEvaluator } from "./policy/opa-client.js";
import { PostgresStore } from "./postgres-store.js";
const secret = async (name: string) =>
  (await readFile("/run/secrets/" + name, "utf8")).trim();
if (process.env.AGENTBRAKE_ISOLATED !== "1")
  throw new Error("Use the isolated AgentBrake compose project");
const store = await PostgresStore.open(
  "postgresql://control_runtime:" +
    (await secret("control-password")) +
    "@control-db:5432/agentbrake_control_fixture",
  { reconcile: true },
);
const system = createApp({
  store,
  databasePath: ":memory:",
  adminKey: await secret("admin-key"),
  allowedHosts: ["gateway"],
  policy: new OpaEvaluator({
    url: "http://opa:8181",
    token: await secret("opa-token"),
  }),
  connections: {
    fixture: {
      url: "http://mock-target:8080",
      token: await secret("target-token"),
    },
  },
});
const { agent, token } = await system.store.createAgent({
  name: "Isolated agent fixture",
  tools: [
    "database_read",
    "database_update",
    "github_read_file",
    "github_create_issue",
  ],
  resources: ["customers", "agentbrake/sandbox"],
  sandbox: true,
});
const expired = await system.store.createAgent({
  name: "Expired isolated fixture",
  tools: ["database_read"],
  resources: ["customers"],
  sandbox: true,
});
expired.agent.grant!.expires_at_ms = Date.now() - 1;
await system.store.saveAgent(expired.agent);
await writeFile(
  "/run/agent-credential.json",
  JSON.stringify({ agentId: agent.id, token, expiredToken: expired.token }),
);
const server = system.app.listen(4313, "0.0.0.0", () =>
  console.log("Isolated AgentBrake gateway ready"),
);
async function shutdown() {
  server.close();
  await system.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
