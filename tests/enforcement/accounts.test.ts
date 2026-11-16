import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../../server/store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountApi, exerciseAccounts, key, password, nextPassword } from "./accounts-fixture.js";
test("managed identities enforce actual HTTP authority, credentials, tokens and revisions", async () => { await exerciseAccounts(new Store(":memory:")); });
test("account restart keeps managed key lockout and accounts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentbrake-account-"));
    const path = join(dir, "control.db");
    try {
        const login = await exerciseAccounts(new Store(path));
        const f = await accountApi(new Store(path));
        try {
            assert.equal((await f.request("/api/setup")).initialized, true);
            assert.equal((await f.request("/api/login", { key })).status, 401);
            assert.equal((await f.request("/api/login", login)).status, 200);
        }
        finally {
            await f.close();
        }
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test("identity and audit rollback together on audit insert failure", async () => {
    const store = new Store(":memory:");
    const f = await accountApi(store);
    try {
        const before = await store.identityState();
        const audit = store.auditTrail();
        store.db.exec("CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'fixture unavailable'); END");
        assert.equal((await f.request("/api/setup", { key, name: "Owner", email: "owner@example.test", password })).status, 503);
        assert.deepEqual(await store.identityState(), before);
        assert.deepEqual(store.auditTrail(), audit);
        store.db.exec("DROP TRIGGER fixture_audit_failure");
        const owner = await f.request("/api/setup", { key, name: "Owner", email: "owner@example.test", password });
        const initialized = await store.identityState();
        const history = store.auditTrail();
        store.db.exec("CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'fixture unavailable'); END");
        assert.equal((await f.request("/api/profile", { name: "Must rollback" }, owner, "PATCH")).status, 503);
        assert.deepEqual(await store.identityState(), initialized);
        assert.deepEqual(store.auditTrail(), history);
    }
    finally {
        await f.close();
    }
});
test("explicit compatibility mode rejects managed account methods", async () => { const f = await accountApi(new Store(":memory:"), false); try {
    assert.equal((await f.request("/api/setup")).managed, false);
    assert.equal((await f.request("/api/setup", { key, name: "Owner", email: "owner@example.test", password })).status, 409);
    const s = await f.request("/api/login", { key });
    assert.equal(s.status, 200);
    assert.equal((await f.request("/api/profile", undefined, s)).status, 409);
}
finally {
    await f.close();
} });
test("invitation and recovery expiration are checked by actual public HTTP endpoints", async () => {
    const store = new Store(":memory:");
    const f = await accountApi(store);
    try {
        const owner = await f.request("/api/setup", { key, name: "Owner", email: "owner@example.test", password });
        const invitation = await f.request("/api/team/invitations", { email: "expired@example.test", role: "viewer" }, owner);
        assert.equal(invitation.expiresAt - Date.now() > 23 * 3600000, true);
        const recovery = await f.request("/api/team/administrator/recovery", {}, owner);
        assert.equal(recovery.expiresAt - Date.now() > 14 * 60000, true);
        await store.changeIdentity(state => {
            state.invitations[0].expiresAt = Date.now() - 1;
            state.recoveries[0].expiresAt = Date.now() - 1;
            return { result: undefined, audit: { type: "fixture.expire", details: { actorId: "fixture", targetId: "fixture", reason: "expiry-clock-boundary" } } };
        });
        const before = await store.identityState();
        const badInvite = await f.request("/api/invitations/accept", { token: invitation.token, name: "Expired", password });
        const badReset = await f.request("/api/password/reset", { token: recovery.token, password: nextPassword });
        assert.equal(badInvite.status, 400);
        assert.equal(badReset.status, 400);
        assert.equal(badInvite.error, badReset.error);
        assert.deepEqual(await store.identityState(), before);
        assert.equal((await f.request("/api/session", undefined, owner)).status, 200);
    }
    finally {
        await f.close();
    }
});
test("production asynchronous scrypt is salted, bounded to two and does not block the event loop", async () => {
    const { hashPassword, verifyPassword, passwordParameters } = await import("../../server/security/accounts-password.js");
    assert.deepEqual(passwordParameters, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
    let timerRan = false;
    const timer = new Promise<void>(resolve => setTimeout(() => { timerRan = true; resolve(); }, 0));
    let finished = false;
    const first = hashPassword(password).then(value => { finished = true; return value; }), second = hashPassword(password);
    await assert.rejects(hashPassword(password), (e: any) => e.status === 429);
    await timer;
    assert.equal(finished, false);
    const [a, b] = await Promise.all([first, second]);
    await timer;
    assert.equal(timerRan, true);
    assert.ok(a.salt.length >= 32);
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.hash, b.hash);
    assert.equal(await verifyPassword(password, a), true);
    assert.equal(await verifyPassword(nextPassword, a), false);
});

test("session capacity: saturated legacy sessions bootstrap into a usable managed administrator", async () => {
    const store = new Store(":memory:");
    const api = await accountApi(store);
    try {
        let old;
        for (let i = 0; i < 256; i++) {
            old = await api.request("/api/login", {key});
            assert.equal(old.status, 200);
        }
        const initial=store.identityState(), audit=store.auditTrail();
        store.db.exec("CREATE TRIGGER fixture_bootstrap_audit_failure BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'fixture unavailable'); END");
        assert.equal((await api.request("/api/setup", {key, name:"Owner", email:"owner@example.test", password})).status,503);
        assert.deepEqual(store.identityState(),initial);
        assert.deepEqual(store.auditTrail(),audit);
        store.db.exec("DROP TRIGGER fixture_bootstrap_audit_failure");
        assert.equal((await api.request("/api/session",undefined,old)).status,200);
        const setup = await api.request("/api/setup", {key, name:"Owner", email:"owner@example.test", password});
        assert.equal(setup.status, 200);
        assert.equal((await api.request("/api/session", undefined, setup)).status, 200);
        assert.equal((await api.request("/api/session", undefined, old)).status, 401);
        assert.equal((await api.request("/api/login", {key})).status, 401);
        assert.equal((await api.request("/api/login", {email:"owner@example.test", password})).status, 200);
    } finally { await api.close(); }
});

test("session capacity: active sessions protect signup state, invalidated revisions reclaim slots", async () => {
    const store = new Store(":memory:");
    const api = await accountApi(store);
    try {
        const owner = await api.request("/api/setup", {key, name:"Owner", email:"owner@example.test", password});
        assert.equal(owner.status, 200);
        const invitation = await api.request("/api/team/invitations", {email:"capacity-viewer@example.test",role:"viewer"}, owner);
        assert.equal(invitation.status, 201);
        // Use the real HTTP login path and unchanged production KDF, two at a time.
        for(let i=1;i<256;i+=2) {
            const sessions = await Promise.all(Array.from({length:Math.min(2,256-i)},()=>api.request("/api/login", {email:"owner@example.test",password})));
            for(const session of sessions) assert.equal(session.status, 200);
        }
        const before=await store.identityState();
        assert.equal((await api.request("/api/login", {email:"owner@example.test",password})).status, 429);
        const accept = {token:invitation.token,name:"Reader",password};
        assert.equal((await api.request("/api/invitations/accept", accept)).status, 429);
        assert.deepEqual(await store.identityState(),before);
        assert.equal((await api.request("/api/session",undefined,owner)).status,200);
        // Role changes invalidate all of this member's sessions even for a same-role patch.
        assert.equal((await api.request("/api/team/administrator", {role:"administrator"}, owner,"PATCH")).status,200);
        assert.equal((await api.request("/api/session",undefined,owner)).status,401);
        const recovered=await api.request("/api/login", {email:"owner@example.test",password});
        assert.equal(recovered.status,200);
        const reader=await api.request("/api/invitations/accept",accept);
        assert.equal(reader.status,200);
        assert.equal((await api.request("/api/session",undefined,reader)).status,200);
        assert.equal(store.identityState().accounts.length,2);
    } finally { await api.close(); }
});
