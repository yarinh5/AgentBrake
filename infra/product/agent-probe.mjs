// Test-client process running with only the product's agent network and ephemeral stdin token.
import { connect } from "node:net";
import { readdir } from "node:fs/promises";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks));
if (input.kind === "request") {
  const response = await fetch("http://gateway:4313" + input.path, {
    method: input.body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + input.token,
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  console.log(
    JSON.stringify({ status: response.status, body: await response.json() }),
  );
} else if (input.kind === "isolation") {
  const connectable = (host, port) =>
    new Promise((resolve) => {
      const socket = connect({ host, port });
      let done = false;
      const end = (value) => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(1200, () => end(false));
      socket.on("connect", () => end(true));
      socket.on("error", () => end(false));
    });
  const probes = [];
  for (const probe of input.probes)
    probes.push({
      ...probe,
      reachable: await connectable(probe.host, probe.port),
    });
  console.log(
    JSON.stringify({
      probes,
      secrets: await readdir("/run/secrets").catch(() => []),
    }),
  );
} else throw Error("Unsupported verifier operation");
