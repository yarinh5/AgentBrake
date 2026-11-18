import { createHash, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { ControlStore } from "../control-store.js";

export type AuditDeliveryOptions = {
  installationId: string;
  endpoint: string;
  bearerToken: string;
  checkpointPath: string;
  batchSize?: number;
  timeoutMs?: number;
  intervalMs?: number;
  /** Synthetic fixtures only. Never enable through production environment configuration. */
  allowLoopbackHttpForTests?: boolean;
};
export type AuditDeliveryError = "source_integrity" | "source_unavailable" | "transport" | "sink_status" | "invalid_ack" | "checkpoint_write";
export type AuditDeliveryStatus = {
  running: boolean;
  lastAckSequence: string;
  acknowledgedEvents: number;
  pendingAtLeast: number | null;
  hasMore: boolean | null;
  oldestPendingAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: AuditDeliveryError | null;
  consecutiveFailures: number;
};
export type AuditDelivery = {
  start(): void;
  tick(): Promise<AuditDeliveryStatus>;
  status(): AuditDeliveryStatus;
  close(): Promise<void>;
};
/** Trusted application wiring only; never deserialize this from user or environment input. */
export type AuditDeliveryTransport = { fetch: typeof globalThis.fetch };
type Event = { id: string; sequence: string; at: string; type: string; sourceHash: string; previousSourceHash: string };
type Cursor = { schemaVersion: 1; installationId: string; endpointHash: string; offset: number; sequence: string; hash: string; lastSuccessAt: string | null };
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const hashPattern = /^[a-f0-9]{64}$/;
const allowedTypes = new Set([
  "control.changed", "policy.changed", "agent.created", "agent.active", "agent.paused", "grant.issued", "grant.revoked",
  "approval.granted", "approval.blocked", "action.allowed", "action.blocked", "action.pending", "action.queued",
  "execution.started", "execution.allowed", "execution.failed", "execution.blocked", "execution.unknown",
  "rest.rejected", "mcp.response", "mcp.rejected", "retention.results-pruned",
  "identity.initialized", "identity.invited", "identity.invitation-accepted", "identity.invitation-revoked",
  "identity.profile-changed", "identity.member-changed", "identity.recovery-issued", "identity.password-changed", "identity.password-reset", "identity.break-glass-login",
  "identity.federated-login", "identity.scim-user-created", "identity.scim-user-updated", "identity.scim-user-deleted",
  "identity.scim-group-created", "identity.scim-group-updated", "identity.scim-group-deleted",
]);
class DeliveryFailure extends Error { constructor(readonly code: AuditDeliveryError) { super(code); } }
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));

async function regularFile(path: string) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 8192) throw Error("checkpoint invalid");
}
async function persist(path: string, cursor: Cursor) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const payload = JSON.stringify(cursor);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify({cursor, checksum:sha256(payload)}) + "\n");
    await file.sync();
  } finally { await file.close(); }
  try {
    try { await regularFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await rename(temporary, path);
    // POSIX needs directory fsync for durable rename. Windows does not support it.
    if (process.platform !== "win32") {
      const directory = await open(dirname(path), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await unlink(temporary).catch(() => {}); }
}

function validateAck(raw: string, events: Event[]) {
  try {
    const ack = JSON.parse(raw);
    if (!ack || Object.keys(ack).sort().join(",") !== "acceptedEventIds,schemaVersion" || ack.schemaVersion !== 1 ||
        !Array.isArray(ack.acceptedEventIds) || ack.acceptedEventIds.length !== events.length ||
        !events.every((event,index) => ack.acceptedEventIds[index] === event.id)) throw Error();
  } catch { throw new DeliveryFailure("invalid_ack"); }
}

async function deliverWithAdapter(endpoint: URL, token: string, events: Event[], body: string, timeoutMs: number, transport: AuditDeliveryTransport) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve,reject) => {
    timer=setTimeout(()=>{controller.abort();reject(new DeliveryFailure("transport"));},timeoutMs);
  });
  try {
    await Promise.race([deadline,(async()=>{
      const response=await transport.fetch(endpoint.href,{method:"POST",redirect:"error",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body,signal:controller.signal});
      if(response.status!==200 || response.redirected) {await response.body?.cancel();throw new DeliveryFailure("sink_status");}
      if(!response.body) throw new DeliveryFailure("invalid_ack");
      const reader=response.body.getReader();const chunks:Buffer[]=[];let size=0;
      try {
        while(true) {
          const {done,value}=await reader.read();if(done) break;
          size+=value.byteLength;
          if(size>65536) {await reader.cancel();throw new DeliveryFailure("invalid_ack");}
          chunks.push(Buffer.from(value));
        }
      } finally {reader.releaseLock();}
      validateAck(Buffer.concat(chunks).toString("utf8"),events);
    })()]);
  } catch(error) {throw error instanceof DeliveryFailure?error:new DeliveryFailure("transport");}
  finally {clearTimeout(timer!);controller.abort();}
}

