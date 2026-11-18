import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rm,readdir,stat} from 'node:fs/promises';
import {resolve,join,basename,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {request} from 'node:https';
import {execFileSync} from 'node:child_process';
import {tsImport} from 'tsx/esm/api';
import {initializeProduct,productConfig,composeProduct,dockerProduct} from '../scripts/product.mjs';
import {configureCandidate} from '../scripts/candidate-config.mjs';
import {startProduct,backupProduct,restoreProduct,inspectBackup,installationStatus} from '../scripts/product-maintenance.mjs';
import {sourceManifest} from '../scripts/source-manifest.mjs';
const {configureEnterprise}=await tsImport('../scripts/enterprise-config.ts',import.meta.url);
const frozen='ad12b62c992187a2cb96d4adcbba993b1bd5c96ee7bd5117501b98e19fcf3fc4';
const root=resolve('.'),runId=randomUUID(),suffix=runId.slice(0,8),sourceName='verify-ent-src-'+suffix,restoreName='verify-ent-rst-'+suffix;
const evidence=resolve('docs/enterprise-work/restore-evidence-'+runId),localRoot=resolve('.agentbrake-local');
await mkdir(evidence,{mode:0o700});
const harness=await readFile(fileURLToPath(import.meta.url));await writeFile(join(evidence,'harness.mjs'),harness,{flag:'wx'});
const report={schema:1,runId,startedAt:new Date().toISOString(),sourceHash:frozen,harnessSha256:createHash('sha256').update(harness).digest('hex'),result:'NOT_RUN',cases:[],scope:'Disposable minimal local Docker/PostgreSQL Enterprise cold backup and stopped recovery; synthetic HTTPS and identity endpoints; read-only maintenance observer after stopped-state verification; no resumed restored IdP session acceptance or production disaster-recovery claim.'};
const known=new Set(),remember=s=>{if(typeof s==='string'&&s.length>=8)known.add(s);return s;},secret=()=>remember(randomBytes(32).toString('hex'));
const safe=s=>{let out=String(s);for(const k of known)out=out.replaceAll(k,'[REDACTED]');return out;};
const pass=(name,observed)=>{report.cases.push({name,result:'PASS',observed});console.log('PASS '+name);};
let source,recovered,backup,stage='source-check';
const freePort=async()=>{const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const certificate=async(config,prefix,cn,san)=>{execFileSync(process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN='+cn,'-addext','subjectAltName='+san,'-keyout',join(config.dir,prefix+'-key.pem'),'-out',join(config.dir,prefix+'-cert.pem')],{stdio:'ignore',windowsHide:true});remember(await readFile(join(config.dir,prefix+'-key.pem'),'utf8'));};
const knownFiles=async config=>{for(const entry of await readdir(config.dir)){const value=await readFile(join(config.dir,entry)).catch(()=>undefined);if(value)remember(value.toString('utf8'));}};
const api=async(config,path,method='GET',body,headers={})=>{const cert=await readFile(join(config.dir,'tls-cert.pem'));return new Promise((res,rej)=>{const bytes=body===undefined?undefined:JSON.stringify(body);const req=request({hostname:'127.0.0.1',port:config.port,servername:'localhost',ca:cert,path:'/api/'+path,method,headers:{Host:'localhost:'+config.port,Origin:'https://localhost:'+config.port,...(bytes?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(bytes)}:{}),...headers}},r=>{let text='';r.on('data',b=>text+=b);r.on('end',()=>{try{res({status:r.statusCode,body:text?JSON.parse(text):null,headers:r.headers});}catch{rej(Error('Unexpected non-JSON application response'));}});});req.on('error',rej);req.setTimeout(20000,()=>req.destroy(Error('HTTPS request timeout')));req.end(bytes);});};
const controlSnapshot=async config=>{
 const code=`import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {PostgresStore} from './server/postgres-store.ts';const password=(await readFile('/run/secrets/control-password','utf8')).trim();const s=await PostgresStore.open('postgresql://control_runtime:'+password+'@control-db:5432/agentbrake_control_fixture',{reconcile:false});try{const i=await s.identityState(),a=await s.agents(),x=await s.actions(),audit=await s.auditTrail();console.log(JSON.stringify({paused:(await s.settings()).paused,accounts:i.accounts.map(v=>({id:v.id,revision:v.revision})),invitations:i.invitations.length,recoveries:i.recoveries.length,agents:a.map(v=>({id:v.id,status:v.status,revoked:v.grant?.revoked})),actions:x.map(v=>({id:v.id,status:v.status,rule:v.rule})),auditValid:await s.verifyAudit(),auditHashes:audit.map(v=>v.hash)}));}finally{await s.close();}`;
 return JSON.parse((await composeProduct(config,['run','--rm','--no-deps','-T','control-api','node','--import','tsx','--input-type=module'],{capture:true,input:code})).trim());
};
const targetHash=async config=>createHash('sha256').update(await composeProduct(config,['exec','-T','target-db','psql','--no-psqlrc','--set','ON_ERROR_STOP=1','-U','fixture_owner','-d','agentbrake_target_fixture','-Atc',"SELECT row_to_json(t)::text FROM (SELECT id,name,plan,status,version FROM agentbrake_customers ORDER BY id) t"],{capture:true})).digest('hex');
const stopped=async config=>{const states=await installationStatus(config);assert.ok(states.length>0);assert.ok(states.every(v=>v.State!=='running'),'Restored scoped services must all remain stopped');return states.map(v=>({name:v.Service,state:v.State}));};
try{
 const manifest=await sourceManifest();assert.equal(manifest.sourceHash,frozen,'Frozen source changed before verification');await writeFile(join(evidence,'source-manifest.json'),JSON.stringify(manifest,null,2));
 stage='initialize-source';const port=await freePort(),restorePort=await freePort();assert.notEqual(port,restorePort);source=await initializeProduct(sourceName,port);
 await certificate(source,'input-tls','localhost','DNS:localhost');await certificate(source,'fixture','enterprise-fixture','DNS:enterprise-fixture,DNS:localhost');
 await configureCandidate(source,{https:{origin:'https://localhost:'+port,certificateFile:join(source.dir,'input-tls-cert.pem'),privateKeyFile:join(source.dir,'input-tls-key.pem')}});source=await productConfig(sourceName);
 await knownFiles(source);const operators=JSON.parse(await readFile(join(source.dir,'operators.json'),'utf8'));for(const op of operators)remember(op.key);
 stage='source-build';console.log('STAGE '+stage);await composeProduct(source,['build'],{capture:true,timeoutMs:1200000,maxOutputBytes:16000000});
 stage='source-bootstrap';console.log('STAGE '+stage);await startProduct(source,{build:false});
 const credentials={email:'restore-owner@example.test',password:remember('Synthetic!'+randomBytes(24).toString('hex'))};
 const setup=await api(source,'setup','POST',{...credentials,name:'Recovery ordinary owner',key:operators.find(v=>v.role==='administrator').key});assert.equal(setup.status,200);
 const session={Cookie:remember(setup.headers['set-cookie'][0].split(';')[0]),'X-AB-CSRF':remember(setup.body.csrfToken)};
 const invite=await api(source,'team/invitations','POST',{email:'unused-recovery@example.test',role:'viewer'},session);assert.equal(invite.status,201);remember(invite.body.token);
 const reset=await api(source,'team/administrator/recovery','POST',{},session);assert.equal(reset.status,200);remember(reset.body.token);
 const agent=await api(source,'agents','POST',{name:'Recovery synthetic agent',tools:['database_read','database_update'],resources:['customers'],sandbox:true},session);assert.equal(agent.status,201);remember(agent.body.token);
 const call=body=>composeProduct(source,['exec','-T','agent','node','infra/product/agent-probe.mjs'],{capture:true,input:JSON.stringify({kind:'request',path:'/api/actions',token:agent.body.token,body})}).then(JSON.parse);
 assert.equal((await call({requestId:randomUUID(),tool:'database_read',arguments:{limit:1}})).body.status,'allowed');
 const pending=await call({requestId:randomUUID(),tool:'database_update',arguments:{id:1,status:'paused'}});assert.equal(pending.body.status,'pending');
 const initial=await controlSnapshot(source),targetBefore=await targetHash(source);assert.equal(initial.accounts.length,1);assert.equal(initial.invitations,1);assert.equal(initial.recoveries,1);assert.equal(initial.auditValid,true);
 pass('actual-source-managed-authority',{ordinaryOwner:true,unusedInvitation:true,recoveryToken:true,agent:true,pendingApproval:true,auditValid:true});
 stage='source-enterprise';await composeProduct(source,['--profile','agent','stop'],{capture:true});
 const clientSecret=secret(),sinkToken=secret(),scimToken=secret(),origin='https://localhost:'+port;
 await writeFile(join(source.dir,'enterprise-fixture.json'),JSON.stringify({clientSecret,sinkToken,redirectUri:origin+'/api/enterprise/oidc/callback'}),{mode:0o600,flag:'wx'});
 await configureEnterprise(source,{managedAccountsInitialized:true,identity:{issuer:'https://enterprise-fixture:8443',authorizationEndpoint:'https://enterprise-fixture:8443/authorize',tokenEndpoint:'https://enterprise-fixture:8443/token',jwksUri:'https://enterprise-fixture:8443/jwks',clientId:'enterprise-fixture-client',clientSecret,redirectUri:origin+'/api/enterprise/oidc/callback',requiredAcr:['urn:fixture:mfa'],requiredAmr:['otp'],maxAuthAgeSeconds:300,scimToken,groupRoleMapping:{operators:'operator'}}});
 source={...await productConfig(sourceName),verificationComposeFiles:[resolve('infra/product/verify-enterprise.compose.yaml')]};
 const composed=JSON.parse(await composeProduct(source,['--profile','agent','config','--format','json'],{capture:true}));assert.ok(Object.entries(composed.networks).every(([n,v])=>n==='loopback-ingress'||v.internal===true));assert.deepEqual(Object.entries(composed.services).filter(([,v])=>Object.hasOwn(v.networks??{},'loopback-ingress')).map(([n])=>n),['ingress']);
 await startProduct(source,{build:false});assert.equal((await api(source,'enterprise/auth')).body.enabled,true);assert.equal((await api(source,'login','POST',credentials)).status,401);
 pass('enterprise-source-denies-ordinary-password',{noBreakGlassConfigured:true,sourcePasswordDenied:true,internalRuntimeNetworks:true});
 stage='cold-backup';console.log('STAGE '+stage);const before=await controlSnapshot(source);backup=await backupProduct(source);
 remember((await readFile(backup.keyFile)).toString('base64'));const decoded=await inspectBackup(backup.file,backup.keyFile);assert.equal(decoded.installation.enterpriseRequired,true);assert.equal(decoded.installation.enterpriseIdentityRequired,true);assert.equal(decoded.files['enterprise.json'],undefined);assert.equal(decoded.files['tls-key.pem'],undefined);
 assert.equal((await api(source,'login','POST',credentials)).status,401);assert.equal(await targetHash(source),targetBefore);
 pass('authenticated-enterprise-backup',{enterpriseRequired:true,enterpriseIdentityRequired:true,enterpriseSecretsCopied:false,sourceResumedWithoutPasswordDowngrade:true,backupBytes:(await stat(backup.file)).size,backupSha256:createHash('sha256').update(await readFile(backup.file)).digest('hex')});
 stage='actual-restore';console.log('STAGE '+stage);const result=await restoreProduct(backup.file,backup.keyFile,restoreName,restorePort);assert.equal(result.status,'RESTORED_REQUIRES_ENTERPRISE_CONFIGURATION');recovered=await productConfig(restoreName);
 const restoredMetadata=JSON.parse(await readFile(join(recovered.dir,'installation.json'),'utf8'));assert.equal(restoredMetadata.enterpriseRequired,true);assert.equal(restoredMetadata.enterpriseIdentityRequired,true);assert.equal(restoredMetadata.id,source.id);assert.equal(recovered.enterprise,undefined);assert.equal(recovered.candidate,undefined);
 const states=await stopped(recovered);await assert.rejects(startProduct(recovered,{build:false}),/Enterprise configuration is required/);await stopped(recovered);
 pass('actual-enterprise-restore-remains-stopped',{status:result.status,enterpriseRequired:true,enterpriseIdentityRequired:true,installationIdPreserved:true,configurationAbsent:true,ordinaryStartDenied:true,states});
 stage='audit-only-replacement-refusal';await certificate(recovered,'new-input','localhost','DNS:localhost');await configureCandidate(recovered,{https:{origin:'https://localhost:'+restorePort,certificateFile:join(recovered.dir,'new-input-cert.pem'),privateKeyFile:join(recovered.dir,'new-input-key.pem')}});recovered=await productConfig(restoreName);
 await assert.rejects(configureEnterprise(recovered,{managedAccountsInitialized:true,audit:{endpoint:'https://enterprise-fixture:8443/sink',bearerToken:secret()}}),/SSO requirement.*audit-only/);assert.equal((await productConfig(restoreName)).enterprise,undefined);await stopped(recovered);
 pass('audit-only-cannot-replace-restored-sso',{replacementRejected:true,enterpriseIdentityRequiredPreserved:true,servicesStillStopped:true});
 stage='read-only-restored-observer';await composeProduct(recovered,['up','-d','--wait','--wait-timeout','120','control-db','target-db'],{capture:true});const after=await controlSnapshot(recovered);
 assert.equal(after.paused,true);assert.deepEqual(after.accounts.map(a=>a.id),before.accounts.map(a=>a.id));assert.ok(after.accounts.every(a=>a.revision>before.accounts.find(b=>b.id===a.id).revision));assert.equal(after.invitations,0);assert.equal(after.recoveries,0);assert.ok(after.agents.length>0);assert.ok(after.agents.every(a=>a.status==='paused'&&a.revoked===true));assert.equal(after.actions.find(a=>a.id===pending.body.id).status,'blocked');assert.equal(after.actions.find(a=>a.id===pending.body.id).rule,'recovery-suspension');assert.equal(after.auditValid,true);assert.deepEqual(after.auditHashes.slice(0,before.auditHashes.length),before.auditHashes);assert.equal(await targetHash(recovered),targetBefore);
 await composeProduct(recovered,['--profile','agent','stop'],{capture:true});await stopped(recovered);
 pass('real-postgresql-recovery-invariants',{paused:true,accountsPreserved:after.accounts.length,accountRevisionsIncreased:true,invitations:0,recoveries:0,agentsPausedAndRevoked:after.agents.length,pendingReviewBlocked:true,auditValid:true,auditPrefixPreserved:true,targetHashPreserved:true,targetHash:targetBefore,restoredApplicationNeverStarted:true,observer:'Database services plus read-only one-shot PostgresStore; no restored login or resumed IdP flow'});
 assert.equal((await sourceManifest()).sourceHash,frozen,'Source changed during verification');report.result='PASS_LOCAL_ENTERPRISE_POSTGRES_RESTORE';
}catch(error){report.result='FAIL';report.failure={stage,message:safe(error.message)};if(error.errorOutput)report.failure.diagnostic=safe(error.errorOutput).slice(-12000);process.exitCode=1;console.error('FAIL '+stage+': '+safe(error.message));}
finally{
 if(!recovered)recovered=await productConfig(restoreName).catch(()=>undefined);
 report.cleanup=[];
 for(const config of [recovered,source].filter(Boolean)){
  try{
   assert.ok([sourceName,restoreName].includes(config.name));assert.equal(config.project,'agentbrake-product-'+config.name);assert.equal(resolve(config.dir),join(localRoot,'product-'+config.name));
   await composeProduct(config,['--profile','agent','down','--volumes','--remove-orphans'],{capture:true});const filter='label=com.docker.compose.project='+config.project;
   for(const args of [['ps','--all','--quiet','--filter',filter],['volume','ls','--quiet','--filter',filter],['network','ls','--quiet','--filter',filter]])assert.equal((await dockerProduct(config,args,{capture:true})).trim(),'');
   const owner=JSON.parse(await readFile(join(config.dir,'installation.json'),'utf8'));assert.equal(owner.id,config.id);assert.equal(owner.name,config.name);assert.ok(resolve(config.dir).startsWith(localRoot+sep));assert.notEqual(config.name,'local');
   await rm(resolve(config.dir),{recursive:true});
   for(const tag of [config.project+'-runtime',config.project+'-dashboard']){const exists=await dockerProduct(config,['image','inspect',tag],{capture:true}).then(()=>true,()=>false);if(exists)await dockerProduct(config,['image','rm',tag],{capture:true});}
   report.cleanup.push({name:config.name,result:'PASS',containers:0,volumes:0,networks:0,ownedFilesRemoved:true,ownedImageTagsRemoved:true});
  }catch(error){report.cleanup.push({name:config.name,result:'FAIL',message:safe(error.message)});report.result='FAIL';process.exitCode=1;}
 }
 if(backup){try{assert.equal(dirname(resolve(backup.file)),join(localRoot,'backups'));assert.ok(basename(backup.file).startsWith(sourceName+'-'));await rm(backup.file);report.backupArtifactRemoved=true;}catch{report.result='FAIL';report.backupArtifactRemoved=false;process.exitCode=1;}}
 report.finishedAt=new Date().toISOString();report.sourceHashAtEnd=(await sourceManifest()).sourceHash;report.sourceUnchanged=report.sourceHashAtEnd===frozen;if(!report.sourceUnchanged){report.result='FAIL';process.exitCode=1;}
 report.knownSecretScan={result:'PASS',checkedValues:known.size,scope:'Sanitized summary and saved standalone harness; no raw backup/config/key in evidence'};const serialized=JSON.stringify(report,null,2);for(const k of known)assert.ok(!serialized.includes(k)&&!harness.toString('utf8').includes(k),'Known synthetic secret appeared in evidence');
 await writeFile(join(evidence,'summary.json'),serialized+'\n',{flag:'wx',mode:0o600});await writeFile(join(evidence,'harness.sha256'),report.harnessSha256+'  harness.mjs\n',{flag:'wx'});
 console.log(JSON.stringify({result:report.result,evidence,sourceUnchanged:report.sourceUnchanged}));
}
