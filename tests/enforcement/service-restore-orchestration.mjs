// Run by product-recovery.test.mjs with VM modules enabled. The maintenance
// source, filesystem, product config/preparation and backup validation are real.
// Only Docker transport is simulated; this is not a live recovery/data test.
import assert from "node:assert/strict";
import { SourceTextModule, SyntheticModule } from "node:vm";
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { root } from "../../scripts/opa-runtime.mjs";
import * as product from "../../scripts/product.mjs";
const { productConfig } = product;
import { encryptBackup } from "../../scripts/backup-format.mjs";

const scenario = process.argv[2];
assert.ok(["build-failure", "recovery-failure", "success", "minimal-success", "minimal-image-mismatch", "unknown-profile", "ordinary-start"].includes(scenario));
const name = "verify-recovery-" + randomUUID().slice(0, 8);
const dir = join(root, ".agentbrake-local", "product-" + name);
const scratch = await mkdtemp(join(root, ".agentbrake-local/recovery-test-"));
const barrier = join(dir, "recovery-incomplete.json");
const installationId = randomUUID();
const backupId = randomUUID();
const copied = [];
const composeCalls = [];
const barrierObservations = [];
const startupObservations = [];
let recoveryRan = false;
let recovered = false;
let dockerCalls = 0;
const present = async (path) => stat(path).then(() => true, (e) => {
  if (e.code === "ENOENT") return false;
  throw e;
});
const fullStartup = (args) => args.includes("up") && args.includes("--profile") && args.includes("agent");
const images = JSON.parse(await readFile(join(root, "infra/local/images.lock.json"), "utf8")).images;
const dockerProduct = async (config, args) => {
  dockerCalls++;
  if (args[0] === "volume" && args[1] === "inspect") {
    return JSON.stringify([{ Name: args[2], Labels: {
      "com.agentbrake.product": installationId,
      "com.docker.compose.project": config.project,
    } }]);
  }
  if (args[0] === "run") {
    assert.equal(args.at(-2), "restore");
    barrierObservations.push(await present(barrier));
    copied.push(args.find((a) => a.startsWith("type=volume,")));
    return JSON.stringify({ restored: 1 });
  }
  if (["ps", "volume", "network"].includes(args[0])) return "";
  throw Error("Unexpected Docker operation: " + args.join(" "));
};
const composeProduct = async (config, args) => {
  composeCalls.push(args);
  if (args[0] === "create") barrierObservations.push(await present(barrier));
  if (args[0] === "build" && args[1] === "control-api" && scenario === "build-failure") {
    assert.equal(copied.length, 3);
    throw Error("Injected control image build failure after volume copies");
  }
  if (args.includes("infra/product/recovery.ts")) {
    recoveryRan = true;
    barrierObservations.push(await present(barrier));
    assert.equal(composeCalls.some(fullStartup), false, "No application startup before recovery");
    if (scenario === "recovery-failure") throw Error("Injected failure during recovery/audit validation");
    recovered = true;
    return JSON.stringify({ paused: true, auditValid: true, agentsRevoked: 1, pendingBlocked: 1 });
  }
  if (fullStartup(args)) startupObservations.push({ recovered, barrier: await present(barrier) });
  return "";
};

