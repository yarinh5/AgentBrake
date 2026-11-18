// Bounded local synthetic profile. Never interpret these measurements as an SLA.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { cpus, totalmem, freemem, platform, arch, release, availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createApp } from '../../server/app.ts';
import { createFixtureTarget } from '../../server/fixture-target.ts';
import { OpaEvaluator } from '../../server/policy/opa-client.ts';
import { canonical, digest } from '../../server/store.ts';
import { startOpa } from '../../scripts/opa-runtime.mjs';
import { sourceManifest } from '../../scripts/source-manifest.mjs';

const runId = randomUUID(), output = resolve('docs/evidence/enterprise-capacity-' + runId);
const workload = Object.freeze({ requestsPerCell: 48, concurrency: [1, 4, 8], replayCopies: 4, workloads: ['read', 'replay', 'forbidden'], httpDeadlineMs: 10000, policyDeadlineMs: 250, warmupCalls: 0 });
const source = await sourceManifest(), hardware = cpus();
const report = {
  schema: 1, runId, startedAt: new Date().toISOString(), result: 'RUNNING',
  scope: 'Bounded single-process local synthetic HTTP/control-path profile with real OPA and isolated HTTP fixture; not production PostgreSQL, HA, capacity limit or SLA evidence.',
  sourceHash: source.sourceHash, workload,
  environment: { node: process.version, platform: platform(), architecture: arch(), osRelease: release(), cpuModel: hardware[0]?.model ?? 'UNKNOWN', logicalCpus: hardware.length, availableParallelism: availableParallelism(), totalMemoryBytes: totalmem(), freeMemoryBytesAtStart: freemem(), controlStore: 'disposable file-backed SQLite WAL', targetStore: 'independent in-memory SQLite fixture', clientAndServersSameNodeProcess: true, opaSeparateProcess: true },
  cells: [], cleanup: { appClosed: false, targetClosed: false, opaStopped: false, temporaryFilesRemoved: false },
};
await mkdir(output, { recursive: true, mode: 0o700 });
const temporaryRoot = resolve('.agentbrake-local');
await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
const temporary = await mkdtemp(join(temporaryRoot, 'enterprise-capacity-'));
let opa, target, targetServer, system, appServer;
const originalTemp = process.env.TEMP, originalTmp = process.env.TMP, originalTmpdir = process.env.TMPDIR;
const listen = async app => { const server = app.listen(0,'127.0.0.1'); await new Promise((res,rej)=>{server.once('listening',res);server.once('error',rej);}); return server; };
const origin = server => 'http://127.0.0.1:' + server.address().port;
const closeServer = async server => { if(!server)return;server.closeAllConnections();await new Promise((res,rej)=>server.close(error=>error?rej(error):res())); };
const percentile = (samples,p) => samples.slice().sort((a,b)=>a-b)[Math.max(0,Math.ceil(samples.length*p)-1)];
const round = n => Math.round(n*1000)/1000;
const increment = (counts,key) => { counts[key]=(counts[key]??0)+1; };
const targetStateHash = ({calls,...state}) => digest(canonical(state));
try {
  // Reuse the verified OPA helper while keeping its credential temp file inside
  // this run's workspace scope. No installed OPA/service configuration changes.
  process.env.TEMP=temporary;process.env.TMP=temporary;process.env.TMPDIR=temporary;
  opa=await startOpa();
  report.policy={version:opa.version,hash:opa.policyHash,deadlineMs:workload.policyDeadlineMs};
  const targetToken=randomBytes(32).toString('hex'), observer=randomBytes(32).toString('hex');
  target=createFixtureTarget(targetToken,observer); targetServer=await listen(target.app);
  const snapshot=async()=>{
    const response=await fetch(origin(targetServer)+'/snapshot',{headers:{Authorization:'Bearer '+observer},signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,200,'Observer snapshot must be independently available');return response.json();
  };
  system=createApp({databasePath:join(temporary,'control.sqlite'),adminKey:randomBytes(32).toString('hex'),connections:{fixture:{url:origin(targetServer),token:targetToken}},policy:new OpaEvaluator({url:opa.url,token:opa.token,timeoutMs:workload.policyDeadlineMs})});
  appServer=await listen(system.app);
  for(const concurrency of workload.concurrency) {
    for(const kind of workload.workloads) {
      const {agent,token}=system.store.createAgent({name:'Synthetic capacity fixture',tools:['database_read'],resources:['customers'],sandbox:true});
      assert.equal(agent.grant.max_calls,1000,'Keep default quota; do not hide grant exhaustion by modifying it');
      const requestIds=Array.from({length:kind==='replay'?12:48},()=>randomUUID());
      const before=await snapshot(), samples=[], responses=[], httpStatuses={}, recordStatuses={};
      let cursor=0,active=0,peak=0;
      const cpuBefore=process.cpuUsage(),memoryBefore=process.memoryUsage(),started=performance.now();
      async function worker(){
        while(cursor<workload.requestsPerCell){
          const index=cursor++, requestId=requestIds[kind==='replay'?Math.floor(index/workload.replayCopies):index], beginning=performance.now();
          active++;peak=Math.max(peak,active);
          try {
            const response=await fetch(origin(appServer)+'/api/actions',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({requestId,tool:kind==='forbidden'?'database_delete':'database_read',arguments:kind==='forbidden'?{}:{limit:2}}),redirect:'error',signal:AbortSignal.timeout(workload.httpDeadlineMs)});
            const body=await response.json();
            responses.push({requestId,httpStatus:response.status,status:body.status,actionId:body.id,rows:body.result?.rows?.length});
            increment(httpStatuses,String(response.status));increment(recordStatuses,['allowed','blocked','pending','failed','unknown','queued','executing'].includes(body.status)?body.status:'invalid');
          }catch{responses.push({requestId,httpStatus:0,status:'transport-error'});increment(httpStatuses,'transport-error');increment(recordStatuses,'transport-error');}
          finally{samples.push(performance.now()-beginning);active--;}
        }
      }
      await Promise.all(Array.from({length:concurrency},()=>worker()));
      const elapsedMs=performance.now()-started,cpu=process.cpuUsage(cpuBefore),after=await snapshot();
      const expectedStatus=kind==='forbidden'?'blocked':'allowed',successful=responses.filter(r=>r.httpStatus===200&&r.status===expectedStatus&&(kind==='forbidden'||r.rows===2));
      const groups=new Map();for(const response of responses){const group=groups.get(response.requestId)??new Set();if(response.actionId)group.add(response.actionId);groups.set(response.requestId,group);}
      const expectedTargetCalls=kind==='forbidden'?0:requestIds.length,observedTargetCalls=after.calls-before.calls;
      const cell={workload:kind,concurrency,observedPeakInFlight:peak,requests:responses.length,expectedUniqueRequests:requestIds.length,expectedStatus,successes:successful.length,unexpectedDenials:kind==='forbidden'?0:responses.filter(r=>r.status==='blocked'||[401,403,429].includes(r.httpStatus)).length,unexpectedAllows:kind==='forbidden'?responses.filter(r=>r.status==='allowed').length:0,unexpectedOutcomes:responses.length-successful.length,replayResponses:kind==='replay'?responses.length-groups.size:0,requestGroupsWithDifferentActionIds:[...groups.values()].filter(ids=>ids.size!==1).length,httpStatuses,recordStatuses,expectedTargetCalls,observedTargetCalls,unexpectedDuplicateExecutions:Math.max(0,observedTargetCalls-expectedTargetCalls),targetStateUnchanged:targetStateHash(before)===targetStateHash(after),targetBeforeHash:targetStateHash(before),targetAfterHash:targetStateHash(after),latencyMs:{p50:round(percentile(samples,.5)),p95:round(percentile(samples,.95)),max:round(Math.max(...samples))},elapsedMs:round(elapsedMs),observedRequestsPerSecond:round(responses.length/(elapsedMs/1000)),nodeCpuMicroseconds:cpu,nodeRssBefore:memoryBefore.rss,nodeRssAfter:process.memoryUsage().rss,auditChainValid:system.store.verifyAudit()};
      report.cells.push(cell);
      assert.equal(cell.successes,48,'Unexpected HTTP/action outcome');assert.equal(observedTargetCalls,expectedTargetCalls,'Independent target execution count mismatch');assert.equal(cell.targetStateUnchanged,true,'Read/forbidden workloads changed target state');assert.equal(cell.requestGroupsWithDifferentActionIds,0,'Request replay lost action identity');assert.equal(cell.auditChainValid,true,'Audit integrity failed');
      console.log(JSON.stringify({workload:kind,concurrency,successes:cell.successes,targetCalls:observedTargetCalls,p95Ms:cell.latencyMs.p95}));
    }
  }
  report.result='PASS_BOUNDED_LOCAL_PROFILE';
}catch {
  report.result='FAIL_BOUNDED_LOCAL_PROFILE';report.failure='Workload acceptance, setup or fixture observation failed; inspect aggregate cells. Raw errors and response bodies are intentionally excluded.';process.exitCode=1;
}finally{
  const cleanup=async(name,work)=>{try{await work();report.cleanup[name]=true;}catch{report.cleanup[name]=false;report.result='FAIL_CLEANUP';process.exitCode=1;}};
  await cleanup('appClosed',async()=>{await closeServer(appServer);await system?.close();});
  await cleanup('targetClosed',async()=>{await closeServer(targetServer);await target?.close();});
  await cleanup('opaStopped',async()=>{await opa?.stop();});
  if(originalTemp===undefined)delete process.env.TEMP;else process.env.TEMP=originalTemp;
  if(originalTmp===undefined)delete process.env.TMP;else process.env.TMP=originalTmp;
  if(originalTmpdir===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=originalTmpdir;
  await cleanup('temporaryFilesRemoved',async()=>{assert.ok(resolve(temporary).startsWith(temporaryRoot+sep));await rm(temporary,{recursive:true,force:true});});
  const finalSource=await sourceManifest();report.sourceHashAtEnd=finalSource.sourceHash;report.sourceStableDuringRun=source.sourceHash===finalSource.sourceHash;
  report.finishedAt=new Date().toISOString();report.resources={nodePeakRssBytes:process.resourceUsage().maxRSS*1024,nodeFinalMemory:process.memoryUsage(),freeMemoryBytesAtEnd:freemem(),measurementScope:'Node client/control/fixture process only; OPA CPU and peak RSS excluded'};
  await writeFile(join(output,'summary.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({result:report.result,summary:join(output,'summary.json'),sourceStableDuringRun:report.sourceStableDuringRun}));
}
