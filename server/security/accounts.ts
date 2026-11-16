import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HttpError } from "../contracts.js";
import type { ControlStore } from "../control-store.js";
import { digest } from "../store.js";
import { LocalOperators, type OperatorSession } from "./operators.js";
import type { Account, IdentityState } from "./accounts-state.js";
import { hashPassword, verifyPassword } from "./accounts-password.js";
export const accountSchemas = {
    email: z.string().trim().toLowerCase().max(254).email(),
    password: z.string().min(15).max(128),
    name: z.string().trim().min(1).max(80),
    role: z.enum(["administrator", "operator", "approver", "viewer"]),
    token: z.string().max(200),
};
export const safeAccount = ({ id, name, email, role, tenant, active }: Account) => ({ id, name, email, role, tenant, active });
const actorOf = ({ id, name, role, tenant }: Account) => ({ id, name, role, tenant });
const invalidToken = () => new HttpError(400, "Invalid or expired token");
const event = (type: string, actorId: string, targetId: string, reason: string) => ({ type: "identity." + type, details: { actorId, targetId, reason } });
export class ManagedAccounts {
    readonly team = true;
    constructor(private store: ControlStore, private legacy: LocalOperators) { }
    async status() { return { managed: true, initialized: (await this.store.identityState()).initialized }; }
    private account(state: IdentityState, session: OperatorSession, admin = false) {
        const account = state.accounts.find(a => a.id === session.actor.id);
        if (session.authMode !== "account" || !account?.active || account.revision !== session.revision)
            throw new HttpError(401, "Account sign-in required");
        if (admin && account.role !== "administrator")
            throw new HttpError(403, "Administrator access required");
        return account;
    }
    private session(account: Account) { return this.legacy.issue(actorOf(account), "account", account.revision); }
    private pruneInvalidSessions(state: IdentityState) {
        this.legacy.pruneSessions(session => {
            if (session.authMode === "key") return !state.initialized;
            const account = state.accounts.find(a => a.id === session.actor.id);
            // A database read may precede a newer session's commit. Only discard
            // revisions proven invalid by this snapshot; account IDs are never deleted.
            if (!account) return true;
            const revision = session.revision ?? 0;
            return revision > account.revision || (revision === account.revision && account.active);
        });
    }
    private pruneAccountSessions(id: string, revision: number) {
        this.legacy.pruneSessions(s => s.authMode !== "account" || s.actor.id !== id || (s.revision ?? 0) >= revision);
    }
    async authenticate(cookie?: string) {
        const session = this.legacy.authenticate(cookie);
        const state = await this.store.identityState();
        this.pruneInvalidSessions(state);
        if (!state.initialized) {
            if (session.authMode !== "key")
                throw new HttpError(401, "Operator sign-in required");
            return session;
        }
        const account = this.account(state, session);
        return { ...session, actor: actorOf(account) };
    }
    checkCsrf(session: OperatorSession, token: unknown) {
        // Managed mode always requires CSRF, even when no operators array was supplied.
        if (typeof token !== "string" || !timingSafeEqual(Buffer.from(digest(token)), Buffer.from(digest(session.csrfToken))))
            throw new HttpError(403, "Session verification required");
    }
    logout(cookie?: string) { this.legacy.logout(cookie); }
    async login(input: unknown) {
        const state = await this.store.identityState();
        if (!state.initialized) {
            const key = z.object({ key: z.string().max(200) }).strict().safeParse(input);
            if (!key.success)
                throw new HttpError(401, "Invalid operator credential");
            return this.legacy.login(key.data.key);
        }
        const body = z.object({ email: accountSchemas.email, password: accountSchemas.password }).strict().safeParse(input);
        if (!body.success)
            throw new HttpError(401, "Invalid account credential");
        const found = state.accounts.find(a => a.email === body.data.email && a.active);
        // Unknown emails still perform the same bounded asynchronous KDF.
        const credential = found?.passwordHash ?? { salt: "0".repeat(32), hash: "0".repeat(128) };
        const valid = await verifyPassword(body.data.password, credential);
        if (!found || !valid)
            throw new HttpError(401, "Invalid account credential");
        const latest = await this.store.identityState();
        this.pruneInvalidSessions(latest);
        const current = latest.accounts.find(a => a.id === found.id);
        if (!current?.active || current.revision !== found.revision)
            throw new HttpError(401, "Invalid account credential");
        return this.session(current);
    }
    async setup(input: unknown) {
        const body = z.object({ key: z.string().max(200), name: accountSchemas.name, email: accountSchemas.email, password: accountSchemas.password }).strict().parse(input);
        if ((await this.store.identityState()).initialized)
            throw new HttpError(409, "Workspace accounts are already initialized");
        const actor = this.legacy.credential(body.key);
        if (actor.role !== "administrator")
            throw new HttpError(401, "Invalid bootstrap credential");
        const reservation = this.legacy.reserveSession(true);
        try {
          const passwordHash = await hashPassword(body.password);
          const account = await this.store.changeIdentity(state => {
            if (state.initialized)
                throw new HttpError(409, "Workspace accounts are already initialized");
            const account: Account = { id: actor.id, name: body.name, email: body.email, role: "administrator", tenant: "local", active: true, revision: 1, passwordHash };
            state.initialized = true;
            state.accounts.push(account);
            return { result: account, audit: event("initialized", actor.id, account.id, "administrator-bootstrap") };
          });
          return reservation.issue(actorOf(account), "account", account.revision);
        } finally { reservation.release(); }
    }
    async profile(session: OperatorSession) { return safeAccount(this.account(await this.store.identityState(), session)); }
    async rename(session: OperatorSession, input: unknown) {
        const { name } = z.object({ name: accountSchemas.name }).strict().parse(input);
        return this.store.changeIdentity(state => {
            const a = this.account(state, session);
            a.name = name;
            return { result: safeAccount(a), audit: event("profile-changed", a.id, a.id, "name-changed") };
        });
    }
    async teamMembers(session: OperatorSession) {
        const state = await this.store.identityState();
        this.account(state, session, true);
        return { members: state.accounts.map(safeAccount), invitations: state.invitations.filter(i => i.expiresAt > Date.now()).map(({ id, email, role, expiresAt }) => ({ id, email, role, expiresAt })) };
    }
    async invite(session: OperatorSession, input: unknown) {
        const { email, role } = z.object({ email: accountSchemas.email, role: accountSchemas.role }).strict().parse(input);
        const token = randomBytes(32).toString("hex"), id = randomUUID(), expiresAt = Date.now() + 24 * 3600000;
        return this.store.changeIdentity(state => {
            const a = this.account(state, session, true);
            state.invitations = state.invitations.filter(i => i.expiresAt > Date.now());
            if (state.accounts.some(a => a.email === email) || state.invitations.some(i => i.email === email))
                throw new HttpError(409, "Email already has an account or invitation");
            if (state.accounts.length >= 256 || state.invitations.length >= 100)
                throw new HttpError(409, "Account or invitation limit reached");
            state.invitations.push({ id, email, role, tokenHash: digest(token), expiresAt });
            return { result: { id, token, email, role, expiresAt }, audit: event("invited", a.id, id, "invitation-created") };
        });
    }
    async revoke(session: OperatorSession, id: string) {
        await this.store.changeIdentity(state => {
            const a = this.account(state, session, true);
            if (!state.invitations.some(i => i.id === id)) throw new HttpError(404, "Invitation not found");
            state.invitations = state.invitations.filter(i => i.id !== id);
            return { result: undefined, audit: event("invitation-revoked", a.id, id, "invitation-revoked") };
        });
    }
    async accept(input: unknown) {
        const body = z.object({ token: accountSchemas.token, name: accountSchemas.name, password: accountSchemas.password }).strict().parse(input);
        const tokenHash = digest(body.token);
        const preliminary = await this.store.identityState();
        if (!preliminary.initialized || !preliminary.invitations.some(i => i.tokenHash === tokenHash && i.expiresAt > Date.now()))
            throw invalidToken();
        this.pruneInvalidSessions(preliminary);
        const reservation = this.legacy.reserveSession();
        try {
          const passwordHash = await hashPassword(body.password);
          const account = await this.store.changeIdentity(state => {
            const i = state.invitations.find(i => i.tokenHash === tokenHash && i.expiresAt > Date.now());
            if (!state.initialized || !i)
                throw invalidToken();
            if (state.accounts.length >= 256 || state.accounts.some(a => a.email === i.email))
                throw new HttpError(409, "Account limit or duplicate email");
            const a: Account = { id: randomUUID(), name: body.name, email: i.email, role: i.role, tenant: "local", active: true, revision: 1, passwordHash };
            state.accounts.push(a);
            state.invitations = state.invitations.filter(inv => inv.id !== i.id);
            return { result: a, audit: event("invitation-accepted", a.id, a.id, "invitation-accepted") };
          });
          return reservation.issue(actorOf(account), "account", account.revision);
        } finally { reservation.release(); }
    }
    async changeMember(session: OperatorSession, id: string, input: unknown) {
        const patch = z.object({ role: accountSchemas.role.optional(), active: z.boolean().optional() }).strict().refine(p => Object.keys(p).length > 0).parse(input);
        const updated = await this.store.changeIdentity(state => {
            const actor = this.account(state, session, true), a = state.accounts.find(a => a.id === id);
            if (!a)
                throw new HttpError(404, "Account not found");
            Object.assign(a, patch);
            if (!state.accounts.some(a => a.active && a.role === "administrator"))
                throw new HttpError(409, "The last active administrator must remain enabled");
            a.revision++;
            return { result: {member: safeAccount(a), revision: a.revision}, audit: event("member-changed", actor.id, a.id, "authority-changed") };
        });
        this.pruneAccountSessions(updated.member.id, updated.revision);
        return updated.member;
    }
    async recovery(session: OperatorSession, id: string, input: unknown) {
        z.object({}).strict().parse(input);
        const token = randomBytes(32).toString("hex"), expiresAt = Date.now() + 15 * 60000;
        return this.store.changeIdentity(state => {
            const actor = this.account(state, session, true), a = state.accounts.find(a => a.id === id);
            if (!a)
                throw new HttpError(404, "Account not found");
            state.recoveries = state.recoveries.filter(r => r.accountId !== id && r.expiresAt > Date.now());
            state.recoveries.push({ accountId: id, tokenHash: digest(token), expiresAt });
            return { result: { token, expiresAt }, audit: event("recovery-issued", actor.id, id, "administrator-recovery") };
        });
    }
    async changePassword(session: OperatorSession, input: unknown) {
        const body = z.object({ currentPassword: accountSchemas.password, password: accountSchemas.password }).strict().parse(input);
        const account = this.account(await this.store.identityState(), session);
        if (!await verifyPassword(body.currentPassword, account.passwordHash))
            throw new HttpError(401, "Invalid current password");
        const passwordHash = await hashPassword(body.password);
        const updated = await this.store.changeIdentity(state => {
            const a = this.account(state, session);
            a.passwordHash = passwordHash;
            a.revision++;
            state.recoveries = state.recoveries.filter(r => r.accountId !== a.id);
            return { result: {id: a.id, revision: a.revision}, audit: event("password-changed", a.id, a.id, "current-password-verified") };
        });
        this.pruneAccountSessions(updated.id, updated.revision);
    }
    async reset(input: unknown) {
        const body = z.object({ token: accountSchemas.token, password: accountSchemas.password }).strict().parse(input);
        const tokenHash = digest(body.token);
        if (!(await this.store.identityState()).recoveries.some(r => r.tokenHash === tokenHash && r.expiresAt > Date.now()))
            throw invalidToken();
        const passwordHash = await hashPassword(body.password);
        const updated = await this.store.changeIdentity(state => {
            const recovery = state.recoveries.find(r => r.tokenHash === tokenHash && r.expiresAt > Date.now());
            const a = state.accounts.find(a => a.id === recovery?.accountId);
            if (!a || !recovery)
                throw invalidToken();
            a.passwordHash = passwordHash;
            a.revision++;
            state.recoveries = state.recoveries.filter(r => r.accountId !== a.id);
            return { result: {id: a.id, revision: a.revision}, audit: event("password-reset", a.id, a.id, "recovery-token-consumed") };
        });
        this.pruneAccountSessions(updated.id, updated.revision);
    }
}
