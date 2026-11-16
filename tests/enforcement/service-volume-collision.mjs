// Real Docker regression, called by verify-service; all fixtures are disposable.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { dockerProduct } from "../../scripts/product.mjs";
import { restoreProduct } from "../../scripts/product-maintenance.mjs";
import { root } from "../../scripts/opa-runtime.mjs";

export async function verifyVolumeCollisions(config, backup) {
  const results = [];
  const run = (args) => dockerProduct(config, args, { capture: true });
  for (const suffix of ["control-data", "target-data", "git-data"]) {
    const name = "verify-collision-" + randomUUID().slice(0, 8),
      project = "agentbrake-product-" + name,
      volume = project + "_" + suffix,
      marker = "com.agentbrake.collision-test=" + name;
    const inspect = async () => JSON.parse(await run([
      "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--cap-add", "DAC_OVERRIDE", "--security-opt", "no-new-privileges:true",
      "--mount", `type=volume,source=${volume},target=/fixture,readonly`,
      config.env.NODE_IMAGE, "node", "-e",
      "const fs=require('fs');const s=fs.statSync('/fixture');console.log(JSON.stringify({uid:s.uid,gid:s.gid,mode:s.mode&511,sentinel:fs.readFileSync('/fixture/sentinel','utf8')}));",
    ]));
    const existing = (await run(["volume", "ls", "-q", "--filter", "name=" + volume])).trim().split(/\r?\n/);
    assert.ok(!existing.includes(volume), "Fixture volume must be new");
    let owned = false;
    try {
      await run([
        "volume", "create", "--label", marker,
        // Exercise both absent and foreign Compose project labels.
        ...(suffix === "control-data" ? [] : ["--label", "com.docker.compose.project=foreign-" + name]),
        volume,
      ]);
      const [info] = JSON.parse(await run(["volume", "inspect", volume]));
      assert.equal(info.Name, volume);
      assert.equal(info.Labels?.["com.agentbrake.collision-test"], name);
      owned = true;
      await run([
        "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true",
        "--mount", `type=volume,source=${volume},target=/fixture`,
        config.env.NODE_IMAGE, "node", "-e",
        "const fs=require('fs');fs.writeFileSync('/fixture/sentinel','synthetic collision sentinel');fs.chmodSync('/fixture',0o751);",
      ]);
      const before = await inspect();
      assert.deepEqual(before, { uid: 0, gid: 0, mode: 0o751, sentinel: "synthetic collision sentinel" });
      await assert.rejects(restoreProduct(backup.file, backup.keyFile, name, 4334), /new project/);
      const after = await inspect();
      assert.deepEqual(after, before, "Restore must preserve foreign volume content and metadata");
      await assert.rejects(stat(join(root, ".agentbrake-local/product-" + name)), { code: "ENOENT" });
      results.push({ suffix, labels: suffix === "control-data" ? "no Compose label" : "foreign Compose label", before, after, destinationAbsent: true });
    } finally {
      if (owned) {
        const [info] = JSON.parse(await run(["volume", "inspect", volume]));
        assert.equal(info.Name, volume);
        assert.equal(info.Labels?.["com.agentbrake.collision-test"], name, "Only remove this test's volume");
        await run(["volume", "rm", volume]);
        const remaining = (await run(["volume", "ls", "-q", "--filter", "label=" + marker])).trim();
        assert.equal(remaining, "");
      }
    }
  }
  return results;
}
