import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Store } from "../../server/store.js";
import { createAuditDelivery } from "../../server/enterprise/audit-delivery.js";

async function fixture(t: any) {
  const dir = await mkdtemp(join(tmpdir(), "agentbrake-audit-"));
  const store = new Store(join(dir, "store.sqlite"));
  const requests: { body: any; auth?: string }[] = [];
  let respond = (_req: IncomingMessage, res: ServerResponse, body: any) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({schemaVersion: 1, acceptedEventIds: body.events.map((e: any) => e.id)}));
  };
  const sink = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({body, auth:req.headers.authorization});
    respond(req, res, body);
  });
  await new Promise<void>(r => sink.listen(0, "127.0.0.1", r));
  const address = sink.address() as {port:number};
  const options = {installationId:"fixture-installation", endpoint:`http://127.0.0.1:${address.port}/events`, bearerToken:"synthetic-bearer-token", checkpointPath:join(dir,"cursor.json"), allowLoopbackHttpForTests:true, batchSize:2, timeoutMs:150};
  const workers: Awaited<ReturnType<typeof createAuditDelivery>>[] = [];
  const open = async (overrides = {}, transport?: {fetch:typeof globalThis.fetch}) => {const worker = await createAuditDelivery(store, {...options,...overrides}, transport); workers.push(worker); return worker;};
  t.after(async () => {
    for (const worker of workers) await worker.close();
    sink.closeAllConnections();
    await new Promise<void>(r => sink.close(() => r()));
    store.close();
    await rm(dir,{recursive:true,force:true});
  });
  return {store, requests, open, options, dir, respond: (fn: typeof respond) => {respond=fn;}};
}

test("delivers bounded redacted authenticated batches and resumes durable cursor", async t => {
  const f = await fixture(t);
  f.store.audit("agent.created", {token:"secret-token", email:"private@example.test", arguments:{password:"secret"}, result:"private", error:"private-error"});
  f.store.audit("malicious-private-type@example.test", {anything:"secret"});
  f.store.audit("control.changed", {paused:true});
  const worker = await f.open();
  const status = await worker.tick();
  assert.equal(status.lastAckSequence,"2");
  assert.equal(status.pendingAtLeast,1);
  assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].auth,"Bearer synthetic-bearer-token");
  const events = f.requests[0].body.events;
  assert.equal(events.length,2);
  assert.equal(events[0].id,"fixture-installation:1");
  assert.equal(events[0].sourceHash,f.store.auditTrail()[0].hash);
  assert.equal(events[1].type,"audit.other");
  assert.deepEqual(Object.keys(events[0]).sort(),["at","id","previousSourceHash","sequence","sourceHash","type"].sort());
  assert.doesNotMatch(JSON.stringify(f.requests[0].body),/secret|private|@example|password|arguments|result|error/);
  await worker.close();
  const restarted = await f.open();
  await restarted.tick();
  assert.equal(f.requests[1].body.events[0].id,"fixture-installation:3");
  assert.equal(restarted.status().pendingAtLeast,0);
  assert.equal(JSON.parse(await readFile(f.options.checkpointPath,"utf8")).cursor.offset,3);
});

for (const failure of ["429","500","bad-ack","partial-ack","redirect","lost-ack","large-ack"]) {
  test(`does not advance on ${failure}; retries same IDs after restart`,async t => {
    const f=await fixture(t); f.store.audit("control.changed",{});
    f.respond((_req,res,body)=>{
      if(failure==="lost-ack") {res.destroy(); return;}
      if(failure==="redirect") {res.writeHead(307,{Location:"/redirected"});res.end();return;}
      if(failure==="429"||failure==="500") {res.statusCode=Number(failure);res.end("secret-error-payload");return;}
      if(failure==="large-ack") {res.end("x".repeat(100_000));return;}
      res.end(JSON.stringify({schemaVersion:1,acceptedEventIds:failure==="partial-ack"?[]:[body.events[0].id+"-wrong"]}));
    });
    const worker=await f.open(); const status=await worker.tick();
    assert.equal(status.lastAckSequence,"0"); assert.equal(status.consecutiveFailures,1);
    assert.doesNotMatch(JSON.stringify(status),/synthetic-bearer|secret-error/);
    assert.equal(f.requests.length,1);
    await worker.close();
    f.respond((_req,res,body)=>res.end(JSON.stringify({schemaVersion:1,acceptedEventIds:body.events.map((e:any)=>e.id)})));
    const restarted=await f.open(); await restarted.tick();
    assert.equal(restarted.status().lastAckSequence,"1");
    assert.deepEqual(f.requests[0].body,f.requests[1].body);
  });
}

