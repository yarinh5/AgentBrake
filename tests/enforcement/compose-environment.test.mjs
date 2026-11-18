import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { composeProduct } from "../../scripts/product.mjs";
import { composeEnvironment } from "../../scripts/compose-environment.mjs";
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";

// A clean checkout has no ignored runtime directory; each fixture owns setup.
await mkdir(resolve('.agentbrake-local'), { recursive: true, mode: 0o700 });

async function cleanup(dir) {
  assert.equal(dirname(resolve(dir)), resolve(".agentbrake-local"));
  assert.match(basename(dir), /^env-contract-[a-zA-Z0-9]+$/);
  await rm(dir, { recursive: true, force: true });
}

test("actual product Compose launcher ignores inherited synthetic envfile selectors", async () => {
  const dir = await mkdtemp(resolve(".agentbrake-local/env-contract-"));
  try {
    const selected = join(dir, "selected.env");
    await writeFile(selected, 'INVALID="unterminated');
    const env = {
      ...process.env,
      COMPOSE_PROJECT_NAME: "agentbrake-env-contract",
      INSTALLATION_ID: "synthetic-env-contract",
      INSTALL_DIR: dir.replaceAll("\\", "/"),
      DASHBOARD_PORT: "4327",
      NODE_IMAGE: "node:22",
      POSTGRES_IMAGE: "postgres:17",
      OPA_IMAGE: "openpolicyagent/opa:1",
      COMPOSE_ENV_FILES: selected,
      COMPOSE_DISABLE_ENV_FILE: "false",
    };
    for (const name of [
      "RESULT_RETENTION_HOURS",
      "LOG_MAX_SIZE",
      "LOG_MAX_FILES",
    ])
      delete env[name];
    const config = { project: "agentbrake-env-contract", env };
    const parsed = JSON.parse(
      await composeProduct(config, ["config", "--format", "json"], {
        capture: true,
      }),
    );
    assert.equal(parsed.name, config.project);
    assert.equal(
      parsed.services.gateway.environment.RESULT_RETENTION_HOURS,
      "24",
    );
    assert.equal(parsed.services.gateway.logging.options["max-size"], "10m");
    assert.equal(parsed.services.gateway.logging.options["max-file"], "3");
    config.env = {
      ...env,
      RESULT_RETENTION_HOURS: "48",
      LOG_MAX_SIZE: "7m",
      LOG_MAX_FILES: "2",
    };
    const intentional = JSON.parse(
      await composeProduct(config, ["config", "--format", "json"], {
        capture: true,
      }),
    );
    assert.equal(
      intentional.services.gateway.environment.RESULT_RETENTION_HOURS,
      "48",
    );
    assert.equal(
      intentional.services.gateway.logging.options["max-size"],
      "7m",
    );
    assert.equal(intentional.services.gateway.logging.options["max-file"], "2");
  } catch (error) {
    throw new Error(error.errorOutput ?? error.message, { cause: error });
  } finally {
    await cleanup(dir);
  }
});

test("shared verifier/product environment ignores default .env and preserves explicit inputs in real Compose config", async () => {
  const dir = await mkdtemp(resolve(".agentbrake-local/env-contract-"));
  try {
    const dockerConfig = join(dir, "docker-public");
    await mkdir(dockerConfig);
    const composeFile = join(dir, "compose.yaml");
    await writeFile(
      composeFile,
      "services:\n  canary:\n    image: node:22\n    environment:\n      CANARY: ${CANARY:-isolated}\n      RESULT_RETENTION_HOURS: ${RESULT_RETENTION_HOURS:-24}\n      LOG_MAX_SIZE: ${LOG_MAX_SIZE:-10m}\n      LOG_MAX_FILES: ${LOG_MAX_FILES:-3}\n",
    );
    const env = { ...process.env, COMPOSE_DISABLE_ENV_FILE: "false" };
    for (const key of Object.keys(env))
      if (
        /^(COMPOSE_ENV_FILES|COMPOSE_FILE|COMPOSE_PROFILES|CANARY|RESULT_RETENTION_HOURS|LOG_MAX_SIZE|LOG_MAX_FILES)$/i.test(
          key,
        )
      )
        delete env[key];
    const args = [
      "--config",
      dockerConfig,
      ...(process.platform === "win32"
        ? ["--host", "npipe:////./pipe/docker_engine"]
        : []),
      "compose",
      "-p",
      "agentbrake-env-contract",
      "-f",
      composeFile,
      "config",
      "--format",
      "json",
    ];
    const run = (childEnv) =>
      spawnSync("docker", args, {
        cwd: dir,
        env: childEnv,
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
      });
    await writeFile(
      join(dir, ".env"),
      "CANARY=unrelated-fixture-canary\nRESULT_RETENTION_HOURS=876\nLOG_MAX_SIZE=91m\nLOG_MAX_FILES=87\n",
    );
    const ordinary = run(env);
    assert.equal(ordinary.status, 0, ordinary.stderr);
    assert.equal(
      JSON.parse(ordinary.stdout).services.canary.environment.CANARY,
      "unrelated-fixture-canary",
      "Probe must demonstrate discovery would occur without isolation",
    );
    const isolated = run(composeEnvironment(env));
    assert.equal(isolated.status, 0, isolated.stderr);
    assert.deepEqual(JSON.parse(isolated.stdout).services.canary.environment, {
      CANARY: "isolated",
      RESULT_RETENTION_HOURS: "24",
      LOG_MAX_SIZE: "10m",
      LOG_MAX_FILES: "3",
    });
    await writeFile(join(dir, ".env"), 'INVALID="unterminated');
    assert.notEqual(
      run(env).status,
      0,
      "Malformed synthetic default file must make an unintended read observable",
    );
    const intentional = run(
      composeEnvironment({
        ...env,
        COMPOSE_ENV_FILES: join(dir, ".env"),
        RESULT_RETENTION_HOURS: "48",
        LOG_MAX_SIZE: "7m",
        LOG_MAX_FILES: "2",
      }),
    );
    assert.equal(intentional.status, 0, intentional.stderr);
    assert.deepEqual(
      JSON.parse(intentional.stdout).services.canary.environment,
      {
        CANARY: "isolated",
        RESULT_RETENTION_HOURS: "48",
        LOG_MAX_SIZE: "7m",
        LOG_MAX_FILES: "2",
      },
    );
  } finally {
    await cleanup(dir);
  }
});
