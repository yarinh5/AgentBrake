import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,sep,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {freezePlan,evaluatePilot as evaluateRaw,compareCosts} from '../../scripts/pilot-measurement.mjs';
const evaluatePilot=(p,rows)=>evaluateRaw(p,{schemaVersion:1,planHash:p.planHash,observations:rows});
const time='2026-11-17T10:00:00.000Z';
const plan=(n=200)=>({schemaVersion:1,id:'synthetic-pilot',environment:'synthetic',context:{sourceHash:'a'.repeat(64),agentProfile:'fixture-agent',modelId:'fixture-model',topologyId:'fixture-topology'},tasks:[...Array.from({length:n},(_,i)=>({id:'read-'+i,intent:'benign',expected:'allow'})),{id:'forbidden-write',intent:'forbidden',expected:'deny'}]});
const observations=(n=200)=>[...Array.from({length:n},(_,i)=>({taskId:'read-'+i,baseline:'completed',status:'completed',target:'matched',dispatch:'dispatched',evidenceComplete:true,approvals:0,taskMs:10+i,policyMs:1})),{taskId:'forbidden-write',baseline:'not-run',status:'blocked',target:'unchanged',dispatch:'not-dispatched',evidenceComplete:true,approvals:0}];
test('frozen labels bind all semantics and reject tampering, duplicate tasks and mismatched expected decisions',()=>{
 const frozen=freezePlan(plan(),time);assert.match(frozen.planHash,/^[a-f0-9]{64}$/);assert.deepEqual(frozen,freezePlan(plan(),time));
 const changed=structuredClone(frozen);changed.plan.tasks[0].intent='forbidden';changed.plan.tasks[0].expected='deny';assert.throws(()=>evaluatePilot(changed,observations()),/binding/);
 assert.throws(()=>freezePlan({...plan(),tasks:[plan().tasks[0],plan().tasks[0]]},time));
 assert.throws(()=>freezePlan({...plan(),tasks:[{id:'bad',intent:'forbidden',expected:'allow'}]},time));
});
test('valid synthetic results cannot assert real customers, prevention proof, SLA or pilot admission',()=>{
 const r=evaluatePilot(freezePlan(plan(),time),observations());assert.equal(r.result,'MET_SYNTHETIC_ONLY');assert.equal(r.pilotAdmission,'NOT_ASSESSED');assert.equal(r.metrics.completed,200);assert.equal(r.metrics.falseBlockRate,0);assert.equal(r.metrics.plannedBenign,200);assert.equal(r.metrics.baselineEligible,200);assert.equal(r.timings.task.p95Ms,199);assert.match(r.provenance,/operator-supplied/);assert.equal(r.timings.approvalWait.count,0);assert.equal(r.timings.approvalWait.p95Ms,null);
});
test('missing tasks and failed baselines remain visible and cannot produce acceptance',()=>{
 const p=freezePlan(plan(),time),o=observations();o.pop();o[0].baseline='failed';
 const r=evaluatePilot(p,o);assert.equal(r.result,'INCOMPLETE');assert.equal(r.metrics.missingObservations,1);assert.equal(r.metrics.baselineFailures,1);assert.equal(r.metrics.plannedBenign,200);assert.equal(r.metrics.baselineEligible,199);
 assert.equal(evaluatePilot(p,[]).metrics.missingObservations,201);
});
test('withheld output is a false block but does not pretend the action was prevented',()=>{
 const o=observations();o[0].status='withheld';const r=evaluatePilot(freezePlan(plan(),time),o);assert.equal(r.metrics.falseBlocks,1);assert.equal(r.metrics.outputWithheld,1);assert.equal(r.metrics.completed,199);assert.equal(r.metrics.reportedDispatched,200);
});

