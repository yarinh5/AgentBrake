// Disposable local environment. Never load .env or open the pre-existing data directory.
import express from "express";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "./app.js";
const adminKey = randomBytes(32).toString("hex");
const system = createApp({ databasePath: ":memory:", adminKey });
// @ts-expect-error Shared Node build tooling is JavaScript.
import { developmentUi } from "../scripts/build-ui.mjs";
let ui: Awaited<ReturnType<typeof developmentUi>> | undefined;
if (process.argv.includes("--built")) {
  system.app.use(express.static(resolve("dist")));
  system.app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve("dist/index.html")),
  );
} else {
  ui = await developmentUi();
  system.app.use(ui.middleware);
}
const server = system.app.listen(4312, "127.0.0.1");
await new Promise<void>((res, rej) => {
  server.once("listening", res);
  server.once("error", rej);
});
const accessPath = resolve(".agentbrake-local/access.json");
await mkdir(resolve(".agentbrake-local"), { recursive: true });
await writeFile(
  accessPath,
  JSON.stringify(
    {
      url: "http://127.0.0.1:4312",
      adminKey,
      mode: "disposable synthetic fixtures; no external connectors",
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  `AgentBrake Stage 1: http://127.0.0.1:4312\nSign-in key: ${accessPath}\nAll state is in memory and is discarded on exit. OPA is a separate authenticated loopback process.`,
);
async function shutdown() {
  server.close();
  await ui?.close();
  await system.close();
  await unlink(accessPath).catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
