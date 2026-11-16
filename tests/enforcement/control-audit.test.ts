import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../../server/store.js";
import { assertControlAudit } from "./control-audit-fixture.js";

test("real team control mutations retain the authenticated human and export no credentials", async () => {
  const store = new Store(":memory:");
  await assertControlAudit(store);
});

test("internal fixture calls are not attributed to an invented human; trusted owner creation remains explicit", () => {
  const store = new Store(":memory:");
  try {
    store.setPaused(true);
    store.createAgent({
      name: "Fixture owned",
      tools: ["database_read"],
      resources: ["customers"],
      sandbox: true,
      ownerId: "fixture-owner",
    });
    const events = store.auditTrail().map((r) => JSON.parse(r.data));
    assert.deepEqual(events[0].details.actor, { source: "internal" });
    assert.deepEqual(events[1].details.actor, {
      actorId: "fixture-owner",
      tenant: "local",
    });
  } finally {
    store.close();
  }
});