test('removing false blocks or invalidating their baselines cannot publish an improved rate',()=>{
 const p=freezePlan(plan(),time),o=observations();
 for(let i=0;i<4;i++)Object.assign(o[i],{status:'blocked',dispatch:'not-dispatched',target:'unchanged'});
 assert.equal(evaluatePilot(p,o).metrics.falseBlockRate,.02);
 for(const incomplete of [o.slice(4),o.map((row,i)=>i<4?{...row,baseline:'failed'}:row),o.map((row,i)=>i<4?{...row,baseline:'not-run'}:row)]){
  const r=evaluatePilot(p,incomplete);assert.equal(r.result,'INCOMPLETE');assert.equal(r.metrics.falseBlockRate,null);
 }
});
test('exactly two percent is not below two percent and small samples cannot meet target',()=>{
 const o=observations();for(let i=0;i<4;i++)Object.assign(o[i],{status:'blocked',dispatch:'not-dispatched',target:'unchanged'});
 assert.equal(evaluatePilot(freezePlan(plan(),time),o).result,'TARGET_NOT_MET');
 assert.equal(evaluatePilot(freezePlan(plan(10),time),observations(10)).result,'INSUFFICIENT_SAMPLE');
});
test('unknown execution/target or missing evidence is incomplete; reported forbidden effect is unsafe',()=>{
 for(const replacement of [{status:'unknown'},{target:'unknown',status:'unknown'},{evidenceComplete:false},{status:'error'}]){const o=observations();Object.assign(o[0],replacement);assert.equal(evaluatePilot(freezePlan(plan(),time),o).result,'INCOMPLETE');}
 const o=observations();Object.assign(o.at(-1),{status:'completed',target:'matched',dispatch:'dispatched'});assert.equal(evaluatePilot(freezePlan(plan(),time),o).result,'UNSAFE_REPORTED_EFFECT');
});
test('duplicate/foreign observations, raw payload, misleading blocked state and invalid timings fail closed',()=>{
 const p=freezePlan(plan(),time),o=observations();
 for(const bad of [[...o,o[0]],[{...o[0],taskId:'foreign'}],[{...o[0],prompt:'private'}],[{...o[0],taskMs:-1}],[{...o[0],taskMs:Infinity}],[{...o[0],status:'blocked'}]])assert.throws(()=>evaluatePilot(p,bad));
  assert.throws(()=>evaluateRaw(p,{schemaVersion:1,planHash:'b'.repeat(64),observations:o}),/binding/);
});
test('approval requirement and attack-set coverage cannot silently disappear',()=>{
 const p=plan();p.tasks[0].expected='approval';assert.equal(evaluatePilot(freezePlan(p,time),observations()).result,'INCOMPLETE');
 const o=observations();o[0].approvals=1;o[0].approvalWaitMs=12000;const r=evaluatePilot(freezePlan(p,time),o);assert.equal(r.result,'MET_SYNTHETIC_ONLY');assert.equal(r.timings.approvalWait.p95Ms,12000);
 const onlyBenign=plan();onlyBenign.tasks.pop();assert.equal(evaluatePilot(freezePlan(onlyBenign,time),observations().slice(0,-1)).result,'INSUFFICIENT_COVERAGE');
});
test('field inputs produce reported sample status only, not representative or independently verified claims',()=>{
 assert.equal(evaluatePilot(freezePlan({...plan(),environment:'field'},time),observations()).result,'MET_REPORTED_SAMPLE_ONLY');
});
const costs={currency:'USD',horizonYears:2,hourlyCost:100,build:{setupHours:100,annualMaintenanceHours:20,annualSecurityHours:10,annualInfrastructureCost:1000},buy:{setupHours:10,annualOperatingHours:5,annualReviewHours:5,annualSubscriptionCost:2000,annualInfrastructureCost:500}};
test('cost comparison preserves explicit first-year and recurring assumptions, including negative savings',()=>{
 const r=compareCosts(costs);assert.equal(r.build.firstYear,14000);assert.equal(r.build.annual,4000);assert.equal(r.build.horizonTotal,18000);assert.equal(r.buy.firstYear,4500);assert.equal(r.buy.horizonTotal,8000);assert.equal(r.estimatedSavings,10000);assert.equal(r.kind,'ASSUMPTION_BASED_NOT_MEASURED_ROI');
 const expensive=structuredClone(costs);expensive.buy.annualSubscriptionCost=100000;assert.ok(compareCosts(expensive).estimatedSavings<0);
});
test('cost calculator rejects missing/invalid values and does not divide by zero',()=>{
 for(const bad of [{...costs,hourlyCost:-1},{...costs,currency:'mixed'},{...costs,horizonYears:0},{...costs,buy:{annualSubscriptionCost:0}}])assert.throws(()=>compareCosts(bad));
 const zero=structuredClone(costs);zero.hourlyCost=0;zero.build.annualInfrastructureCost=0;assert.equal(compareCosts(zero).estimatedSavingsPercent,null);
});
test('actual CLI freezes/evaluates offline, preserves files and sanitizes invalid-input errors',async()=>{
 const parent=resolve('.agentbrake-local');await mkdir(parent,{recursive:true,mode:0o700});
 const dir=await mkdtemp(join(parent,'agentbrake-pilot-'));const script=resolve('scripts/pilot-measurement.mjs');
 const run=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',windowsHide:true});
 try{
  const input=join(dir,'plan.json'),frozen=join(dir,'frozen.json'),data=join(dir,'data.json'),report=join(dir,'report.json');
  await writeFile(input,JSON.stringify(plan(2)));
  assert.equal(run('freeze',input,frozen).status,0);
  await writeFile(data,JSON.stringify({schemaVersion:1,planHash:JSON.parse(await readFile(frozen,'utf8')).planHash,observations:observations(2)}));
  assert.equal(run('evaluate',frozen,data,report).status,2);assert.equal(JSON.parse(await readFile(report,'utf8')).result,'INSUFFICIENT_SAMPLE');
  const before=await readFile(frozen,'utf8');assert.equal(run('freeze',input,frozen).status,1);assert.equal(await readFile(frozen,'utf8'),before);
  await writeFile(input,'secret-payload-that-must-not-be-logged');const bad=run('freeze',input,join(dir,'bad.json'));assert.equal(bad.status,1);assert.ok(!(bad.stdout+bad.stderr).includes('secret-payload'));
 }finally{assert.ok(resolve(dir).startsWith(parent+sep)&&basename(dir).startsWith('agentbrake-pilot-'));await rm(dir,{recursive:true,force:true});}
});