function deliver(endpoint: URL, token: string, events: Event[], installationId: string, timeoutMs: number, transport?: AuditDeliveryTransport): Promise<void> {
  const body = JSON.stringify({schemaVersion:1, installationId, events});
  if(transport) return deliverWithAdapter(endpoint,token,events,body,timeoutMs,transport);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: DeliveryFailure) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const req = (endpoint.protocol === "https:" ? httpsRequest : httpRequest)(endpoint, {
      method:"POST", headers:{authorization:`Bearer ${token}`, "content-type":"application/json", "content-length":Buffer.byteLength(body)},
    }, res => {
      if (res.statusCode !== 200) { finish(new DeliveryFailure("sink_status")); res.destroy(); return; }
      let size = 0; const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 65536) { finish(new DeliveryFailure("invalid_ack")); res.destroy(); }
        else chunks.push(chunk);
      });
      res.on("error", () => finish(new DeliveryFailure("transport")));
      res.on("end", () => {
        try {
          validateAck(Buffer.concat(chunks).toString("utf8"),events);
          finish();
        } catch { finish(new DeliveryFailure("invalid_ack")); }
      });
    });
    const timer = setTimeout(() => { finish(new DeliveryFailure("transport")); req.destroy(); }, timeoutMs);
    req.on("error", () => finish(new DeliveryFailure("transport")));
    req.end(body);
  });
}

