import "dotenv/config";
import express from "express";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.js";
mkdirSync("data", { recursive: true });
if (!process.env.ADMIN_KEY)
  throw new Error("Run npm run setup first, then restart.");
if (
  Boolean(process.env.GITHUB_TOKEN) !== Boolean(process.env.GITHUB_REPOSITORY)
)
  throw new Error("Set both GITHUB_TOKEN and GITHUB_REPOSITORY, or neither.");
if (
  process.env.GITHUB_REPOSITORY &&
  !/^[\w.-]+\/[\w.-]+$/.test(process.env.GITHUB_REPOSITORY)
)
  throw new Error("Invalid GITHUB_REPOSITORY");
const system = createApp({
  databasePath: resolve("data/agentbrake.db"),
  adminKey: process.env.ADMIN_KEY,
  connections: {
    githubToken: process.env.GITHUB_TOKEN,
    githubRepository: process.env.GITHUB_REPOSITORY,
    databaseUrl: process.env.DATABASE_URL,
  },
});
// @ts-expect-error Shared Node build tooling is JavaScript.
import { developmentUi } from "../scripts/build-ui.mjs";
let ui: Awaited<ReturnType<typeof developmentUi>> | undefined;
if (process.argv.includes("--production")) {
  system.app.use(express.static(resolve("dist")));
  system.app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve("dist/index.html")),
  );
} else {
  ui = await developmentUi();
  system.app.use(ui.middleware);
}
const port = Number(process.env.PORT || 4310);
const server = system.app.listen(port, "127.0.0.1", () =>
  console.log(
    `AgentBrake: http://127.0.0.1:${port}\nAdministrator key: ADMIN_KEY in .env. Local workspace; external credentials stay on the server.`,
  ),
);
async function shutdown() {
  server.close();
  await ui?.close();
  await system.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
