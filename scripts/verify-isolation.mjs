import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { root } from "./opa-runtime.mjs";
import { sourceManifest } from "./source-manifest.mjs";
import { verifyModelCache } from "./verify-model-cache.mjs";
import { composeEnvironment } from "./compose-environment.mjs";
const milestoneB = process.argv.includes("--milestone-b");
const codexLock = milestoneB
  ? JSON.parse(
      await readFile(join(root, "infra/local/codex.lock.json"), "utf8"),
    )
  : null;
const dockerConfig = join(root, ".agentbrake-local/docker-public");
await mkdir(dockerConfig, { recursive: true });
const runId = randomUUID(),
  project = "agentbrake-a-" + runId.slice(0, 8);
const evidence = join(root, "docs/evidence", runId),
  runDir = join(root, ".agentbrake-local", "isolation-" + runId);
await mkdir(evidence, { recursive: true });
const manifest = await sourceManifest();
await writeFile(
  join(evidence, "source-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
const report = {
  runId,
  startedAt: new Date().toISOString(),
  project,
  sourceHash: manifest.sourceHash,
  gitCommit: null,
  result: "NOT_RUN",
  cases: [],
  commands: [],
  limitations: [
    "Synthetic local targets only. No host-admin or kernel-escape guarantee. Stage 2 target/control PostgreSQL and Git mock; no real GitHub or host-agent interception.",
  ],
};
const secrets = {};
let env = { ...process.env },
  attemptedUp = false;
const hash = (v) => createHash("sha256").update(v).digest("hex");
const redact = (s) =>
  Object.values(secrets).reduce(
    (text, secret) => text.replaceAll(secret, "[REDACTED]"),
    s,
  );
async function run(label, command, args, timeoutMs = 60000) {
  let output = "",
    timedOut = false;
  if (command === "docker")
    args = [
      "--config",
      dockerConfig,
      ...(process.platform === "win32"
        ? ["--host", "npipe:////./pipe/docker_engine"]
        : []),
      ...args,
    ];
  const startedAt = new Date().toISOString();
  const code = await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      env: composeEnvironment(env),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.once("error", (e) => {
      output += "spawn: " + e.message;
      clearTimeout(timer);
      resolve(1);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
  output = redact(output);
  await writeFile(join(evidence, label + ".log"), output);
  report.commands.push({
    label,
    command: [command, ...args],
    startedAt,
    exitCode: code,
    timedOut,
    log: label + ".log",
  });
  if (code !== 0)
    throw new Error(
      `${label} failed (exit ${code}${timedOut ? ", deadline" : ""}); see log`,
    );
  return output.trim();
}
const compose = (label, args, timeout) =>
  run(
    label,
    "docker",
    [
      "compose",
      "--project-name",
      project,
      "-f",
      "infra/local/compose.yaml",
      ...(milestoneB ? ["-f", "infra/local/codex.compose.yaml"] : []),
      ...args,
    ],
    timeout,
  );
const inspect = async (service) =>
  JSON.parse(
    await run("inspect-" + service, "docker", [
      "inspect",
      await compose("id-" + service, ["ps", "-q", service]),
    ]),
  )[0];
try {
  report.engine = JSON.parse(
    await run(
      "docker-preflight",
      "docker",
      ["version", "--format", "{{json .Server}}"],
      15000,
    ),
  );
  if (process.platform === "win32") {
    const version = await run(
      "desktop-version",
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "(Get-Item 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe').VersionInfo.ProductVersion",
      ],
      15000,
    );
    report.desktopVersion = version;
    const [major, minor, patch] = version.split(".").map(Number);
    if (
      major < 4 ||
      (major === 4 && (minor < 44 || (minor === 44 && patch < 3)))
    )
      throw new Error(
        "Desktop predates the CVE-2025-9074 engine-access fix; update before isolation acceptance",
      );
  }
  const images = JSON.parse(
    await readFile(join(root, "infra/local/images.lock.json"), "utf8"),
  );
  report.images = images;
  env = {
    ...env,
    COMPOSE_PROJECT_NAME: project,
    RUN_ID: runId,
    RUN_DIR: runDir.replaceAll("\\", "/"),
    NODE_IMAGE: images.images.node.image,
    POSTGRES_IMAGE: images.images.postgres.image,
    OPA_IMAGE: images.images.opa.image,
    ...(milestoneB
      ? {
          OLLAMA_IMAGE: codexLock.ollama.image,
          CODEX_VERSION: codexLock.codex.version,
          MODEL_DIR: join(root, ".tools/ollama-models").replaceAll("\\", "/"),
        }
      : {}),
  };
  await mkdir(runDir, { recursive: true });
  for (const name of [
    "admin-key",
    "opa-token",
    "target-token",
    "observer-token",
    "postgres-bootstrap",
    "target-read-password",
    "target-write-password",
    "control-password",
    "control-owner-password",
  ]) {
    secrets[name] = randomBytes(32).toString("hex");
    await writeFile(join(runDir, name), secrets[name], { mode: 0o600 });
  }
  report.policyHash = hash(
    Buffer.concat([
      await readFile(join(root, "services/policy/agentbrake.rego")),
      await readFile(join(root, "services/policy/authz.rego")),
    ]),
  );
  await writeFile(
    join(runDir, "opa-auth.json"),
    JSON.stringify({
      agentbrake_auth: { token: secrets["opa-token"] },
      agentbrake_meta: { policy_hash: report.policyHash },
    }),
    { mode: 0o600 },
  );
  await writeFile(join(runDir, "agent-credential.json"), "{}", { mode: 0o600 });
  if (milestoneB) {
    const modelManifest = await readFile(
      join(
        root,
        ".tools/ollama-models/manifests/registry.ollama.ai/library/qwen3/4b-instruct",
      ),
    );
    if (hash(modelManifest) !== codexLock.model.manifestSha256)
      throw Error(
        "Run setup-codex-local first; local model manifest does not match lock",
      );
    await writeFile(join(runDir, "codex-credential.json"), "{}", {
      mode: 0o600,
    });
    report.codexDependencies = codexLock;
    report.modelIntegrity = await verifyModelCache(
      join(root, ".tools/ollama-models"),
      codexLock.model.registryManifestSha256,
    );
  }
  await compose("compose-config", ["config", "--quiet"]);
  console.log("Building and starting the isolated AgentBrake fixture project…");
  attemptedUp = true;
  await compose(
    "compose-up",
    ["up", "-d", "--build", "--wait", "--wait-timeout", "120"],
    600000,
  );
  const agentCredential = JSON.parse(
    await readFile(join(runDir, "agent-credential.json"), "utf8"),
  );
  secrets.agentToken = agentCredential.token;
  secrets.expiredAgentToken = agentCredential.expiredToken;
  const agent = await inspect("agent"),
    target = await inspect("mock-target"),
    pg = await inspect("target-db"),
    control = await inspect("control-db"),
    opa = await inspect("opa"),
    gateway = await inspect("gateway");
  const protectedIp = (container) =>
    container.NetworkSettings.Networks[project + "_protected"].IPAddress;
  const edge = agent.NetworkSettings.Networks[project + "_agent"];
  const edgeNetwork = JSON.parse(
    await run("inspect-agent-network", "docker", [
      "network",
      "inspect",
      project + "_agent",
    ]),
  )[0];
  if (!edgeNetwork.Internal)
    throw new Error("Agent network allows external egress");
  if (Object.keys(agent.NetworkSettings.Networks).length !== 1 || !edge)
    throw new Error("Agent network is not isolated");
  if (
    agent.HostConfig.Privileged ||
    !agent.HostConfig.ReadonlyRootfs ||
    agent.Config.User !== "1000:1000" ||
    !agent.HostConfig.CapDrop.includes("ALL")
  )
    throw new Error("Agent hardening mismatch");
  if (
    agent.Mounts.length !== 1 ||
    agent.Mounts[0].Destination !== "/run/agent-credential.json" ||
    agent.Mounts[0].RW
  )
    throw new Error("Agent mount boundary mismatch");
  for (const container of [target, pg, control, opa])
    if (
      Object.values(container.NetworkSettings.Ports ?? {}).some(
        (value) => value?.length,
      )
    )
      throw new Error("Protected target has a published host port");
  report.boundaries = {
    agentNetworks: Object.keys(agent.NetworkSettings.Networks),
    agentUser: agent.Config.User,
    capDrop: agent.HostConfig.CapDrop,
    readonlyRoot: true,
    agentMounts: agent.Mounts.map((m) => ({
      destination: m.Destination,
      writable: m.RW,
    })),
    imageIds: [agent.Image, target.Image, pg.Image, opa.Image],
    gatewayPorts: gateway.NetworkSettings.Ports,
  };
  // Only this newly created fixture project is inspected; secrets are mounted
  // as files, never environment values. The run logger redacts known tokens.
  const addresses = {
    target: protectedIp(target),
    postgres: protectedIp(pg),
    control: protectedIp(control),
    opa: protectedIp(opa),
    edgeGateway: edgeNetwork.IPAM.Config.find((config) => config.Gateway)
      ?.Gateway,
  };
  const snapshot = async (label) =>
    JSON.parse(
      await compose(label, [
        "exec",
        "-T",
        "mock-target",
        "node",
        "--input-type=module",
        "-e",
        "import{readFile}from'node:fs/promises';const token=(await readFile('/run/secrets/observer-token','utf8')).trim();const response=await fetch('http://127.0.0.1:8080/snapshot',{headers:{Authorization:'Bearer '+token}});if(!response.ok)process.exit(1);console.log(await response.text())",
      ]),
    );
  const probe = async (phase) =>
    JSON.parse(
      await compose(
        "agent-" + phase,
        [
          "exec",
          "-T",
          "agent",
          "node",
          "tests/isolation/agent.mjs",
          phase,
          JSON.stringify(addresses),
        ],
        45000,
      ),
    );
  const before = await snapshot("before-network");
  report.cases.push(await probe("network"));
  const afterNetwork = await snapshot("after-network");
  if (JSON.stringify(before) !== JSON.stringify(afterNetwork))
    throw new Error("Direct probes changed target state/counter");
  report.cases.push(await probe("denied"));
  const afterDenied = await snapshot("after-denied");
  if (JSON.stringify(before) !== JSON.stringify(afterDenied))
    throw new Error("Denied action reached upstream");
  report.cases.push(await probe("allowed"));
  const afterAllowed = await snapshot("after-allowed");
  if (afterAllowed.calls !== before.calls + 1)
    throw new Error("Allowed read did not reach upstream exactly once");
  const { calls: oldCalls, ...stateBefore } = before,
    { calls: newCalls, ...stateAfter } = afterAllowed;
  if (JSON.stringify(stateBefore) !== JSON.stringify(stateAfter))
    throw new Error("Read changed target state");
  await compose("stop-opa", ["stop", "opa"]);
  report.cases.push(await probe("pdp-down"));
  const afterPdp = await snapshot("after-pdp-down");
  if (JSON.stringify(afterAllowed) !== JSON.stringify(afterPdp))
    throw new Error("PDP outage reached upstream");
  report.proof = {
    before,
    afterNetwork,
    afterDenied,
    afterAllowed,
    afterPdp,
    deniedUpstreamCalls: afterDenied.calls - before.calls,
    allowedUpstreamCalls: afterAllowed.calls - before.calls,
    pdpOutageUpstreamCalls: afterPdp.calls - afterAllowed.calls,
    schemaHash: hash(JSON.stringify(before.schema)),
    stateBeforeHash: hash(JSON.stringify(stateBefore)),
    stateAfterHash: hash(JSON.stringify(stateAfter)),
  };
  await compose("restart-opa", ["start", "opa"]);
  report.stage2 = JSON.parse(
    (
      await compose(
        "stage2-workflow",
        [
          "run",
          "--rm",
          "--no-deps",
          "verifier",
          "node",
          "tests/stage2/workflow.mjs",
        ],
        120000,
      )
    )
      .split("\n")
      .findLast((line) => line.startsWith("{")),
  );
  await compose(
    "stage2-postgres-tests",
    [
      "run",
      "--rm",
      "--no-deps",
      "verifier",
      "node",
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      "tests/stage2/postgres-target.test.ts",
      "tests/stage2/postgres-control.test.ts",
    ],
    120000,
  );
  if (milestoneB) {
    await compose(
      "git-container-tests",
      [
        "run",
        "--rm",
        "--no-deps",
        "verifier",
        "node",
        "--import",
        "tsx",
        "--test",
        "tests/stage2/git-fixture.test.ts",
      ],
      120000,
    );
    const operator = async (label, command) =>
      JSON.parse(
        (
          await compose(
            label,
            [
              "run",
              "--rm",
              "--no-deps",
              "verifier",
              "node",
              "tests/milestone-b/operator.mjs",
              command,
            ],
            180000,
          )
        )
          .split("\n")
          .findLast((line) => line.startsWith("{")),
      );
    report.benchmark = await operator("milestone-b-benchmark", "benchmark");
    report.codexProvision = await operator("codex-provision", "provision");
    secrets.codexToken = JSON.parse(
      await readFile(join(runDir, "codex-credential.json"), "utf8"),
    ).token;
    await compose("codex-build", ["build", "codex-agent"], 600000);
    await compose(
      "codex-up",
      [
        "--profile",
        "codex-verification",
        "up",
        "-d",
        "--no-deps",
        "local-model",
        "codex-agent",
      ],
      120000,
    );
    const codex = await inspect("codex-agent"),
      model = await inspect("local-model");
    const modelNetwork = JSON.parse(
      await run("inspect-inference-network", "docker", [
        "network",
        "inspect",
        project + "_inference",
      ]),
    )[0];
    if (
      !modelNetwork.Internal ||
      Object.keys(codex.NetworkSettings.Networks).sort().join(",") !==
        [project + "_agent", project + "_inference"].sort().join(",") ||
      Object.keys(model.NetworkSettings.Networks).join(",") !==
        project + "_inference"
    )
      throw Error("Codex/model network mismatch");
    if (
      codex.Mounts.length !== 1 ||
      codex.Mounts[0].Destination !== "/run/agent-credential.json" ||
      codex.Mounts[0].RW ||
      codex.Config.User !== "1000:1000" ||
      !codex.HostConfig.ReadonlyRootfs ||
      !codex.HostConfig.CapDrop.includes("ALL") ||
      codex.HostConfig.Privileged
    )
      throw Error("Codex credential/hardening boundary mismatch");
    for (const container of [codex, model])
      if (
        Object.values(container.NetworkSettings.Ports ?? {}).some(
          (value) => value?.length,
        )
      )
        throw Error("Codex/model published a host port");
    if (
      model.Mounts.length !== 1 ||
      model.Mounts[0].Destination !== "/models" ||
      model.Mounts[0].RW ||
      model.HostConfig.Privileged ||
      !model.HostConfig.ReadonlyRootfs ||
      model.Config.User !== "1000:1000" ||
      !model.HostConfig.CapDrop.includes("ALL")
    )
      throw Error("Model mount/hardening mismatch");
    report.codexBoundary = {
      networks: Object.keys(codex.NetworkSettings.Networks),
      modelNetworks: Object.keys(model.NetworkSettings.Networks),
      internal: true,
      agentImage: codex.Image,
      modelImage: model.Image,
      credentialMount: "one read-only scoped agent token file",
    };
    report.codexNetworkProbe = JSON.parse(
      await compose(
        "codex-network-probe",
        [
          "exec",
          "-T",
          "codex-agent",
          "node",
          "tests/isolation/agent.mjs",
          "network",
          JSON.stringify(addresses),
        ],
        45000,
      ),
    );
    report.codexRun = JSON.parse(
      (
        await compose(
          "codex-real-workflow",
          [
            "exec",
            "-T",
            "codex-agent",
            "node",
            "tests/milestone-b/codex-agent.mjs",
          ],
          660000,
        )
      )
        .split("\n")
        .findLast((line) => line.startsWith("{")),
    );
    report.codexProof = await operator("codex-upstream-proof", "codex-proof");
    const clientActionIds = report.codexRun.events
      .filter(
        (e) =>
          e.type === "item.completed" &&
          e.item?.type === "mcp_tool_call" &&
          e.item.status === "completed",
      )
      .flatMap((e) => e.item.result?.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => JSON.parse(c.text).id);
    if (
      report.codexProof.actions
        .filter((a) => a.status === "allowed")
        .some((a) => !clientActionIds.includes(a.id))
    )
      throw Error("Codex/MCP action trace mismatch");
    const { calls: beforeCalls, ...beforeCodex } = report.codexProvision.before,
      { calls: afterCalls, ...afterCodex } = report.codexProof.after;
    if (JSON.stringify(beforeCodex) !== JSON.stringify(afterCodex))
      throw Error("Read-only Codex workflow changed the target");
    if (afterCalls - beforeCalls < 2)
      throw Error("Codex did not make real allowed calls");
    report.milestoneB = "PASS_BOUNDED";
  }
  report.environmentHash = hash(
    JSON.stringify({
      engine: report.engine,
      images: report.images,
      boundaries: report.boundaries,
      codexDependencies: report.codexDependencies,
      codexBoundary: report.codexBoundary,
      codexBinary: report.codexRun?.binarySha256,
      modelIntegrity: report.modelIntegrity,
    }),
  );
  report.result = "PASS";
  console.log(
    "Isolated direct access denied; mediated read reached upstream once.",
  );
} catch (error) {
  report.error = redact(error.message);
  if (attemptedUp) {
    try {
      await compose(
        "container-logs",
        ["logs", "--no-color", "--tail", "100"],
        15000,
      );
    } catch {}
  }
  if (attemptedUp) report.result = "FAIL";
  process.exitCode = 1;
  console.log(report.error);
} finally {
  if (attemptedUp)
    try {
      await compose(
        "compose-down",
        ["--profile", "*", "down", "--volumes", "--remove-orphans"],
        120000,
      );
      const remaining = {};
      for (const [kind, args] of Object.entries({
        containers: ["ps", "-aq"],
        networks: ["network", "ls", "-q"],
        volumes: ["volume", "ls", "-q"],
      })) {
        const output = await run("cleanup-check-" + kind, "docker", [
          ...args,
          "--filter",
          "label=com.docker.compose.project=" + project,
        ]);
        remaining[kind] = output ? output.split("\n").length : 0;
      }
      if (Object.values(remaining).some(Boolean))
        throw Error("Fixture resources remain after compose down");
      report.cleanup = { result: "PASS", remaining };
    } catch (error) {
      report.cleanupError = error.message;
      report.result = "FAIL";
      process.exitCode = 1;
    }
  const resolved = resolve(runDir),
    parent = resolve(join(root, ".agentbrake-local")) + sep;
  if (
    !resolved.startsWith(parent) ||
    !/^isolation-[0-9a-f-]{36}$/.test(resolved.slice(parent.length))
  )
    throw new Error("Unsafe fixture cleanup path");
  if (!report.cleanupError)
    await rm(resolved, { recursive: true, force: true });
  const artifactNames = (await readdir(evidence)).filter((name) =>
    /\.(log|json)$/.test(name),
  );
  const secretValues = Object.values(secrets).filter(
    (value) => typeof value === "string" && value.length > 0,
  );
  const contaminated = [];
  for (const name of artifactNames) {
    const value = await readFile(join(evidence, name), "utf8");
    if (secretValues.some((secret) => value.includes(secret))) {
      contaminated.push(name);
      await writeFile(join(evidence, name), redact(value));
    }
  }
  if (secretValues.some((secret) => JSON.stringify(report).includes(secret)))
    contaminated.push("isolation-summary.json");
  report.credentialScan = {
    result: contaminated.length ? "FAIL" : "PASS",
    files: artifactNames.length + 1,
    knownSyntheticSecrets: secretValues.length,
    contaminated,
    scope:
      "Exact known fixture credentials; operator separately scans issued credentials. Not a universal DLP scan.",
  };
  if (contaminated.length) {
    report.result = "FAIL";
    report.error = "Credential found in generated evidence; redacted";
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(
    join(evidence, "isolation-summary.json"),
    redact(JSON.stringify(report, null, 2)),
  );
  await writeFile(
    join(root, "docs/evidence/latest-isolation.json"),
    JSON.stringify(
      { runId, result: report.result, directory: `docs/evidence/${runId}` },
      null,
      2,
    ),
  );
  if (milestoneB)
    await writeFile(
      join(root, "docs/evidence/milestone-b-latest.json"),
      JSON.stringify(
        {
          runId,
          result:
            report.result === "PASS"
              ? (report.milestoneB ?? "INCOMPLETE")
              : "INCOMPLETE",
          sourceHash: report.sourceHash,
          directory: `docs/evidence/${runId}`,
          error: report.error ?? report.cleanupError,
        },
        null,
        2,
      ),
    );
  console.log(`Isolation ${report.result}: docs/evidence/${runId}`);
}
