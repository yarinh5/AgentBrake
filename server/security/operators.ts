import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HttpError } from "../contracts.js";
import { digest } from "../store.js";

export type OperatorRole = "administrator" | "operator" | "approver" | "viewer";
export type OperatorIdentity = {
  id: string;
  name: string;
  tenant: string;
  role: OperatorRole;
};
export type OperatorCredential = OperatorIdentity & { key: string };
const operatorSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    name: z.string().min(1).max(80),
    tenant: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    role: z.enum(["administrator", "operator", "approver", "viewer"]),
    key: z.string().min(24).max(200),
  })
  .strict();
const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
export type OperatorSession = {
  actor: OperatorIdentity;
  expiresAt: number;
  csrfToken: string;
  authMode?: "key" | "account";
  revision?: number;
};
export class LocalOperators {
  private identities: { actor: OperatorIdentity; keyHash: string }[];
  private sessions = new Map<string, OperatorSession>();
  private reservations = new Set<symbol>();
  readonly team: boolean;
  constructor(adminKey: string, configured?: OperatorCredential[]) {
    this.team = configured !== undefined;
    const operators = z
      .array(operatorSchema)
      .min(1)
      .max(32)
      .parse(
        configured ?? [
          {
            id: "local-administrator",
            name: "Local owner",
            tenant: "local",
            role: "administrator",
            key: adminKey,
          },
        ],
      );
    if (
      new Set(operators.map((o) => o.id)).size !== operators.length ||
      new Set(operators.map((o) => digest(o.key))).size !== operators.length
    )
      throw Error("Operator identities and credentials must be unique");
    if (
      !operators.some((o) => o.tenant === "local" && o.role === "administrator")
    )
      throw Error("A local administrator is required");
    this.identities = operators.map(({ key, ...actor }) => ({
      actor,
      keyHash: digest(key),
    }));
  }
  credential(key: string) {
    const hashed = digest(key);
    const matched = this.identities.find((o) => equal(o.keyHash, hashed));
    if (!matched) throw new HttpError(401, "Invalid operator credential");
    if (matched.actor.tenant !== "local")
      throw new HttpError(403, "Tenant access denied");
    return matched.actor;
  }
  login(key: string) {
    return this.issue(this.credential(key), "key");
  }
  issue(actor: OperatorIdentity, authMode: "key" | "account", revision?: number) {
    return this.reserveSession().issue(actor, authMode, revision);
  }
  pruneSessions(keep: (session: OperatorSession) => boolean) {
    for (const [id, session] of this.sessions)
      if (session.expiresAt <= Date.now() || !keep(session)) this.sessions.delete(id);
  }
  // Reserve capacity and generate secrets before a durable operation. Bootstrap
  // may replace key sessions, but must leave them usable until its audit commits.
  reserveSession(replaceKeys = false) {
    this.pruneSessions(() => true);
    const occupied = replaceKeys
      ? [...this.sessions.values()].filter(s => s.authMode !== "key").length
      : this.sessions.size;
    if (occupied + this.reservations.size >= 256)
      throw new HttpError(429, "Session limit reached");
    const token = randomBytes(32).toString("hex");
    const csrfToken = randomBytes(32).toString("hex");
    const id = digest(token), reservation = Symbol();
    this.reservations.add(reservation);
    const release = () => { this.reservations.delete(reservation); };
    return {
      release,
      issue: (actor: OperatorIdentity, authMode: "key" | "account", revision?: number) => {
        if (!this.reservations.has(reservation)) throw Error("Session reservation is no longer available");
        if (replaceKeys) this.pruneSessions(s => s.authMode !== "key");
        const session = { actor, expiresAt: Date.now() + 8 * 3600_000, csrfToken, authMode, revision };
        this.sessions.set(id, session);
        release();
        return { token, ...session };
      },
    };
  }
  authenticate(cookie?: string) {
    const token = cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("ab_session="))
      ?.slice(11);
    const session = token ? this.sessions.get(digest(token)) : undefined;
    if (
      !session ||
      session.expiresAt <= Date.now() ||
      session.actor.tenant !== "local"
    )
      throw new HttpError(401, "Operator sign-in required");
    return session;
  }
  checkCsrf(session: OperatorSession, token: unknown) {
    if (
      this.team &&
      (typeof token !== "string" || !equal(session.csrfToken, token))
    )
      throw new HttpError(403, "Session verification required");
  }
  logout(cookie?: string) {
    const token = cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("ab_session="))
      ?.slice(11);
    if (token) this.sessions.delete(digest(token));
  }
}
