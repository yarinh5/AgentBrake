// Only the generated, local persistent Compose installation may use this entrypoint.
import { readFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { createApp } from "./app.js";
import { PostgresStore } from "./postgres-store.js";
import { OpaEvaluator } from "./policy/opa-client.js";
import { createGatewayBridge, RemoteGateway } from "./gateway-bridge.js";
import type { OperatorCredential } from "./security/operators.js";
import { LocalTelemetry } from "./telemetry.js";
import { githubAppConfigSchema } from './adapters/github-app-client.js';
if (process.env.AGENTBRAKE_PRODUCT !== "1")
  throw Error("Use the generated local product Compose installation");
const role = process.env.AGENTBRAKE_ROLE;
if (!["control", "gateway"].includes(role ?? ""))
  throw Error("Explicit product role required");
const secret = async (name: string) =>
  (await readFile("/run/secrets/" + name, "utf8")).trim();
const githubPublic = process.env.AGENTBRAKE_GITHUB_APP === '1'
  ? githubAppConfigSchema.omit({ privateKey: true }).parse(JSON.parse(await readFile('/run/config/github-app.json', 'utf8')))
  : undefined;
const store = await PostgresStore.open(
  "postgresql://control_runtime:" +
    (await secret("control-password")) +
    "@control-db:5432/agentbrake_control_fixture",
  { reconcile: role === "gateway" },
);
const bridgeKey = await secret("bridge-key");
const telemetry = new LocalTelemetry(role as "gateway" | "control", (line) =>
  process.stdout.write(line + "\n"),
);
const retentionHours = Number(process.env.RESULT_RETENTION_HOURS ?? 24);
if (
  !Number.isInteger(retentionHours) ||
  retentionHours < 1 ||
  retentionHours > 8760
)
  throw Error("Result retention must be1..8760 hours");
if (role === "gateway") {
  const prune = async () => {
    const count = await store.pruneResults(
      new Date(Date.now() - retentionHours * 3600000).toISOString(),
    );
    if (count)
      await store.audit("retention.results-pruned", { count, retentionHours });
  };
  await prune();
  setInterval(
    () =>
      void prune().catch(() =>
        console.error("Local result retention failed; retry at next interval"),
      ),
    3600000,
  ).unref();
}
if (role === "gateway") {
  const system = createApp({
    store,
    databasePath: ":memory:",
    surface: "gateway",
    telemetry,
    adminKey: await secret("binding-key"),
    allowedHosts: ["gateway", "gateway-control"],
    policy: new OpaEvaluator({
      url: "http://opa:8181",
      token: await secret("opa-token"),
    }),
    connections: {
      ...(githubPublic ? { githubApp: { ...githubPublic, privateKey: await secret('github-app-key.pem') } } : {}),
      fixture: {
        url: "http://mock-target:8080",
        token: await secret("target-token"),
      },
    },
    githubTransport: githubPublic ? async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== 'https://api.github.com') throw Error('Unsupported GitHub origin');
      return fetch(new URL(url.pathname + url.search, 'http://github-egress:8080'), init);
    } : undefined,
  });
  // Agent and protected interfaces cannot reach the private approval listener.
  const controlAddress = (await lookup("gateway-control", { family: 4 }))
    .address;
  const bridge = createGatewayBridge(system.gateway, bridgeKey).listen(
    4315,
    controlAddress,
  );
  const server = system.app.listen(4313, "0.0.0.0");
  const close = async () => {
    bridge.closeAllConnections();
    bridge.close();
    server.closeAllConnections();
    server.close();
    await system.close();
    process.exit(0);
  };
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
} else {
  const operators = JSON.parse(
    await secret("operators.json"),
  ) as OperatorCredential[];
  const system = createApp({
    store,
    databasePath: ":memory:",
    surface: "control",
    telemetry,
    mcp: {
      url: "http://gateway:4313/mcp",
      bearer_token_env_var: "AGENTBRAKE_TOKEN",
    },
    adminKey: await secret("session-key"),
    operators,
    managedAccounts: true,
    connectionModes: githubPublic ? { github: 'github-app-sandbox', repository: githubPublic.repository, database: 'sandbox' } : undefined,
    secureCookies: process.env.AGENTBRAKE_SECURE_COOKIES === '1',
    allowedHosts: ["control-api"],
    gateway: new RemoteGateway("http://gateway-control:4315", bridgeKey),
  });
  const server = system.app.listen(4314, "0.0.0.0");
  const close = async () => {
    server.closeAllConnections();
    server.close();
    await system.close();
    process.exit(0);
  };
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
}
