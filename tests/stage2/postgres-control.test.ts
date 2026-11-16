import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresStore } from "../../server/postgres-store.js";
import type { ActionRecord, Agent } from "../../server/contracts.js";
import type { ReservationCheck } from "../../server/control-store.js";
import { POLICY_VERSION } from "../../server/policy/contracts.js";
import { assertControlAudit } from "../enforcement/control-audit-fixture.js";
import { accountApi, exerciseAccounts, key } from "../enforcement/accounts-fixture.js";

// This file is deliberately excluded from the native suite. Its dedicated run
// must fail, rather than silently skip, if the isolated fixture is not selected.
const fixtureUrl = (user: string, secret: string) =>
  `postgresql://${user}:${encodeURIComponent(readFileSync(secret, "utf8").trim())}@control-db:5432/agentbrake_control_fixture`;
const input = {
  name: "PostgreSQL control fixture",
  tools: ["database_read", "database_update", "github_create_issue"],
  resources: ["customers", "agentbrake/sandbox"],
  sandbox: true,
};
function action(agent: Agent, tool = "database_read"): ActionRecord {
  return {
    id: randomUUID(),
    agentId: agent.id,
    requestId: randomUUID(),
    tool,
    arguments: tool === "database_read" ? { limit: 1 } : {},
    digest: "fixture-envelope",
    destination: "isolated-target",
    correlationId: randomUUID(),
    grantId: agent.grant!.id,
    grantFingerprint: "fixture-grant",
    policyRevision: 1,
    policyDecisionId: randomUUID(),
    policyVersion: POLICY_VERSION,
    policyHash: "a".repeat(64),
    policyEffect: "ALLOW",
    status: "queued",
    rule: "approved-reads",
    reason: "Fixture",
    resource: "customers",
    sandbox: true,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    durationMs: 0,
  };
}
// The caller supplies authorization; this test check makes stale reads visible.
const check: ReservationCheck = (agent, settings, persisted) => {
  const rule = settings.paused
    ? "emergency-stop"
    : agent.status !== "active"
      ? "agent-paused"
      : agent.grant!.revoked
        ? "grant-revoked"
        : agent.grant!.used_calls >= agent.grant!.max_calls
          ? "quota-exhausted"
          : persisted.tool === "github_create_issue" && agent.tainted
            ? "data-boundary"
            : undefined;
  return rule
    ? { rule, reason: "Current authority denies dispatch" }
    : undefined;
};

