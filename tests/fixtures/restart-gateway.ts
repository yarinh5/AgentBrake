// Disposable child used by transport/restart tests, never a user data directory.
import { createApp } from "../../server/app.js";
if (process.env.AGENTBRAKE_RESTART_TEST !== "1")
  throw Error("Test fixture only");
const system = createApp({
  databasePath: process.env.FIXTURE_DATABASE!,
  adminKey: process.env.FIXTURE_ADMIN!,
  connections: {
    fixture: {
      url: process.env.FIXTURE_TARGET!,
      token: process.env.FIXTURE_TOKEN!,
    },
  },
});
const server = system.app.listen(0, "127.0.0.1", () =>
  process.send?.({ port: (server.address() as { port: number }).port }),
);
process.on("message", async (message) => {
  if (message === "close") {
    server.closeAllConnections();
    server.close();
    await system.close();
    process.exit(0);
  }
});
