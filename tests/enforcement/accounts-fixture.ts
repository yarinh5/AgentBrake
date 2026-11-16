import assert from "node:assert/strict";
import { createApp } from "../../server/app.js";
import type { ControlStore } from "../../server/control-store.js";
export const key = "fixture-generated-admin-key-000000000000000";
export const password = "Fixture password one 47!";
export const nextPassword = "Fixture password two 93!";
const operators = [{ id: "administrator", name: "Owner", tenant: "local", role: "administrator" as const, key }, { id: "viewer-key", name: "Viewer", tenant: "local", role: "viewer" as const, key: "fixture-old-viewer-key-00000000000000000" }];
export async function accountApi(store: ControlStore, managedAccounts = true) {
    const system = createApp({ store, databasePath: ":memory:", adminKey: "fixture-binding-key-00000000000000000000", operators, managedAccounts });
    const server = system.app.listen(0, "127.0.0.1");
    await new Promise<void>(r => server.once("listening", r));
    const base = "http://127.0.0.1:" + (server.address() as {
        port: number;
    }).port;
    const request = async (path: string, body?: unknown, session?: any, method = body === undefined ? "GET" : "POST") => {
        const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(session ? { Cookie: session.cookie, "X-AB-CSRF": session.csrfToken } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const data = await response.json();
        return { status: response.status, ...data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
    };
    return { request, close: async () => { server.closeAllConnections(); await new Promise<void>((r, j) => server.close(e => e ? j(e) : r())); await system.close(); } };
}
export async function exerciseAccounts(store: ControlStore) {
    const f = await accountApi(store);
    const r = f.request;
    const secrets: string[] = [key, password, nextPassword];
    try {
        assert.deepEqual(await r("/api/setup"), { status: 200, managed: true, initialized: false, cookie: undefined });
        const old = await r("/api/login", { key: operators[1].key });
        assert.equal(old.status, 200);
        const setup = { key, name: "Owner", email: " OWNER@EXAMPLE.TEST ", password };
        assert.equal((await r("/api/setup", { ...setup, key: operators[1].key })).status, 401);
        assert.equal((await r("/api/setup", { ...setup, role: "administrator" })).status, 400);
        assert.equal((await r("/api/setup", { ...setup, password: "short" })).status, 400);
        const owner = await r("/api/setup", setup);
        assert.equal(owner.status, 200);
        assert.equal(owner.actor.id, "administrator");
        assert.equal(owner.authMode, "account");
        assert.equal((await r("/api/setup", setup)).status, 409);
        assert.equal((await r("/api/login", { key })).status, 401);
        assert.equal((await r("/api/session", undefined, old)).status, 401);
        assert.equal((await r("/api/team", undefined, { ...owner, csrfToken: "" })).status, 200);
        assert.equal((await r("/api/register", { email: "public@example.test", password })).status, 404);
        assert.equal((await r("/api/team/invitations", { email: "a@example.test", role: "viewer" }, { ...owner, csrfToken: "wrong" })).status, 403);
        assert.equal((await r("/api/team/invitations", { email: "a@example.test", role: "viewer", tenant: "other" }, owner)).status, 400);
        const invite = async (email: string, role: string) => { const i = await r("/api/team/invitations", { email, role }, owner); assert.equal(i.status, 201); secrets.push(i.token); return i; };
        const i = await invite("viewer@example.test", "viewer");
        assert.equal((await r("/api/invitations/accept", { token: i.token, name: "Reader", password, role: "administrator" })).status, 400);
        const viewer = await r("/api/invitations/accept", { token: i.token, name: "Reader", password });
        assert.equal(viewer.status, 200);
        assert.equal((await r("/api/invitations/accept", { token: i.token, name: "Replay", password })).status, 400);
        assert.equal((await r("/api/team", undefined, viewer)).status, 403);
        assert.equal((await r("/api/team/invitations", { email: "VIEWER@example.test", role: "administrator" }, owner)).status, 409);
        assert.equal((await r("/api/team/" + viewer.actor.id, { active: false }, owner, "PATCH")).status, 200);
        assert.equal((await r("/api/session", undefined, viewer)).status, 401);
        assert.equal((await r("/api/login", { email: "viewer@example.test", password })).status, 401);
        await r("/api/team/" + viewer.actor.id, { active: true }, owner, "PATCH");
        const operatorInvite = await invite("operator@example.test", "operator");
        const operator = await r("/api/invitations/accept", { token: operatorInvite.token, name: "Operator", password });
        assert.equal((await r("/api/team", undefined, operator)).status, 403);
        assert.equal((await r("/api/team/administrator", { active: false }, owner, "PATCH")).status, 409);
        assert.equal((await r("/api/team/administrator", { role: "viewer" }, owner, "PATCH")).status, 409);
        assert.equal((await r("/api/team/administrator", {}, owner, "PATCH")).status, 400);
        const before = await store.identityState();
        const parallelOwner = await r("/api/login", { email: "owner@example.test", password });
        assert.equal(parallelOwner.status, 200);
        assert.equal((await r("/api/password/change", { currentPassword: "wrong current password", password: nextPassword }, owner)).status, 401);
        assert.deepEqual(await store.identityState(), before);
        assert.equal((await r("/api/profile", { name: "Renamed" }, owner, "PATCH")).status, 200);
        assert.equal((await r("/api/profile", undefined, owner)).account.name, "Renamed");
        assert.equal((await r("/api/password/change", { currentPassword: password, password: nextPassword }, owner)).status, 200);
        assert.equal((await r("/api/session", undefined, owner)).status, 401);
        assert.equal((await r("/api/session", undefined, parallelOwner)).status, 401);
        const owner2 = await r("/api/login", { email: "owner@example.test", password: nextPassword });
        assert.equal(owner2.status, 200);
        const recovery = await r("/api/team/" + operator.actor.id + "/recovery", {}, owner2);
        assert.equal(recovery.status, 200);
        secrets.push(recovery.token);
        assert.equal((await r("/api/password/reset", { token: recovery.token, password: nextPassword })).status, 200);
        assert.equal((await r("/api/password/reset", { token: recovery.token, password })).status, 400);
        assert.equal((await r("/api/session", undefined, operator)).status, 401);
        const rev = await r("/api/team/invitations", { email: "revoke@example.test", role: "viewer" }, owner2);
        secrets.push(rev.token);
        assert.equal((await r("/api/team/invitations/" + rev.id, undefined, owner2, "DELETE")).status, 200);
        assert.equal((await r("/api/invitations/accept", { token: rev.token, name: "Revoked", password })).status, 400);
        const adminInvite = await r("/api/team/invitations", { email: "admin2@example.test", role: "administrator" }, owner2);
        secrets.push(adminInvite.token);
        const admin2 = await r("/api/invitations/accept", { token: adminInvite.token, name: "Second admin", password });
        assert.equal(admin2.status, 200);
        const competing = await Promise.all([r("/api/team/administrator", { role: "viewer" }, owner2, "PATCH"), r("/api/team/" + admin2.actor.id, { active: false }, admin2, "PATCH")]);
        assert.equal(competing.filter(v => v.status === 200).length, 1);
        assert.ok(competing.every(v => [200, 409].includes(v.status)));
        assert.equal((await store.identityState()).accounts.filter(a => a.active && a.role === "administrator").length, 1);
        const remaining = (await store.identityState()).accounts.find(a => a.active && a.role === "administrator")!;
        const stale = remaining.id === "administrator" ? admin2 : owner2;
        assert.equal((await r("/api/session", undefined, stale)).status, 401);
        const current = await r("/api/login", { email: remaining.email, password: remaining.id === "administrator" ? nextPassword : password });
        const safe = JSON.stringify([await r("/api/team", undefined, current), await r("/api/profile", undefined, current), await r("/api/audit/export", undefined, current), await store.auditTrail()]);
        for (const secret of secrets)
            assert.ok(!safe.includes(secret));
        const persisted = JSON.stringify(await store.identityState());
        for (const secret of secrets) assert.ok(!persisted.includes(secret));
        for (const account of (await store.identityState()).accounts) {
            assert.ok(!safe.includes(account.passwordHash.hash));
            assert.ok(!safe.includes(account.passwordHash.salt));
        }
        assert.ok(!safe.includes("passwordHash"));
        assert.ok(!safe.includes("salt"));
        assert.equal(await store.verifyAudit(), true);
        return { email: remaining.email, password: remaining.id === "administrator" ? nextPassword : password };
    }
    finally {
        await f.close();
    }
}
