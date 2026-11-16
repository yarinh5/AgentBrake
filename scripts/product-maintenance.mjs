import {
  open,
  readFile,
  writeFile,
  mkdir,
  rm,
  stat,
  realpath,
} from "node:fs/promises";
import { resolve, dirname, join, sep } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { root } from "./opa-runtime.mjs";
import {
  productConfig,
  productImages,
  composeProduct,
  dockerProduct,
  prepareProduct,
} from "./product.mjs";
import { sourceManifest } from "./source-manifest.mjs";
import { encryptBackup, decryptBackup, BACKUP_MAX_BYTES } from "./backup-format.mjs";
import { productHealth } from './product-health.mjs';
import { validateSnapshot, SNAPSHOT_MAX_BYTES } from "../infra/product/volume-archive.mjs";

const requiredFiles = [
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
  "operators.json",
];
const volumeNames = ["control-data", "target-data", "git-data"];
const parseRows = (raw) =>
  !raw.trim()
    ? []
    : raw.trim().startsWith("[")
      ? JSON.parse(raw)
      : raw
          .trim()
          .split("\n")
          .map((s) => JSON.parse(s));
export async function installationStatus(config) {
  return parseRows(
    await composeProduct(
      config,
      ["--profile", "agent", "ps", "--all", "--format", "json"],
      { capture: true },
    ),
  );
}
export async function withMaintenance(config, work) {
  const path = join(config.dir, "maintenance.lock");
  let lock;
  try {
    lock = await open(path, "wx", 0o600);
  } catch (e) {
    if (e.code === "EEXIST")
      throw Error(
        "Installation maintenance is already active. Inspect maintenance.lock before manual recovery.",
      );
    throw e;
  }
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
    );
    return await work();
  } finally {
    await lock.close();
    await rm(path);
  }
}
async function safeLocalFile(path, mustExist = true) {
  const boundary = await realpath(join(root, ".agentbrake-local")),
    absolute = resolve(path);
  const actual = mustExist
    ? await realpath(absolute)
    : join(
        await realpath(dirname(absolute)),
        absolute.slice(dirname(absolute).length + 1),
      );
  if (!actual.startsWith(boundary + sep))
    throw Error(
      "Operation file must stay inside this workspace .agentbrake-local directory",
    );
  return actual;
}
async function volumeInfo(config, name) {
  const volume = config.project + "_" + name;
  const [info] = JSON.parse(
    await dockerProduct(config, ["volume", "inspect", volume], {
      capture: true,
    }),
  );
  if (
    info.Name !== volume ||
    info.Labels?.["com.agentbrake.product"] !== config.id ||
    info.Labels?.["com.docker.compose.project"] !== config.project
  )
    throw Error("Volume ownership mismatch");
  return volume;
}
async function volumeTransfer(config, name, operation, input) {
  const volume = await volumeInfo(config, name);
  const helper = join(root, "infra/product/volume-archive.mjs").replaceAll(
    "\\",
    "/",
  );
  return dockerProduct(
    config,
    [
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--pids-limit",
      "32",
      "--memory",
      "768m",
      "--user",
      name === "git-data" ? "1000:1000" : "70:70",
      "--mount",
      `type=volume,source=${volume},target=/volume${operation === "snapshot" ? ",readonly" : ""}`,
      "--mount",
      `type=bind,source=${helper},target=/tool/volume-archive.mjs,readonly`,
      "--entrypoint",
      "node",
      ...(input === undefined ? [] : ["-i"]),
      config.env.NODE_IMAGE,
      "/tool/volume-archive.mjs",
      operation,
      "/volume",
    ],
    {
      capture: true,
      input,
      maxOutputBytes: SNAPSHOT_MAX_BYTES,
      timeoutMs: 180000,
    },
  );
}
export async function migrateProduct(config) {
  await composeProduct(
    config,
    ["up", "-d", "--wait", "--wait-timeout", "120", "control-db", "target-db"],
    { capture: true },
  );
  const sql = await readFile(
    join(root, "infra/local/control-db/002-accounts.sql"),
    "utf8",
  );
  const checksum = createHash("sha256").update(sql).digest("hex");
  // The owner applies one idempotent forward migration under an advisory lock.
  // A changed previously recorded migration is an explicit release error.
  const body = sql
    .replace(/^\\set ON_ERROR_STOP on\s*/, "")
    .replace(/^BEGIN;\s*/, "")
    .replace(/COMMIT;\s*$/, "");
  const migration = `\\set ON_ERROR_STOP on\nBEGIN;\nSELECT pg_advisory_xact_lock(1478629042);\nCREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());\nREVOKE ALL ON schema_migrations FROM PUBLIC;\nDO $guard$ BEGIN IF EXISTS (SELECT 1 FROM schema_migrations WHERE name='002-accounts' AND sha256<>'${checksum}') THEN RAISE EXCEPTION 'Applied account migration checksum changed'; END IF; END $guard$;\n${body}\nINSERT INTO schema_migrations(name,sha256) VALUES ('002-accounts','${checksum}') ON CONFLICT(name) DO NOTHING;\nCOMMIT;\n`;
  await composeProduct(
    config,
    [
      "exec",
      "-T",
      "control-db",
      "psql",
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "-U",
      "control_owner",
      "-d",
      "agentbrake_control_fixture",
    ],
    { capture: true, input: migration },
  );
}
export async function startProduct(config, { build = true } = {}) {
  const recoveryIncomplete = await stat(
    join(config.dir, "recovery-incomplete.json"),
  ).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (recoveryIncomplete)
    throw Error(
      "Installation recovery is incomplete; ordinary start is blocked. Retain the destination for host-owner diagnosis.",
    );
  await prepareProduct(config);
  if (build) await composeProduct(config, ["build"]);
  await migrateProduct(config);
  await composeProduct(config, [
    "--profile",
    "agent",
    "up",
    "-d",
    "--wait",
    "--wait-timeout",
    "180",
  ]);
}
export async function backupProduct(config) {
  return withMaintenance(config, async () => {
    const status = await installationStatus(config),
      running = status
        .filter((s) => s.State === "running")
        .map((s) => s.Service);
    if (
      !status.some((s) => s.Service === "control-db") ||
      !status.some((s) => s.Service === "target-db")
    )
      throw Error("Initialize/start the installation before backup");
    for (const name of volumeNames) await volumeInfo(config, name);
    const keyFile = join(config.dir, "recovery-key");
    let key;
    try {
      key = await readFile(keyFile);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      key = randomBytes(32);
      await writeFile(keyFile, key, { mode: 0o600, flag: "wx" });
    }
    if (key.length !== 32) throw Error("Recovery key has invalid size");
    const files = {};
    for (const file of requiredFiles)
      files[file] = (await readFile(join(config.dir, file))).toString("base64");
    const installation = JSON.parse(
      await readFile(join(config.dir, "installation.json"), "utf8"),
    );
    let artifact;
    try {
      await composeProduct(
        config,
        ["--profile", "agent", "stop", "--timeout", "30"],
        { capture: true },
      );
      if ((await installationStatus(config)).some((s) => s.State === "running"))
        throw Error(
          "Backup requires every installation writer and database stopped",
        );
      const volumes = {};
      for (const name of volumeNames)
        volumes[name] = await volumeTransfer(config, name, "snapshot");
      const source = await sourceManifest();
      const packageData = {
        format: "agentbrake-cold-backup",
        schema: 1,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        sourceHash: source.sourceHash,
        postgresImage: config.env.POSTGRES_IMAGE,
        installation,
        files,
        volumes,
      };
      const outputDir = join(root, ".agentbrake-local/backups");
      await mkdir(outputDir, { recursive: true, mode: 0o700 });
      artifact = await safeLocalFile(
        join(outputDir, config.name + "-" + packageData.id + ".abk"),
        false,
      );
      await writeFile(artifact, encryptBackup(packageData, key), {
        mode: 0o600,
        flag: "wx",
      });
    } finally {
      key.fill(0);
      if (running.length)
        await composeProduct(
          config,
          [
            "--profile",
            "agent",
            "start",
            "--wait",
            "--wait-timeout",
            "180",
            ...running,
          ],
          { capture: true },
        );
    }
    return {
      file: artifact,
      keyFile,
      maintenance: "completed",
      sourceServicesResumed: running,
    };
  });
}
export async function inspectBackup(file, keyFile) {
  const path = await safeLocalFile(file),
    keyPath = await safeLocalFile(keyFile);
  if (
    (await stat(path)).size > BACKUP_MAX_BYTES ||
    (await stat(keyPath)).size !== 32
  )
    throw Error("Invalid backup or key size");
  const key = await readFile(keyPath);
  let value;
  try {
    value = decryptBackup(await readFile(path), key);
  } finally {
    key.fill(0);
  }
  if (
    value?.format !== "agentbrake-cold-backup" ||
    value.schema !== 1 ||
    !/^[a-f0-9-]{36}$/.test(value.id) ||
    !/^[a-f0-9-]{36}$/.test(value.installation?.id) ||
    typeof value.postgresImage !== "string" ||
    !value.files ||
    !value.volumes
  )
    throw Error("Unsupported backup package");
  if (
    Object.keys(value.files).sort().join() !==
      [...requiredFiles].sort().join() ||
    Object.keys(value.volumes).sort().join() !== [...volumeNames].sort().join()
  )
    throw Error("Incomplete backup package");
  for (const file of requiredFiles)
    if (
      typeof value.files[file] !== "string" ||
      value.files[file].length > 100000
    )
      throw Error("Invalid backup configuration");
  for (const name of volumeNames) validateSnapshot(value.volumes[name]);
  return value;
}
export async function restoreProduct(file, keyFile, name, port) {
  if (
    !/^[a-z][a-z0-9-]{0,31}$/.test(name) ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535
  )
    throw Error("Invalid restore installation name or port");
  // Authenticate and validate every archive entry before creating any destination.
  const data = await inspectBackup(file, keyFile);
  const images = await productImages(data.installation.runtimeProfile);
  if (images.env.POSTGRES_IMAGE !== data.postgresImage)
    throw Error(
      "Restore requires the exact PostgreSQL image recorded by backup",
    );
  const project = "agentbrake-product-" + name,
    probe = { env: { ...process.env } };
  const collisions = await dockerProduct(
    probe,
    [
      "ps",
      "-a",
      "-q",
      "--filter",
      "label=com.docker.compose.project=" + project,
    ],
    { capture: true },
  );
  const volumes = await dockerProduct(
    probe,
    [
      "volume",
      "ls",
      "-q",
      "--filter",
      "label=com.docker.compose.project=" + project,
    ],
    { capture: true },
  );
  const networks = await dockerProduct(
    probe,
    [
      "network",
      "ls",
      "-q",
      "--filter",
      "label=com.docker.compose.project=" + project,
    ],
    { capture: true },
  );
  const namedVolumes = new Set(
    (await dockerProduct(
      probe,
      ["volume", "ls", "-q", "--filter", "name=" + project + "_"],
      { capture: true },
    )).trim().split(/\r?\n/),
  );
  if (
    collisions.trim() || volumes.trim() || networks.trim() ||
    volumeNames.some((name) => namedVolumes.has(project + "_" + name))
  )
    throw Error(
      "Restore requires a new project with no containers, volumes or networks",
    );
  const dir = join(root, ".agentbrake-local/product-" + name);
  // A new directory is the overwrite guard. Never delete it automatically after failure.
  await mkdir(dir, { mode: 0o700 });
  // This outlives maintenance.lock and must precede any copied destination data.
  await writeFile(
    join(dir, "recovery-incomplete.json"),
    JSON.stringify({ schema: 1, backupId: data.id, createdAt: new Date().toISOString() }),
    { mode: 0o600, flag: "wx" },
  );
  for (const file of requiredFiles)
    await writeFile(join(dir, file), Buffer.from(data.files[file], "base64"), {
      mode: 0o600,
      flag: "wx",
    });
  await writeFile(
    join(dir, "installation.json"),
    JSON.stringify({
      ...data.installation,
      name,
      port,
      restoredFrom: data.id,
      restoredAt: new Date().toISOString(),
    }),
    { mode: 0o600, flag: "wx" },
  );
  const config = await productConfig(name);
  return withMaintenance(config, async () => {
    try {
      await prepareProduct(config);
      // Acquire volumes without running the metadata-changing initializer.
      // Validate before starting it, including volumes created after preflight.
      await composeProduct(config, ["create", "volume-init"], {
        capture: true,
      });
      for (const volume of volumeNames) await volumeInfo(config, volume);
      await composeProduct(
        config,
        [
          "up",
          "--no-deps",
          "--abort-on-container-exit",
          "--exit-code-from",
          "volume-init",
          "volume-init",
        ],
        { capture: true },
      );
      for (const volume of volumeNames)
        await volumeTransfer(config, volume, "restore", data.volumes[volume]);
      await migrateProduct(config);
      await composeProduct(config, ["build", "control-api"], { capture: true });
      await composeProduct(
        config,
        [
          "run",
          "--rm",
          "--no-deps",
          "-T",
          "control-api",
          "node",
          "--import",
          "tsx",
          "infra/product/recovery.ts",
        ],
        { capture: true, input: JSON.stringify({ backupId: data.id }) },
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
      // recovery.ts exits successfully only after authority suspension and
      // recovered audit-chain verification. Never clear this in failure cleanup.
      await rm(join(dir, "recovery-incomplete.json"));
      await startProduct(config);
      return {
        name,
        url: "http://127.0.0.1:" + port,
        restoredFrom: data.id,
        authority:
          "paused; all restored agent grants revoked; pending reviews blocked",
      };
    } catch (error) {
      await composeProduct(config, ["--profile", "agent", "stop"], {
        capture: true,
      }).catch(() => {});
      throw Error(
        "Restore did not complete; destination retained stopped for diagnosis. " +
          error.message,
      );
    }
  });
}
export async function doctorProduct(config) {
  const source = await sourceManifest(),
    rows = await installationStatus(config);
  const services = rows.map((r) => ({
    name: r.Service,
    state: r.State,
    health: r.Health || "not-configured",
  }));
  let http = "unavailable";
  try {
    http = await productHealth(config);
  } catch {}
  return {
    schema: 1,
    at: new Date().toISOString(),
    installation: config.name,
    url: config.candidate?.httpsOrigin ?? "http://127.0.0.1:" + config.port,
    sourceHash: source.sourceHash,
    services,
    http,
    scope:
      "Local private team installation; no target credentials or request contents included",
    nextSteps:
      http === "200"
        ? []
        : [
            "Run product.mjs start " + config.name,
            "Inspect this installation with product.mjs status " + config.name,
          ],
  };
}
