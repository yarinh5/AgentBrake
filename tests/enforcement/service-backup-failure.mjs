import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { root } from "../../scripts/opa-runtime.mjs";
import { dockerProduct, composeProduct } from "../../scripts/product.mjs";
import {
  backupProduct,
  doctorProduct,
} from "../../scripts/product-maintenance.mjs";

// Deliberately oversized synthetic file in this verifier's owned Git volume.
export async function verifyBackupFailureResume(config) {
  assert.match(config.name, /^verify-service-/);
  const volume = config.project + "_git-data";
  const [info] = JSON.parse(
    await dockerProduct(config, ["volume", "inspect", volume], {
      capture: true,
    }),
  );
  assert.equal(info.Name, volume);
  assert.equal(info.Labels?.["com.agentbrake.product"], config.id);
  assert.equal(info.Labels?.["com.docker.compose.project"], config.project);
  const path = "/fixture/backup-size-probe-" + randomUUID();
  const helper = (script) =>
    dockerProduct(
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
        "--user",
        "1000:1000",
        "--memory",
        "256m",
        "--pids-limit",
        "32",
        "--mount",
        `type=volume,source=${volume},target=/fixture`,
        config.env.NODE_IMAGE,
        "node",
        "-e",
        script,
        path,
      ],
      { capture: true },
    );
  const artifacts = async () =>
    (await readdir(join(root, ".agentbrake-local/backups")))
      .filter((name) => name.startsWith(config.name + "-"))
      .sort();
  const before = await artifacts();
  const containerIds = async () => (await composeProduct(config,
    ['--profile','agent','ps','--all','--quiet'], {capture:true}))
    .trim().split(/\r?\n/).filter(Boolean).sort();
  const originalContainers = await containerIds();
  assert.ok(originalContainers.length > 0);
  try {
    await helper(
      "require('fs').writeFileSync(process.argv[1],require('crypto').randomBytes(50*1024*1024),{flag:'wx',mode:0o600});",
    );
    await assert.rejects(backupProduct(config), (error) =>
      /snapshot.*limit/i.test(error.errorOutput || error.message),
    );
    assert.deepEqual(
      await artifacts(),
      before,
      "Rejected backup must not publish an artifact",
    );
    assert.equal(
      (await doctorProduct(config)).http,
      "200",
      "Source must resume after backup rejection",
    );
    assert.deepEqual(await containerIds(), originalContainers,
      'Backup failure recovery must resume existing containers without replacement');
    return {
      rejectedOversizedSnapshot: true,
      artifactNotPublished: true,
      sourceResumed: true,
      originalContainersPreserved: true,
    };
  } finally {
    await helper(
      "const fs=require('fs');try{fs.unlinkSync(process.argv[1]);}catch(e){if(e.code!=='ENOENT')throw e;}",
    );
  }
}