test("exclusive writer lock and concurrent ticks cannot double send",async t=>{
  const f=await fixture(t);f.store.audit("control.changed",{});
  const worker=await f.open();
  await assert.rejects(f.open(),/lock/i);
  await Promise.all([worker.tick(),worker.tick(),worker.tick()]);
  assert.equal(f.requests.length,1);
  await worker.close(); await worker.close();
  assert.equal((await f.open()).status().lastAckSequence,"1");
});

test("rejects corrupted source and retained-chain deletion without advancing",async t=>{
  const f=await fixture(t);for(let i=0;i<4;i++) f.store.audit("control.changed",{});
  const worker=await f.open(); await worker.tick();
  f.store.db.exec("DROP TRIGGER audit_no_delete; DELETE FROM audit WHERE seq=3");
  const status=await worker.tick();
  assert.equal(status.lastError,"source_integrity");assert.equal(status.lastAckSequence,"2");
  assert.equal(f.requests.length,1);
});

test("accepts sequence allocation gaps when retained hash chain is intact",async t=>{
  const f=await fixture(t);f.store.audit("control.changed",{});
  f.store.db.exec("UPDATE sqlite_sequence SET seq=10 WHERE name='audit'");
  f.store.audit("control.changed",{});
  const worker=await f.open(); await worker.tick();
  assert.equal(worker.status().lastAckSequence,"11");
  assert.deepEqual(f.requests[0].body.events.map((e:any)=>e.sequence),["1","11"]);
});

test("rejects a corrupt checkpoint and changing installation or sink identity",async t=>{
  const f=await fixture(t);f.store.audit("control.changed",{});
  const worker=await f.open();await worker.tick();await worker.close();
  await assert.rejects(f.open({installationId:"another-installation"}),/checkpoint/i);
  await assert.rejects(f.open({endpoint:f.options.endpoint+"other"}),/checkpoint/i);
  await writeFile(f.options.checkpointPath,"{broken");
  await assert.rejects(f.open(),/checkpoint/i);
});

test("refuses insecure endpoints unless literal loopback test exception is explicit",async t=>{
  const f=await fixture(t);
  for(const override of [{allowLoopbackHttpForTests:false},{endpoint:"http://example.test/events"},{endpoint:"https://u:p@example.test/events"},{endpoint:"https://example.test/events#fragment"},{bearerToken:"bad\r\nvalue"}]) {
    await assert.rejects(f.open(override),/configuration/i);
  }
});

test("timeouts leave the durable cursor unchanged and close drains in-flight delivery",async t=>{
  const f=await fixture(t);f.store.audit("control.changed",{});f.respond(()=>{});
  const worker=await f.open(); const tick=worker.tick();await worker.close();
  assert.equal((await tick).lastAckSequence,"0");
  assert.equal(worker.status().lastError,"transport");
  await assert.rejects(worker.tick(),/closed/i);
});

test("rejects edited source bytes and missing acknowledged anchor",async t=>{
  const f=await fixture(t);for(let i=0;i<3;i++) f.store.audit("control.changed",{});
  const worker=await f.open();await worker.tick();
  f.store.db.exec("DROP TRIGGER audit_no_update; UPDATE audit SET data='{}' WHERE seq=3");
  assert.equal((await worker.tick()).lastError,"source_integrity");
  f.store.db.exec("DROP TRIGGER audit_no_delete; DELETE FROM audit WHERE seq=1");
  assert.equal((await worker.tick()).lastError,"source_integrity");
  assert.equal(f.requests.length,1);
});