try {
  const key = randomBytes(32);
  const file = join(scratch, "backup.abk");
  const keyFile = join(scratch, "key");
  const payload = {
    format: "agentbrake-cold-backup", schema: 1, id: backupId,
    installation: { schema: 1, id: installationId, name: "source", port: 4310 },
    postgresImage: images.postgres.image,
    files: Object.fromEntries([
      "session-key", "binding-key", "bridge-key", "opa-token", "target-token",
      "observer-token", "control-password", "control-owner-password", "postgres-bootstrap",
      "target-read-password", "target-write-password", "operators.json",
    ].map((name) => [name, Buffer.from(name === "operators.json" ? "[]" : "synthetic").toString("base64")])),
    volumes: Object.fromEntries(["control-data", "target-data", "git-data"].map((name) => [name,
      gzipSync(JSON.stringify([{ path: "sentinel", type: "file", mode: 384,
        data: Buffer.from("synthetic " + name).toString("base64") }])).toString("base64"),
    ])),
  };
  if (scenario.startsWith("minimal-")) {
    payload.installation.runtimeProfile = "minimal-v1";
    payload.postgresImage = "agentbrake-postgres:18-" + createHash("sha256")
      .update(images.postgres.image)
      .update(await readFile(join(root, "infra/product/Postgres.Dockerfile")))
      .digest("hex").slice(0, 20);
    if (scenario === "minimal-image-mismatch") payload.postgresImage += "-different-recipe";
  }
  if (scenario === "unknown-profile") payload.installation.runtimeProfile = "unrecognized";
  await writeFile(file, encryptBackup(payload, key));
  await writeFile(keyFile, key);
  const module = new SourceTextModule(await readFile(join(root, "scripts/product-maintenance.mjs"), "utf8"));
  await module.link(async (specifier) => {
    const values = specifier === "./product.mjs"
      ? { ...product, dockerProduct, composeProduct }
      : specifier === "./opa-runtime.mjs" ? { root }
      : await import(specifier.startsWith("node:") ? specifier : new URL("../../scripts/" + specifier, import.meta.url));
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    });
  });
  await module.evaluate();
  const { restoreProduct, startProduct, withMaintenance } = module.namespace;
  if (scenario === "ordinary-start") {
    await mkdir(dir);
    await writeFile(join(dir, "installation.json"), JSON.stringify({ name, port: 4335, id: installationId }));
    await writeFile(join(dir, "opa-token"), "synthetic");
    const config = await productConfig(name);
    await withMaintenance(config, () => startProduct(config, { build: false }));
    assert.equal(composeCalls.filter(fullStartup).length, 1);
  } else if (scenario === "minimal-image-mismatch" || scenario === "unknown-profile") {
    await assert.rejects(restoreProduct(file, keyFile, name, 4335), scenario === "unknown-profile"
      ? /Unknown installation runtime profile/ : /exact PostgreSQL image/);
    assert.equal(await present(dir), false, "Preflight failure must not create destination");
    assert.equal(dockerCalls, 0, "Preflight failure must precede all Docker operations");
    assert.equal(composeCalls.length, 0);
  } else if (scenario === "success" || scenario === "minimal-success") {
    const result = await restoreProduct(file, keyFile, name, 4335);
    assert.equal(result.restoredFrom, backupId);
    assert.match(result.authority, /paused/);
    assert.equal(copied.length, 3);
    assert.equal(recoveryRan, true);
    assert.ok(barrierObservations.every(Boolean), "Barrier must protect creation, copies and recovery");
    assert.equal(await present(barrier), false);
    assert.equal(composeCalls.filter(fullStartup).length, 1);
    assert.deepEqual(startupObservations, [{ recovered: true, barrier: false }]);
    const restoredConfig = await productConfig(name);
    assert.equal(restoredConfig.env.POSTGRES_IMAGE, payload.postgresImage);
    assert.equal(restoredConfig.minimal, scenario === "minimal-success");
  } else {
    await assert.rejects(restoreProduct(file, keyFile, name, 4335), /destination retained stopped/);
    assert.equal(copied.length, 3);
    assert.equal(recoveryRan, scenario === "recovery-failure");
    assert.equal(await present(join(dir, "maintenance.lock")), false);
    assert.ok(composeCalls.some((args) => args.includes("stop")));
    const before = composeCalls.length;
    const config = await productConfig(name);
    const startError = await withMaintenance(config, () => startProduct(config, { build: false })).then(() => null, (error) => error);
    assert.equal(composeCalls.some(fullStartup), false);
    assert.match(startError?.message ?? "", /recovery.*incomplete|incomplete.*recovery/i);
    assert.equal(composeCalls.length, before, "Ordinary start must fail before any Docker command");
    assert.equal(await present(barrier), true, "Incomplete recovery barrier survives failure");
    assert.ok(barrierObservations.every(Boolean), "Barrier must protect creation, copies and recovery");
    // The retained manifest/data cannot be automatically retried or overwritten.
    await assert.rejects(restoreProduct(file, keyFile, name, 4335), { code: "EEXIST" });
    assert.equal(composeCalls.length, before);
  }
  console.log(JSON.stringify({ scenario, copiedVolumes: copied.length, recoveryRan, applicationStarts: composeCalls.filter(fullStartup).length }));
} finally {
  for (const path of [dir, scratch]) {
    assert.equal(dirname(resolve(path)), resolve(root, ".agentbrake-local"));
    assert.match(basename(path), /^(product-verify-recovery-|recovery-test-)[a-zA-Z0-9-]+$/);
    await rm(path, { recursive: true, force: true });
  }
}