export async function createAuditDelivery(store: Pick<ControlStore, "auditTrail">, options: AuditDeliveryOptions, transport?: AuditDeliveryTransport): Promise<AuditDelivery> {
  let endpoint: URL;
  const batchSize = options.batchSize ?? 100;
  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 5000;
  try {
    endpoint = new URL(options.endpoint);
    const loopback = options.allowLoopbackHttpForTests === true && endpoint.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(endpoint.hostname);
    if ((!loopback && endpoint.protocol !== "https:") || endpoint.username || endpoint.password || endpoint.hash ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(options.installationId) ||
        !/^[\x21-\x7E]{8,4096}$/.test(options.bearerToken) || !isAbsolute(options.checkpointPath) ||
        !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500 ||
        !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000 ||
        !Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 3600000) throw Error();
  } catch { throw Error("Invalid audit delivery configuration"); }
  const installationId = options.installationId;
  const token = options.bearerToken;
  const path = options.checkpointPath;
  const endpointHash = sha256(endpoint.href);
  await mkdir(dirname(path), {recursive:true, mode:0o700});
  let lock: Awaited<ReturnType<typeof open>>;
  try { lock = await open(`${path}.lock`, "wx", 0o600); }
  catch { throw Error("Audit delivery lock unavailable; only one writer is permitted"); }
  let cursor: Cursor = {schemaVersion:1, installationId, endpointHash, offset:0, sequence:"0", hash:"genesis", lastSuccessAt:null};
  try {
    try {
      await regularFile(path);
      const saved = JSON.parse(await readFile(path,"utf8"));
      const c = saved.cursor;
      if (!c || saved.checksum !== sha256(JSON.stringify(c)) || c.schemaVersion !== 1 || c.installationId !== installationId || c.endpointHash !== endpointHash ||
          !Number.isSafeInteger(c.offset) || c.offset < 0 || typeof c.sequence !== "string" || !/^(0|[1-9]\d*)$/.test(c.sequence) ||
          !(c.lastSuccessAt === null || validDate(c.lastSuccessAt)) ||
          (c.offset === 0 ? c.sequence !== "0" || c.hash !== "genesis" : BigInt(c.sequence) < 1n || !hashPattern.test(c.hash))) throw Error();
      cursor = c;
    } catch(error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw Error("Invalid audit delivery checkpoint");
      await persist(path,cursor);
    }
  } catch(error) { await lock.close(); await unlink(`${path}.lock`); throw error; }
  let state: AuditDeliveryStatus = {running:false,lastAckSequence:cursor.sequence,acknowledgedEvents:cursor.offset,pendingAtLeast:null,hasMore:null,oldestPendingAt:null,lastAttemptAt:null,lastSuccessAt:cursor.lastSuccessAt,lastError:null,consecutiveFailures:0};
  let closed = false;
  let inFlight: Promise<AuditDeliveryStatus> | undefined;
  let closing: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function run(): Promise<AuditDeliveryStatus> {
    state.lastAttemptAt = new Date().toISOString();
    try {
      let rows: Awaited<ReturnType<ControlStore["auditTrail"]>>;
      try { rows = await store.auditTrail({offset:Math.max(0,cursor.offset-1),limit:batchSize+1+(cursor.offset > 0 ? 1 : 0)}); }
      catch { throw new DeliveryFailure("source_unavailable"); }
      let previous = cursor.hash;
      let sequence = BigInt(cursor.sequence);
      if (cursor.offset > 0) {
        const anchor = rows.shift();
        if (!anchor || String(anchor.seq) !== cursor.sequence || anchor.hash !== cursor.hash || sha256(anchor.previous_hash+anchor.data) !== anchor.hash) throw new DeliveryFailure("source_integrity");
      }
      const events: Event[] = [];
      try {
        for(const row of rows) {
          if ((typeof row.seq === "number" && !Number.isSafeInteger(row.seq)) || BigInt(row.seq) <= sequence || row.previous_hash !== previous || !hashPattern.test(row.hash) || sha256(previous+row.data) !== row.hash) throw Error();
          const data = JSON.parse(row.data);
          if (!validDate(data.at) || typeof data.type !== "string") throw Error();
          sequence = BigInt(row.seq); previous = row.hash;
          events.push({id:`${installationId}:${sequence}`,sequence:String(sequence),at:data.at,type:allowedTypes.has(data.type)?data.type:"audit.other",sourceHash:row.hash,previousSourceHash:row.previous_hash});
        }
      } catch { throw new DeliveryFailure("source_integrity"); }
      state.pendingAtLeast = events.length; state.hasMore = events.length > batchSize; state.oldestPendingAt = events[0]?.at ?? null;
      const batch = events.slice(0,batchSize);
      if (batch.length) {
        await deliver(endpoint,token,batch,installationId,timeoutMs,transport);
        const last = batch[batch.length-1];
        const next: Cursor = {...cursor,offset:cursor.offset+batch.length,sequence:last.sequence,hash:last.sourceHash,lastSuccessAt:new Date().toISOString()};
        try { await persist(path,next); } catch { throw new DeliveryFailure("checkpoint_write"); }
        cursor = next;
        state.lastAckSequence = cursor.sequence; state.acknowledgedEvents = cursor.offset; state.lastSuccessAt = cursor.lastSuccessAt;
        state.pendingAtLeast = events.length-batch.length; state.oldestPendingAt = events[batch.length]?.at ?? null;
      }
      state.lastError = null; state.consecutiveFailures = 0;
    } catch(error) {
      state.lastError = error instanceof DeliveryFailure ? error.code : "source_integrity";
      state.consecutiveFailures++;
      if (state.lastError.startsWith("source_")) { state.pendingAtLeast = null; state.hasMore = null; state.oldestPendingAt = null; }
    }
    return {...state};
  }
  const api: AuditDelivery = {
    status: () => ({...state}),
    tick() {
      if (closed) return Promise.reject(Error("Audit delivery is closed"));
      if (!inFlight) inFlight = run().finally(() => {inFlight=undefined;});
      return inFlight;
    },
    start() {
      if (closed) throw Error("Audit delivery is closed");
      if (state.running) return;
      state.running = true;
      const poll = async () => {
        if (closed) return;
        await api.tick();
        if (!closed) {
          // Bound retries during sink outage, without discarding retained source events.
          timer = setTimeout(poll,Math.min(3600000,intervalMs * 2 ** Math.min(state.consecutiveFailures,8)));
          timer.unref();
        }
      };
      void poll();
    },
    close() {
      if (closing) return closing;
      closed = true; state.running = false; if (timer) clearTimeout(timer);
      closing = (async () => {await inFlight; await lock.close(); await unlink(`${path}.lock`);})();
      return closing;
    },
  };
  return api;
}
