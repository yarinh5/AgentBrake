// Fixed TCP forwarding only; no destination from the request, no credentials or filesystem mounts.
// Required for loopback port publication on Docker 29 internal-network deployments.
import { createServer, connect } from "node:net";
const server = createServer({ maxConnections: 128 }, (client) => {
  const target = connect({ host: "dashboard", port: 3000 });
  const close = () => {
    client.destroy();
    target.destroy();
  };
  client.setTimeout(30000, close);
  target.setTimeout(30000, close);
  client.on("error", close);
  target.on("error", close);
  client.on("close", () => target.destroy());
  target.on("close", () => client.destroy());
  client.pipe(target);
  target.pipe(client);
});
server.listen(3000, "0.0.0.0");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