test("PostgreSQL control fixture", async (t) => {
  assert.equal(
    process.env.POSTGRES_CONTROL_TEST,
    "1",
    "Run the dedicated isolated PostgreSQL fixture with POSTGRES_CONTROL_TEST=1",
  );
  const url = fixtureUrl("control_runtime", "/run/secrets/control-password");
  const owner = new pg.Pool({
    connectionString: fixtureUrl(
      "control_owner",
      "/run/secrets/control-owner-password",
    ),
  });
  const first = await PostgresStore.open(url);
  const second = await PostgresStore.open(url);
  const runtime = new pg.Pool({ connectionString: url });
  try {
    await first.setPaused(false);

    await t.test("managed account HTTP workflow, persistence and audit rollback use the real PostgreSQL store", async () => {
      // Fixture volumes are ephemeral; a managed bootstrap must only happen once.
      const credentials = await exerciseAccounts(await PostgresStore.open(url));
      const reopened = await PostgresStore.open(url);
      const api = await accountApi(reopened);
      try {
        assert.equal((await api.request("/api/setup")).initialized, true);
        assert.equal((await api.request("/api/login", {key})).status, 401);
        const session = await api.request("/api/login", credentials);
        assert.equal(session.status, 200);
        const state = await reopened.identityState();
        const audit = await reopened.auditTrail();
        await owner.query("REVOKE INSERT ON audit FROM control_runtime");
        try {
          assert.equal((await api.request("/api/profile", {name:"Must rollback"}, session, "PATCH")).status, 503);
          assert.deepEqual(await reopened.identityState(), state);
          assert.deepEqual(await reopened.auditTrail(), audit);
        } finally {
          await owner.query("GRANT INSERT ON audit TO control_runtime");
        }
        assert.equal(await reopened.verifyAudit(), true);
      } finally { await api.close(); }
    });

    await t.test(
      "real team API actor attribution survives PostgreSQL reopen and exports",
      async () => {
        const initial = await first.settings();
        const apiStore = await PostgresStore.open(url);
        const { id, audit } = await assertControlAudit(apiStore);
        const reopened = await PostgresStore.open(url);
        try {
          const persisted = (await reopened.auditTrail()).map((row) =>
            JSON.parse(row.data),
          );
          for (const expected of audit)
            assert.ok(
              persisted.some(
                (event) => JSON.stringify(event) === JSON.stringify(expected),
              ),
            );
          assert.equal(
            (await reopened.agent(id))!.grant!.human_owner,
            "audit-alice",
          );
          assert.equal((await reopened.agent(id))!.grant!.revoked, true);
          assert.equal(await reopened.verifyAudit(), true);
        } finally {
          await reopened.setPolicies(initial.policies, {
            actorId: "fixture-cleanup",
            tenant: "local",
          });
          await reopened.close();
        }
      },
    );

    await t.test(
      "paged activity, policy history and payload retention preserve pending review and audit",
      async () => {
        const { agent } = await first.createAgent({
          ...input,
          ownerId: "fixture-owner",
        });
        const old = {
            ...action(agent),
            status: "allowed" as const,
            createdAt: new Date(Date.now() - 48 * 3600000).toISOString(),
            result: { rows: [{ fixture: true }] },
          },
          pending = {
            ...action(agent),
            status: "pending" as const,
            review: { nonce: randomUUID(), fingerprint: "a".repeat(64) },
          };
        await first.insertAction(old);
        await first.insertAction(pending);
        const page = await second.actionsPage({
          agentId: agent.id,
          status: "pending",
          limit: 1,
          offset: 0,
        });
        assert.equal(page.total, 1);
        assert.equal(page.items[0].id, pending.id);
        const history = await second.policyHistory(1);
        assert.equal(history[0].version, (await second.settings()).revision);
        const audit = await first.auditTrail();
        assert.equal(
          await first.pruneResults(
            new Date(Date.now() - 24 * 3600000).toISOString(),
          ),
          1,
        );
        assert.equal((await second.action(old.id))!.result, undefined);
        assert.ok((await second.action(old.id))!.resultPurgedAt);
        assert.deepEqual(
          (await second.action(pending.id))!.review,
          pending.review,
        );
        assert.deepEqual(await first.auditTrail(), audit);
        assert.equal(await second.verifyAudit(), true);
        await first.audit("fixture.filtered", { actionId: pending.id });
        const filtered = await second.auditTrail({
          limit: 1,
          actionId: pending.id,
        });
        assert.equal(filtered.length, 1);
        assert.equal(JSON.parse(filtered[0].data).details.actionId, pending.id);
      },
    );

    await t.test(
      "connection boundaries reject other databases, hosts, roles, and URI overrides",
      async () => {
        for (const invalid of [
          "postgresql://control_runtime:fixture@remote.example/agentbrake_control_fixture",
          "postgresql://control_runtime:fixture@localhost/production",
          "postgresql://control_owner:fixture@localhost/agentbrake_control_fixture",
          "postgresql://control_runtime:fixture@localhost/agentbrake_control_fixture?host=remote.example",
        ])
          await assert.rejects(
            PostgresStore.open(invalid),
            /isolated control fixture/,
          );
      },
    );

    await t.test(
      "separate store instances claim the same persisted action exactly once",
      async () => {
        const { agent, token } = await first.createAgent(input);
        assert.equal((await second.authenticate(token))?.id, agent.id);
        const record = action(agent);
        await first.insertAction(record);
        const outcomes = await Promise.allSettled([
          first.reserve(structuredClone(record), check),
          second.reserve(structuredClone(record), check),
        ]);
        assert.equal(
          outcomes.filter((r) => r.status === "fulfilled" && r.value).length,
          1,
        );
        assert.equal(outcomes.filter((r) => r.status === "rejected").length, 1);
        assert.equal((await second.agent(agent.id))!.grant!.used_calls, 1);
        assert.equal((await second.agent(agent.id))!.tainted, true);
        assert.equal((await second.action(record.id))!.status, "executing");
        const events = (await first.auditTrail()).map((r) =>
          JSON.parse(r.data),
        );
        assert.equal(
          events.filter(
            (e) =>
              e.type === "execution.started" &&
              e.details.actionId === record.id,
          ).length,
          1,
        );
        await assert.rejects(
          first.insertAction({ ...record, id: randomUUID() }),
          (error: any) => error.code === "23505",
        );
      },
    );

    await t.test(
      "concurrent different actions cannot overspend the last grant call",
      async () => {
        const { agent } = await first.createAgent(input);
        await first.changeAgent(
          agent.id,
          { grant: { ...agent.grant!, max_calls: 1 } },
          "grant.changed",
        );
        const a = action(agent),
          b = action(agent);
        await first.insertAction(a);
        await first.insertAction(b);
        assert.deepEqual(
          (
            await Promise.all([
              first.reserve(a, check),
              second.reserve(b, check),
            ])
          ).sort(),
          [false, true],
        );
        assert.equal((await first.agent(agent.id))!.grant!.used_calls, 1);
        const records = [await first.action(a.id), await first.action(b.id)];
        assert.equal(
          records.filter(
            (r) => r!.status === "blocked" && r!.rule === "quota-exhausted",
          ).length,
          1,
        );
      },
    );

    await t.test(
      "fresh taint, revocation and pause are passed to reservation; stale grant patches retain consumption",
      async () => {
        const { agent } = await first.createAgent(input);
        const read = action(agent);
        await first.insertAction(read);
        assert.equal(await first.reserve(read, check), true);
        const outbound = action(agent, "github_create_issue");
        await first.insertAction(outbound);
        assert.equal(await second.reserve(outbound, check), false);
        assert.equal(outbound.rule, "data-boundary");
        const revoked = await second.changeAgent(
          agent.id,
          { grant: { ...agent.grant!, revoked: true } },
          "grant.revoked",
        );
        assert.equal(revoked!.grant!.used_calls, 1);
        const afterRevocation = action(agent);
        await first.insertAction(afterRevocation);
        assert.equal(await first.reserve(afterRevocation, check), false);
        assert.equal(afterRevocation.rule, "grant-revoked");
        const fresh = (await first.createAgent(input)).agent;
        const afterPause = action(fresh);
        await first.insertAction(afterPause);
        await second.setPaused(true);
        try {
          assert.equal(await first.reserve(afterPause, check), false);
          assert.equal(afterPause.rule, "emergency-stop");
        } finally {
          await second.setPaused(false);
        }
      },
    );

    await t.test(
      "audit permission failure rolls back action, quota, taint, controls and revisions",
      async () => {
        const { agent } = await first.createAgent(input);
        const record = action(agent);
        await first.insertAction(record);
        const settings = await first.settings();
        const beforeAgents = (await first.agents()).length;
        const beforeAudit = await first.auditTrail();
        const beforeHistory = await first.policyHistory();
        const actor = { actorId: "fixture-rollback-operator", tenant: "local" };
        await owner.query("REVOKE INSERT ON audit FROM control_runtime");
        try {
          await assert.rejects(
            first.reserve(record, check),
            (error: any) => error.code === "42501",
          );
          assert.equal(record.status, "queued");
          assert.equal((await first.action(record.id))!.status, "queued");
          assert.equal((await first.agent(agent.id))!.grant!.used_calls, 0);
          assert.equal((await first.agent(agent.id))!.tainted, false);
          await assert.rejects(first.setPaused(true, actor));
          await assert.rejects(
            first.setPolicies(
              {
                reads: "deny",
                databaseWrites: "deny",
                githubWrites: "deny",
              },
              actor,
            ),
          );
          await assert.rejects(
            first.changeAgent(
              agent.id,
              { status: "paused" },
              "agent.changed",
              actor,
            ),
          );
          for (const [event, grant] of [
            ["grant.revoked", { ...agent.grant!, revoked: true }],
            ["grant.issued", { ...agent.grant!, id: randomUUID() }],
          ] as const)
            await assert.rejects(
              first.changeAgent(agent.id, { grant }, event, actor),
            );
          await assert.rejects(first.createAgent(input, actor));
          assert.deepEqual(await first.settings(), settings);
          assert.deepEqual(await first.agent(agent.id), agent);
          assert.equal((await first.agents()).length, beforeAgents);
          assert.deepEqual(await first.auditTrail(), beforeAudit);
          assert.deepEqual(await first.policyHistory(), beforeHistory);
        } finally {
          await owner.query("GRANT INSERT ON audit TO control_runtime");
        }
        assert.equal(await first.reserve(record, check), true);
      },
    );

    await t.test(
      "policy document and its revision remain paired under concurrent updates",
      async () => {
        const a = {
          reads: "deny" as const,
          databaseWrites: "deny" as const,
          githubWrites: "deny" as const,
        };
        const b = {
          reads: "approval" as const,
          databaseWrites: "approval" as const,
          githubWrites: "approval" as const,
        };
        const before = (await first.settings()).revision;
        const beforeCount = Number(
          (
            await runtime.query(
              "SELECT count(*) AS count FROM policy_revisions",
            )
          ).rows[0].count,
        );
        await Promise.all([first.setPolicies(a), second.setPolicies(b)]);
        const settings = await first.settings();
        // PostgreSQL sequence values may have gaps after a rolled-back insert.
        assert.ok(settings.revision > before);
        assert.equal(
          Number(
            (
              await runtime.query(
                "SELECT count(*) AS count FROM policy_revisions",
              )
            ).rows[0].count,
          ),
          beforeCount + 2,
        );
        const revision = await runtime.query(
          "SELECT policies FROM policy_revisions WHERE version=$1",
          [settings.revision],
        );
        assert.deepEqual(
          JSON.parse(revision.rows[0].policies),
          settings.policies,
        );
        await first.setPolicies({
          reads: "allow",
          databaseWrites: "approval",
          githubWrites: "approval",
        });
      },
    );

    await t.test(
      "runtime cannot mutate audit history or create database objects",
      async () => {
        const role = await runtime.query(
          "SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname=current_user",
        );
        assert.deepEqual(role.rows[0], {
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
        });
        for (const statement of [
          "UPDATE audit SET hash='changed'",
          "DELETE FROM audit",
          "TRUNCATE audit",
          "CREATE TABLE public.forbidden_control_table(id integer)",
          "CREATE TEMP TABLE forbidden_control_temp(id integer)",
          "ALTER TABLE audit ADD COLUMN forbidden integer",
          "ALTER TABLE audit DISABLE TRIGGER ALL",
          "SET ROLE control_owner",
        ])
          await assert.rejects(
            runtime.query(statement),
            (error: any) => error.code === "42501",
          );
        assert.equal(await first.verifyAudit(), true);
      },
    );

    await t.test(
      "approval rejection and reservation share a single atomic terminal transition",
      async () => {
        for (let i = 0; i < 4; i++) {
          const { agent } = await first.createAgent(input);
          const pending: ActionRecord = {
            ...action(agent, "database_update"),
            status: "pending",
          };
          await first.insertAction(pending);
          const rejection = {
            ...pending,
            status: "blocked" as const,
            rule: "human-rejected",
            reason: "Fixture rejection",
          };
          const attempts = await Promise.allSettled([
            first.reserve(structuredClone(pending), check),
            second.blockPending(rejection),
          ]);
          assert.equal(
            attempts.filter((a) => a.status === "fulfilled").length,
            1,
          );
          const stored = (await first.action(pending.id))!;
          assert.ok(["executing", "blocked"].includes(stored.status));
          const events = (await first.auditTrail())
            .map((r) => JSON.parse(r.data))
            .filter((e) => e.details.actionId === pending.id);
          assert.equal(events.length, 1);
          assert.equal(
            (await first.agent(agent.id))!.grant!.used_calls,
            stored.status === "executing" ? 1 : 0,
          );
          await assert.rejects(
            second.blockPending(rejection),
            (error: any) => error.status === 409,
          );
          assert.equal((await first.action(pending.id))!.status, stored.status);
        }
      },
    );
    await t.test(
      "concurrent audit writers retain the exact serialized chain",
      async () => {
        await Promise.all(
          Array.from({ length: 24 }, (_, i) =>
            (i % 2 ? first : second).audit("fixture.concurrent", {
              i,
              unicode: "שלום",
              nested: { b: 2, a: 1 },
            }),
          ),
        );
        assert.equal(await second.verifyAudit(), true);
        let previous = "genesis";
        for (const row of await first.auditTrail()) {
          assert.equal(row.previous_hash, previous);
          assert.equal(
            row.hash,
            createHash("sha256")
              .update(previous + row.data)
              .digest("hex"),
          );
          if (JSON.parse(row.data).type === "fixture.concurrent")
            assert.ok(row.data.includes('"nested":{"b":2,"a":1}'));
          previous = row.hash;
        }
      },
    );

    await t.test(
      "reopen preserves state; only explicit exclusive reconciliation marks unfinished actions unknown",
      async () => {
        const { agent } = await first.createAgent(input);
        const queued = action(agent),
          executing = action(agent),
          pending = { ...action(agent), status: "pending" as const };
        for (const record of [queued, executing, pending])
          await first.insertAction(record);
        await first.reserve(executing, check);
        const reopened = await PostgresStore.open(url);
        try {
          assert.equal((await reopened.action(queued.id))!.status, "queued");
          assert.equal(
            (await reopened.action(executing.id))!.status,
            "executing",
          );
          assert.equal((await reopened.agent(agent.id))!.grant!.used_calls, 1);
        } finally {
          await reopened.close();
        }
        const recovered = await PostgresStore.open(url, { reconcile: true });
        try {
          assert.equal((await recovered.action(queued.id))!.status, "unknown");
          assert.equal(
            (await recovered.action(executing.id))!.status,
            "unknown",
          );
          assert.equal((await recovered.action(pending.id))!.status, "pending");
          assert.equal((await recovered.agent(agent.id))!.grant!.used_calls, 1);
          await assert.rejects(
            recovered.reserve({ ...executing, status: "queued" }, check),
          );
        } finally {
          await recovered.close();
        }
      },
    );

    await t.test(
      "tampered audit content is detected and refuses startup before recovery",
      async () => {
        const { agent } = await first.createAgent(input);
        const queued = action(agent);
        await first.insertAction(queued);
        const row = (await first.auditTrail()).at(-1)!;
        await owner.query("UPDATE audit SET data=$1 WHERE seq=$2", [
          '{"tampered":true}',
          row.seq.toString(),
        ]);
        try {
          assert.equal(await first.verifyAudit(), false);
          await assert.rejects(
            PostgresStore.open(url, { reconcile: true }),
            /audit chain/i,
          );
          assert.equal((await first.action(queued.id))!.status, "queued");
        } finally {
          await owner.query("UPDATE audit SET data=$1 WHERE seq=$2", [
            row.data,
            row.seq.toString(),
          ]);
        }
        assert.equal(await first.verifyAudit(), true);
      },
    );
  } finally {
    await Promise.all([
      first.close(),
      second.close(),
      runtime.end(),
      owner.end(),
    ]);
  }
});
