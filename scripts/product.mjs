import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeEnvironment } from "./compose-environment.mjs";
import { loadCandidate } from './candidate-config.mjs';
import { loadEnterprise } from './enterprise-manifest.mjs';
import { prepareFixtureAccess as prepareRuntimeFileAccess } from './fixture-file-access.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Installation loading and authenticated backup preflight must resolve the same
// recipe identity, including legacy manifests that predate runtime profiles.
export async function productImages(runtimeProfile) {
  if (runtimeProfile !== undefined && runtimeProfile !== 'minimal-v1') throw Error('Unknown installation runtime profile');
  const images = JSON.parse(await readFile(join(root, 'infra/local/images.lock.json'), 'utf8')).images;
  const minimal = runtimeProfile === 'minimal-v1';
  const pinned = minimal ? JSON.parse(await readFile(join(root, 'infra/product/images.lock.json'), 'utf8')) : undefined;
  return {
    minimal,
    env: {
      NODE_IMAGE: minimal ? pinned.node.image : images.node.image,
      RUNTIME_DOCKERFILE: minimal ? 'infra/product/Dockerfile' : 'infra/local/Dockerfile',
      POSTGRES_IMAGE: minimal ? 'agentbrake-postgres:18-' + createHash('sha256').update(images.postgres.image).update(await readFile(join(root, 'infra/product/Postgres.Dockerfile'))).digest('hex').slice(0, 20) : images.postgres.image,
      POSTGRES_BASE_IMAGE: images.postgres.image,
      OPA_IMAGE: minimal ? 'agentbrake-opa:1.22.4-' + createHash('sha256').update(await readFile(join(root, 'infra/product/Opa.Dockerfile'))).digest('hex').slice(0, 20) : images.opa.image,
    },
  };
}
export async function productConfig(name = "local") {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name))
    throw Error(
      "Installation name must be 1-32 lower-case letters, digits or hyphens",
    );
  const dir = join(root, ".agentbrake-local", "product-" + name);
  const config = JSON.parse(
    await readFile(join(dir, "installation.json"), "utf8"),
  );
  if (
    config.name !== name ||
    !/^\d+$/.test(String(config.port)) ||
    config.port < 1024 ||
    config.port > 65535 ||
    !/^[a-f0-9-]{36}$/.test(config.id)
  )
    throw Error("Invalid local installation manifest");
  const images = await productImages(config.runtimeProfile);
  if(config.enterpriseRequired!==undefined&&config.enterpriseRequired!==true)throw Error('Invalid enterprise requirement marker');
  if(config.enterpriseIdentityRequired!==undefined&&(config.enterpriseIdentityRequired!==true||config.enterpriseRequired!==true))throw Error('Invalid enterprise identity requirement marker');
  const candidate = await loadCandidate({ name, dir, id: config.id });
  const enterprise = await loadEnterprise({name,dir,id:config.id,candidate});
  return {
    name,
    dir,
    id: config.id,
    port: config.port,
    project: "agentbrake-product-" + name,
    candidate,
    enterprise,
    enterpriseRequired: config.enterpriseRequired === true,
    enterpriseIdentityRequired: config.enterpriseIdentityRequired === true,
    minimal: images.minimal,
    env: {
      ...process.env,
      COMPOSE_PROJECT_NAME: "agentbrake-product-" + name,
      INSTALLATION_ID: config.id,
      INSTALL_DIR: dir.replaceAll("\\", "/"),
      DASHBOARD_PORT: String(config.port),
      PRODUCT_RUNTIME_GID: process.platform === 'linux' ? String(process.getgid()) : '1000',
      ENTERPRISE_REQUIRED: config.enterpriseRequired === true ? '1' : '0',
      ENTERPRISE_IDENTITY_REQUIRED: config.enterpriseIdentityRequired === true ? '1' : '0',
      ...images.env,
      NEXT_TELEMETRY_DISABLED: "1",
      ...(candidate?.httpsOrigin ? { AGENTBRAKE_PUBLIC_ORIGIN: candidate.httpsOrigin } : {}),
    },
  };
}
export async function initializeProduct(name = "local", port = 4310) {
  if (
    !/^[a-z][a-z0-9-]{0,31}$/.test(name) ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535
  )
    throw Error("Invalid installation name or loopback port");
  const dir = join(root, ".agentbrake-local", "product-" + name);
  await mkdir(dirname(dir), { recursive: true });
  await mkdir(dir, { mode: 0o700 });
  const id = randomUUID(),
    secrets = {};
  for (const key of [
    "session-key",
    "binding-key",
    "bridge-key",
    "opa-token",
    "target-token",
    "observer-token",
    "control-password",
    "control-owner-password",
    "postgres-bootstrap",
    "target-read-password",
    "target-write-password",
  ]) {
    secrets[key] = randomBytes(32).toString("hex");
    await writeFile(join(dir, key), secrets[key], { mode: 0o600, flag: "wx" });
  }
  const operators = ["administrator", "operator", "approver", "viewer"].map(
    (role) => ({
      id: role,
      name: "Local " + role,
      tenant: "local",
      role,
      key: randomBytes(32).toString("hex"),
    }),
  );
  await writeFile(
    join(dir, "operators.json"),
    JSON.stringify(operators, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(
    join(dir, "opa-auth.json"),
    JSON.stringify({ agentbrake_auth: { token: secrets["opa-token"] } }),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(
    join(dir, "installation.json"),
    JSON.stringify(
      {
        schema: 1,
        runtimeProfile: 'minimal-v1',
        name,
        id,
        port,
        createdAt: new Date().toISOString(),
        scope: "local synthetic fixture only",
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(
    join(dir, "mcp-client.example.json"),
    JSON.stringify(
      {
        mcpServers: {
          agentbrake: {
            url: "http://gateway:4313/mcp",
            bearer_token_env_var: "AGENTBRAKE_TOKEN",
          },
        },
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  const config = await productConfig(name);
  await prepareProduct(config);
  return config;
}
export async function prepareProduct(config) {
  const hash = createHash("sha256");
  for (const file of ["agentbrake.rego", "authz.rego"])
    hash.update(await readFile(join(root, "services/policy", file)));
  const token = (await readFile(join(config.dir, "opa-token"), "utf8")).trim();
  await writeFile(
    join(config.dir, "opa-auth.json"),
    JSON.stringify({
      agentbrake_auth: { token },
      agentbrake_meta: { policy_hash: hash.digest("hex") },
    }),
    { mode: 0o600 },
  );
  // Docker bind mounts retain Linux ownership. Grant only the explicit runtime
  // group read access to files actually mounted into services. The host parent
  // stays owner-only; operator metadata, recovery keys and input keys stay0600.
  const access = process.platform === 'linux' ? await prepareRuntimeFileAccess(config.dir, [
    'operators.json', 'session-key', 'binding-key', 'bridge-key', 'opa-token',
    'target-token', 'observer-token', 'control-password', 'control-owner-password',
    'postgres-bootstrap', 'target-read-password', 'target-write-password', 'opa-auth.json',
    ...(config.candidate?.httpsOrigin ? ['tls-cert.pem', 'tls-key.pem'] : []),
    ...(config.candidate?.github ? ['github-app.json', 'github-app-key.pem'] : []),
    ...(config.enterprise ? ['enterprise.json', 'enterprise-manifest.json', 'enterprise-egress.json'] : []),
  ], []) : { group: '1000' };
  config.env.PRODUCT_RUNTIME_GID = access.group;
}
export async function dockerProduct(
  config,
  args,
  { capture = false, input, timeoutMs = 300000, maxOutputBytes = 4000000 } = {},
) {
  if (
    !Number.isInteger(maxOutputBytes) ||
    maxOutputBytes < 1 ||
    maxOutputBytes > 64 * 1024 * 1024
  )
    throw Error("Invalid Docker output limit");
  const dockerConfig = join(root, ".agentbrake-local/docker-public");
  await mkdir(dockerConfig, { recursive: true });
  const prefix = [
    "--config",
    dockerConfig,
    ...(process.platform === "win32"
      ? ["--host", "npipe:////./pipe/docker_engine"]
      : []),
  ];
  return new Promise((resolveResult, reject) => {
    let output = "",
      errorOutput = "";
    const child = spawn("docker", [...prefix, ...args], {
      cwd: root,
      env: composeEnvironment(config.env),
      windowsHide: true,
      stdio: [
        input === undefined ? "ignore" : "pipe",
        capture ? "pipe" : "inherit",
        capture ? "pipe" : "inherit",
      ],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(Error("Local Docker command deadline exceeded"), {
        output,
        errorOutput,
        timedOut: true,
      }));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output) > maxOutputBytes) child.kill();
    });
    child.stderr?.on("data", (chunk) => {
      errorOutput += chunk;
      if (errorOutput.length > 4000000) child.kill();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(
          Object.assign(Error("Local Docker command failed (" + code + ")"), {
            output,
            errorOutput,
          }),
        );
      else resolveResult(output);
    });
    child.stdin?.on("error", (error) => {
      clearTimeout(timer);
      child.kill();
      reject(Error("Local Docker input failed"));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}
export const composeProduct = (config, args, options) =>
  dockerProduct(
    config,
    [
      "compose",
      "-p",
      config.project,
      "-f",
      join(root, "infra/product/compose.yaml"),
      ...(config.minimal ? ['-f', join(root, 'infra/product/minimal.compose.yaml')] : []),
      ...(config.candidate?.httpsOrigin ? ['-f', join(root, 'infra/product/https.compose.yaml')] : []),
      ...(config.candidate?.github ? ['-f', join(root, 'infra/product/github.compose.yaml')] : []),
      ...(config.enterprise ? ['-f', join(root, 'infra/product/enterprise.compose.yaml')] : []),
      ...(config.verificationComposeFiles ?? []).flatMap(file => ['-f', file]),
      ...args,
    ],
    options,
  );
async function main() {
  const [command = "status", name = "local", ...extra] = process.argv.slice(2);
  if (command === "init") {
    const config = await initializeProduct(name, Number(extra[0] ?? 4310));
    console.log(
      "Created local fixture installation " +
        config.name +
        ". Operator login keys: " +
        join(config.dir, "operators.json"),
    );
    return;
  }
  if (command === "restore") {
    const { restoreProduct } = await import("./product-maintenance.mjs");
    console.log(
      JSON.stringify(
        await restoreProduct(
          extra[0],
          extra[1],
          name,
          Number(extra[2] ?? 4319),
        ),
        null,
        2,
      ),
    );
    return;
  }
  const config = await productConfig(name);
  if (command === "start") {
    const { startProduct, withMaintenance } =
      await import("./product-maintenance.mjs");
    await withMaintenance(config, () => startProduct(config));
    console.log("Dashboard: " + (config.candidate?.httpsOrigin ?? "http://127.0.0.1:" + config.port));
  } else if (command === "stop") {
    const { withMaintenance } = await import("./product-maintenance.mjs");
    await withMaintenance(config, () =>
      composeProduct(config, ["--profile", "agent", "down"]),
    );
  } else if (command === "backup") {
    const { backupProduct } = await import("./product-maintenance.mjs");
    console.log(JSON.stringify(await backupProduct(config), null, 2));
  } else if (command === "doctor" || command === "diagnostics") {
    const { doctorProduct } = await import("./product-maintenance.mjs");
    const report = await doctorProduct(config);
    if (command === "diagnostics") {
      const output = join(
        root,
        ".agentbrake-local",
        "diagnostics-" + name + "-" + Date.now() + ".json",
      );
      await writeFile(output, JSON.stringify(report, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
      console.log(output);
    } else console.log(JSON.stringify(report, null, 2));
  } else if (command === "status") await composeProduct(config, ["ps"]);
  else if (command === "reset") {
    if (extra[0] !== "--confirm=" + config.id)
      throw Error(
        "Reset destroys only this installation data. Require --confirm=" +
          config.id,
      );
    const { withMaintenance } = await import("./product-maintenance.mjs");
    await withMaintenance(config, () =>
      composeProduct(config, ["--profile", "agent", "down", "--volumes"]),
    );
    console.log("Removed installation volumes; operator credentials retained.");
  } else if (command === "credentials")
    console.log(join(config.dir, "operators.json"));
  else
    throw Error(
      "Use init/start/stop/status/doctor/diagnostics/backup/restore/credentials/reset [installation-name]",
    );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