test("checkpoint write failure preserves replay and never exposes the filesystem error",async t=>{
  const f=await fixture(t);f.store.audit("control.changed",{});
  const worker=await f.open();
  // An invalid target must not be silently overwritten after the sink accepted.
  await rm(f.options.checkpointPath);
  const {mkdir} = await import("node:fs/promises");
  await mkdir(f.options.checkpointPath);
  const status=await worker.tick();
  assert.equal(status.lastError,"checkpoint_write");assert.equal(status.lastAckSequence,"0");
  assert.doesNotMatch(JSON.stringify(status),/agentbrake-audit-|cursor\.json/);
  await rm(f.options.checkpointPath,{recursive:true});
  await worker.tick();
  assert.equal(worker.status().lastAckSequence,"1");
  assert.deepEqual(f.requests[0].body,f.requests[1].body);
});

test("start polls newly appended events and close stops polling",async t=>{
  const f=await fixture(t); const worker=await f.open({intervalMs:100});worker.start();worker.start();
  f.store.audit("control.changed",{});
  const deadline=Date.now()+2000;
  while(worker.status().lastAckSequence!=="1" && Date.now()<deadline) await new Promise(r=>setTimeout(r,20));
  assert.equal(worker.status().lastAckSequence,"1");
  assert.equal(f.requests.length,1);
  await worker.close();f.store.audit("control.changed",{});
  await new Promise(r=>setTimeout(r,150));
  assert.equal(f.requests.length,1);assert.equal(worker.status().running,false);
});

test("preserves security event categories emitted by account and grant changes",async t=>{
  const f=await fixture(t);
  const types=["identity.break-glass-login","identity.member-changed","identity.password-reset","grant.revoked","agent.paused","action.pending","execution.allowed"];
  for(const type of types) f.store.audit(type,{email:"secret@example.test"});
  const worker=await f.open({batchSize:20});await worker.tick();
  assert.deepEqual(f.requests[0].body.events.map((e:any)=>e.type),types);
});

test("fixed egress adapter receives only configured URL and remains subject to exact ACK",async t=>{
  const f=await fixture(t);f.store.audit("control.changed",{});
  let calls=0;
  const worker=await f.open({}, {fetch:async (url,init)=>{
    calls++;assert.equal(String(url),f.options.endpoint);assert.equal(init?.redirect,"error");assert.ok(init?.signal);
    return globalThis.fetch(url,init);
  }});
  f.respond((_req,res)=>res.end(JSON.stringify({schemaVersion:1,acceptedEventIds:["not-our-event"]})));
  assert.equal((await worker.tick()).lastError,"invalid_ack");
  assert.equal(calls,1);assert.equal(worker.status().lastAckSequence,"0");
  f.respond((_req,res,body)=>res.end(JSON.stringify({schemaVersion:1,acceptedEventIds:body.events.map((e:any)=>e.id)})));
  assert.equal((await worker.tick()).lastAckSequence,"1");
});

test("crashed writer fails closed until verified stale lock recovery, then resumes checkpoint",async t=>{
  const f=await fixture(t);f.store.audit("control.changed",{});
  const source=`import {Store} from './server/store.ts'; import {createAuditDelivery} from './server/enterprise/audit-delivery.ts'; const store=new Store(${JSON.stringify(join(f.dir,"store.sqlite"))}); const worker=await createAuditDelivery(store,${JSON.stringify(f.options)}); const result=await worker.tick(); process.exit(result.lastAckSequence==='1'?17:18);`;
  const child=spawn(process.execPath,["--import","tsx","--input-type=module","-e",source],{cwd:process.cwd(),windowsHide:true,stdio:"ignore"});
  const code=await new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});
  assert.equal(code,17);
  await assert.rejects(f.open(),/lock/i);
  // The process exit above is the evidence required before an operator removes a stale lock.
  await rm(f.options.checkpointPath+".lock");
  const restarted=await f.open();await restarted.tick();
  assert.equal(restarted.status().lastAckSequence,"1");assert.equal(f.requests.length,1);
});

for(const failure of ["oversized","redirect","timeout"]) {
  test(`egress adapter ${failure} cannot advance cursor`,async t=>{
    const f=await fixture(t);f.store.audit("control.changed",{});
    f.respond((_req,res)=>{
      if(failure==="timeout") return;
      if(failure==="redirect") {res.writeHead(307,{location:"/other"});res.end();return;}
      res.end("x".repeat(100000));
    });
    const worker=await f.open({}, {fetch:globalThis.fetch});
    const status=await worker.tick();assert.equal(status.lastAckSequence,"0");assert.ok(status.lastError);assert.equal(f.requests.length,1);
  });
}
