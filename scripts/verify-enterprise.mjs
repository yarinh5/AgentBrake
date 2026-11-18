import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve, basename, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { gzipSync, gunzipSync } from 'node:zlib';
import { chromium, expect } from '@playwright/test';
import { tsImport } from 'tsx/esm/api';
import { initializeProduct, productConfig, composeProduct, dockerProduct } from './product.mjs';
import { configureCandidate } from './candidate-config.mjs';
import { startProduct } from './product-maintenance.mjs';
import { sourceManifest } from './source-manifest.mjs';
import { prepareFixtureAccess } from './fixture-file-access.mjs';

const {configureEnterprise}=await tsImport('./enterprise-config.ts',import.meta.url);
const root=resolve('.'),runId=randomUUID(),name='verify-enterprise-'+runId.slice(0,8);
const directory=join(root,'docs/evidence',runId),manifest=await sourceManifest();
await mkdir(directory,{recursive:true});
const report={runId,sourceHash:manifest.sourceHash,startedAt:new Date().toISOString(),result:'NOT_RUN',cases:[],scope:'Disposable minimal Docker installation; synthetic TLS IdP and audit sink; internal control/agent/enterprise networks with existing dedicated fixed-ingress publication bridge; real customer acceptance excluded.'};
const secrets=new Set();let config,stage='prepare';
const remember=value=>{if(typeof value==='string'&&value.length>=8)secrets.add(value);return value;};
const random=()=>remember(randomBytes(32).toString('hex'));
const safe=value=>{let text=String(value);for(const secret of secrets)text=text.replaceAll(secret,'[REDACTED]');return text;};
const passed=(caseName,observed)=>{report.cases.push({name:caseName,result:'PASS',observed});console.log('PASS '+caseName);};
const wait=async(fn,description,timeoutMs=120000)=>{const until=Date.now()+timeoutMs;let last;do{try{const value=await fn();if(value)return value;}catch(error){last=error;}await new Promise(r=>setTimeout(r,1000));}while(Date.now()<until);throw Error(description+' timed out'+(last?' ('+safe(last.message)+')':''));};
const unusedPort=async()=>{const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;};
const scopedConfig=async(overlay)=>({...await productConfig(name),verificationComposeFiles:[overlay]});
const fixtureExec=async(code)=>JSON.parse((await composeProduct(config,['exec','-T','enterprise-fixture','node','-e',code],{capture:true})).trim());
const fixtureStatus=()=>fixtureExec("fetch('https://localhost:8443/status').then(r=>r.json()).then(v=>console.log(JSON.stringify(v)))");
const cursor=async()=>JSON.parse((await composeProduct(config,['exec','-T','control-api','node','-e',"console.log(require('node:fs').readFileSync('/var/lib/agentbrake/enterprise/siem.cursor.json','utf8'))"],{capture:true})).trim()).cursor;
try {
  const port=await unusedPort(),origin='https://localhost:'+port;
  config=await initializeProduct(name,port);
  const expectedDir=resolve(root,'.agentbrake-local','product-'+name);
  assert.equal(resolve(config.dir),expectedDir);assert.notEqual(name,'local');
  const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
  const certificate=(prefix,subject,san)=>execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN='+subject,'-addext','subjectAltName='+san,'-keyout',join(config.dir,prefix+'-key.pem'),'-out',join(config.dir,prefix+'-cert.pem')],{stdio:'ignore',windowsHide:true});
  certificate('input-tls','localhost','DNS:localhost');certificate('fixture','enterprise-fixture','DNS:enterprise-fixture,DNS:localhost');
  await configureCandidate(config,{https:{origin,certificateFile:join(config.dir,'input-tls-cert.pem'),privateKeyFile:join(config.dir,'input-tls-key.pem')}});
  const bootstrapOverlay=join(config.dir,'bootstrap-isolation.compose.yaml');
  await writeFile(bootstrapOverlay,'networks:\n  dashboard: { internal: true }\n',{flag:'wx',mode:0o600});
  config=await scopedConfig(bootstrapOverlay);
  const operators=JSON.parse(await readFile(join(config.dir,'operators.json'),'utf8'));
  for(const operator of operators)remember(operator.key);
  for(const entry of await readdir(config.dir)){const bytes=await readFile(join(config.dir,entry)).catch(()=>undefined);if(bytes&&bytes.length>=8)remember(bytes.toString('utf8'));}
  const credential={email:'enterprise-owner@example.test',password:remember('Fixture!'+randomBytes(24).toString('hex'))};
  const clientSecret=random(),scimToken=random(),sinkToken=random();
  await writeFile(join(config.dir,'enterprise-fixture.json'),JSON.stringify({clientSecret,sinkToken,redirectUri:origin+'/api/enterprise/oidc/callback'}),{flag:'wx',mode:0o600});
  // These belong only to the synthetic IdP/sink, not the product's runtime
  // secret allowlist. Match its explicit supplementary group on Linux.
  if(process.platform==='linux')await prepareFixtureAccess(config.dir,['enterprise-fixture.json','fixture-cert.pem','fixture-key.pem'],[]);
  const cert=await readFile(join(config.dir,'tls-cert.pem'));
  const api=(path,method='GET',body,headers={})=>new Promise((resolveResponse,reject)=>{
    const bytes=body===undefined?undefined:JSON.stringify(body);
    const req=httpsRequest({hostname:'127.0.0.1',port,servername:'localhost',ca:cert,path:'/api/'+path,method,headers:{Host:'localhost:'+port,...(bytes===undefined?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(bytes)}),...headers}},res=>{
      let output='';res.on('data',b=>output+=b);res.on('end',()=>{let value;try{value=output?JSON.parse(output):undefined;}catch{value=undefined;}resolveResponse({status:res.statusCode,body:value,headers:res.headers,text:output});});
    });req.setTimeout(15000,()=>req.destroy(Error('Candidate TLS timeout')));req.on('error',reject);req.end(bytes);
  });
  stage='build';console.log('STAGE build disposable images');
  await composeProduct(config,['build'],{capture:true,timeoutMs:1200000,maxOutputBytes:16000000});
  stage='bootstrap-start';console.log('STAGE bootstrap HTTPS installation');await startProduct(config,{build:false});
  const bootstrap=await api('setup','POST',{...credential,name:'Enterprise fixture owner',key:operators.find(o=>o.role==='administrator').key},{Origin:origin});
  assert.equal(bootstrap.status,200,'Managed owner bootstrap must succeed');
  remember(bootstrap.body.csrfToken);for(const cookie of bootstrap.headers['set-cookie']??[])remember(cookie.split(';')[0]);
  passed('managed-owner-bootstrap','Production HTTPS/Next/control/PostgreSQL managed-account bootstrap completed before enabling enterprise mode.');
  await composeProduct(config,['--profile','agent','stop'],{capture:true});
  stage='configure';
  await configureEnterprise(config,{managedAccountsInitialized:true,identity:{issuer:'https://enterprise-fixture:8443',authorizationEndpoint:'https://enterprise-fixture:8443/authorize',tokenEndpoint:'https://enterprise-fixture:8443/token',jwksUri:'https://enterprise-fixture:8443/jwks',clientId:'enterprise-fixture-client',clientSecret,redirectUri:origin+'/api/enterprise/oidc/callback',requiredAcr:['urn:fixture:mfa'],requiredAmr:['otp'],maxAuthAgeSeconds:300,scimToken,groupRoleMapping:{operators:'operator'},breakGlassAccountId:'administrator',providerLabel:'Fixture organization'},audit:{endpoint:'https://enterprise-fixture:8443/sink',bearerToken:sinkToken,batchSize:20,intervalMs:1000,timeoutMs:5000}});
  config=await scopedConfig(resolve('infra/product/verify-enterprise.compose.yaml'));
  const composed=JSON.parse(await composeProduct(config,['--profile','agent','config','--format','json'],{capture:true}));
  assert.ok(Object.entries(composed.networks).every(([network,value])=>network==='loopback-ingress'||value.internal===true));
  assert.deepEqual(Object.entries(composed.services).filter(([,service])=>Object.hasOwn(service.networks??{},'loopback-ingress')).map(([name])=>name),['ingress']);
  const published=Object.entries(composed.services).flatMap(([service,value])=>(value.ports??[]).map(port=>({service,...port})));
  assert.equal(published.length,1);assert.equal(published[0].service,'ingress');assert.equal(published[0].host_ip,'127.0.0.1');
  assert.deepEqual(Object.keys(composed.services.agent.networks),['agent']);
  assert.equal(composed.services['control-api'].environment.AGENTBRAKE_ENTERPRISE_REQUIRED,'1');assert.equal(composed.services['control-api'].environment.AGENTBRAKE_ENTERPRISE_IDENTITY_REQUIRED,'1');
  assert.ok(composed.services['control-api'].volumes.some(v=>v.target==='/run/secrets/enterprise.json'));
  for(const service of ['gateway','agent','dashboard','ingress','enterprise-egress'])assert.ok(!(composed.services[service].volumes??[]).some(v=>String(v.target).includes('enterprise.json')||String(v.target).includes('enterprise-fixture.json')));
  passed('compose-enterprise-isolation','Control/agent/protected/dashboard/enterprise networks internal; existing dedicated publication bridge joins only fixed ingress, with only loopback port published; enterprise secret only control, fixture secret only fixture.');
  stage='enterprise-start';console.log('STAGE start enterprise product');await startProduct(config,{build:false});
  const auth=await api('enterprise/auth');assert.equal(auth.status,200);assert.equal(auth.body.enabled,true);
  const scimHeaders={Authorization:'Bearer '+scimToken};
  const ext='urn:agentbrake:params:scim:schemas:extension:identity:2.0:User';
  const created=await api('scim/v2/Users','POST',{schemas:['urn:ietf:params:scim:schemas:core:2.0:User',ext],externalId:'container-person',userName:'container-person@example.test',displayName:'Container person',active:true,[ext]:{issuer:'https://enterprise-fixture:8443',subject:'container-person'}},scimHeaders);
  assert.equal(created.status,201,'Installed SCIM creation must succeed');const userId=created.body.id;
  const group=await api('scim/v2/Groups','POST',{schemas:['urn:ietf:params:scim:schemas:core:2.0:Group'],externalId:'operators',displayName:'Operators',members:[{value:userId}]},scimHeaders);assert.equal(group.status,201);
  const start=await api('enterprise/oidc/start','POST',{}, {Origin:origin});assert.equal(start.status,200);
  const binding=(start.headers['set-cookie']??[]).find(v=>v.startsWith('ab_oidc='));assert.match(binding,/; Secure/);const transactionCookie=remember(binding.split(';')[0]);
  const authorization=new URL(start.body.authorizationUrl);assert.equal(authorization.origin,'https://enterprise-fixture:8443');remember(authorization.searchParams.get('state'));remember(authorization.searchParams.get('nonce'));
  const authorized=await fixtureExec(`fetch(${JSON.stringify(authorization.href)},{redirect:'manual'}).then(r=>console.log(JSON.stringify({status:r.status,location:r.headers.get('location')})))`);
  assert.equal(authorized.status,302);const callback=new URL(authorized.location);assert.equal(callback.origin,origin);remember(callback.searchParams.get('code'));
  const callbackPath=callback.pathname.slice('/api/'.length)+callback.search;
  assert.equal((await api(callbackPath)).status,401);
  const completed=await api(callbackPath,'GET',undefined,{Cookie:transactionCookie});assert.equal(completed.status,303,'Installed signed OIDC callback must succeed');assert.equal(completed.headers.location,'/');
  const ssoCookie=remember(completed.headers['set-cookie'].find(v=>v.startsWith('ab_session=')).split(';')[0]);
  const session=await api('session','GET',undefined,{Cookie:ssoCookie});assert.equal(session.status,200);assert.equal(session.body.actor.role,'operator');remember(session.body.csrfToken);
  assert.equal((await api(callbackPath,'GET',undefined,{Cookie:transactionCookie})).status,401);
  const remote=await fixtureStatus();assert.equal(remote.exchanges,1);
  passed('installed-signed-oidc-scim','SCIM created a bound user and mapped operator group; signed RSA code/PKCE exchange traversed production enterprise egress; missing-cookie and replay callbacks denied.');
  assert.equal((await api('scim/v2/Users/'+userId,'DELETE',undefined,scimHeaders)).status,204);
  assert.equal((await api('session','GET',undefined,{Cookie:ssoCookie})).status,401);
  passed('installed-offboarding','Bodyless SCIM DELETE over HTTPS immediately revoked the issued application session.');
  const loginOwner=async()=>{const login=await api('login','POST',credential,{Origin:origin});assert.equal(login.status,200,'Explicit break-glass owner login');remember(login.body.csrfToken);return remember(login.headers['set-cookie'][0].split(';')[0]);};
  let ownerCookie=await loginOwner();
  const status=()=>api('enterprise/status','GET',undefined,{Cookie:ownerCookie});
  await wait(async()=>{const observed=await status();return observed.status===200&&observed.body.auditDelivery.lastError===null&&Number(observed.body.auditDelivery.lastAckSequence)>0&&observed.body.auditDelivery.pendingAtLeast===0;},'Audit delivery');
  // The break-glass login is the final producer before this restart. A status
  // snapshot from an earlier tick is not a barrier for its acknowledgement.
  const sink=await wait(async()=>{const observed=await fixtureStatus();return ['identity.federated-login','identity.scim-user-deleted','identity.break-glass-login'].every(type=>observed.events.some(event=>event.type===type))?observed:undefined;},'Final producer acknowledgement');
  const acknowledged=sink.events.reduce((max,event)=>BigInt(event.id.split(':').at(-1))>max?BigInt(event.id.split(':').at(-1)):max,0n);
  const before=await wait(async()=>{const value=await cursor();return BigInt(value.sequence)>=acknowledged?value:undefined;},'Acknowledged cursor persistence');
  stage='control-restart';await composeProduct(config,['restart','control-api'],{capture:true});
  await wait(async()=>{const health=await api('health');return health.status===200;},'Control restart health');
  const after=await wait(async()=>{const value=await cursor();return value.sequence===before.sequence?value:undefined;},'Durable cursor restart');assert.deepEqual(after,before);
  ownerCookie=await loginOwner();const afterStatus=await status();assert.equal(afterStatus.status,200);assert.ok(BigInt(afterStatus.body.auditDelivery.lastAckSequence)>=BigInt(before.sequence));
  passed('installed-audit-ack-restart',{acknowledgedSequence:before.sequence,uniqueSinkEvents:sink.eventCount,checkpointUnchangedOnRestart:true,operatorStatus:true});
  stage='agent-probes';
  const ips=[];for(const service of ['enterprise-fixture','enterprise-egress','ingress']){const id=(await composeProduct(config,['ps','--quiet',service],{capture:true})).trim();const inspected=JSON.parse(await dockerProduct(config,['inspect',id],{capture:true}))[0];for(const network of Object.values(inspected.NetworkSettings.Networks))ips.push({host:network.IPAddress,port:service==='enterprise-fixture'?8443:service==='enterprise-egress'?8080:3000});}
  const probeCode=`const net=require('node:net'),fs=require('node:fs');const endpoints=${JSON.stringify(ips)};Promise.all(endpoints.map(({host,port})=>new Promise(resolve=>{const socket=net.connect({host,port});let done=false;const finish=blocked=>{if(done)return;done=true;socket.destroy();resolve(blocked)};socket.setTimeout(1500,()=>finish(true));socket.on('connect',()=>finish(false));socket.on('error',()=>finish(true))}))).then(blocked=>{const paths=['/run/secrets/enterprise.json','/run/secrets/enterprise-fixture.json','/run/secrets/fixture-key.pem'];const noSecrets=paths.every(p=>!fs.existsSync(p));console.log(JSON.stringify({attempts:blocked.length,allBlocked:blocked.every(Boolean),noSecrets}));process.exit(blocked.every(Boolean)&&noSecrets?0:1)})`;
  const probes=JSON.parse(await composeProduct(config,['exec','-T','agent','node','-e',probeCode],{capture:true}));assert.equal(probes.allBlocked,true);assert.equal(probes.noSecrets,true);
  const surfaceProbe=JSON.parse(await composeProduct(config,['exec','-T','agent','node','-e',"Promise.all(['/api/enterprise/auth','/api/scim/v2/Users'].map(p=>fetch('http://gateway:4313'+p).then(r=>r.status))).then(v=>console.log(JSON.stringify(v)))"],{capture:true}));assert.deepEqual(surfaceProbe,[404,404]);
  passed('installed-agent-enterprise-denial',{...probes,gatewayEnterpriseRoutes:surfaceProbe});
  stage='installed-browser';const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({ignoreHTTPSErrors:true});const errors=[],external=[];let attemptedIdp=false;
    await context.route('**/*',route=>{const target=new URL(route.request().url());if(target.origin===origin)return route.continue();if(target.origin==='https://enterprise-fixture:8443'&&target.pathname==='/authorize'){attemptedIdp=true;return route.abort();}external.push(target.origin);return route.abort();});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);
    await expect(page.getByRole('button',{name:'Continue with Fixture organization',exact:true})).toBeVisible();await expect(page.getByLabel('Password',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Continue with Fixture organization',exact:true}).click();await wait(async()=>attemptedIdp,'Browser SSO navigation',10000);
    await context.addCookies([{name:'ab_session',value:ownerCookie.slice('ab_session='.length),domain:'localhost',path:'/api',httpOnly:true,secure:true,sameSite:'Strict'}]);
    await page.goto(origin);await expect(page.getByRole('heading',{name:'Security overview',exact:true})).toBeVisible();
    await page.getByRole('navigation').getByRole('button',{name:'Team',exact:true}).click();await expect(page.getByText('Membership and roles are managed by your organization through SCIM.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Create invitation',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Save member',exact:true})).toHaveCount(0);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);passed('installed-browser-enterprise',{ssoButton:true,ordinaryPasswordHidden:true,manualIdentityControlsHidden:true,expectedSyntheticIdpNavigation:true,browserErrors:0});
  }finally{await browser.close();}
  const finalManifest=await sourceManifest();assert.equal(finalManifest.sourceHash,manifest.sourceHash,'Source changed during installed verification');
  report.images=JSON.parse(await composeProduct(config,['images','--format','json'],{capture:true}));report.result='PASS_LOCAL_INSTALLED_ENTERPRISE';
}catch(error){report.result='FAIL';report.failure={stage,message:safe(error.message)};if(error.errorOutput)report.failure.diagnostic=safe(error.errorOutput).slice(-16000);console.error('FAIL '+stage+': '+safe(error.message));process.exitCode=1;}
finally {
  if(config){try{
    await composeProduct(config,['--profile','agent','down','--volumes','--remove-orphans'],{capture:true});
    const filter='label=com.docker.compose.project='+config.project;
    const remaining=await Promise.all([['ps','--all','--quiet','--filter',filter],['volume','ls','--quiet','--filter',filter],['network','ls','--quiet','--filter',filter]].map(args=>dockerProduct(config,args,{capture:true})));
    for(const item of remaining)assert.equal(item.trim(),'');report.cleanup={result:'PASS',containers:0,volumes:0,networks:0};
    const directoryPath=resolve(config.dir),expected=resolve(root,'.agentbrake-local','product-'+name),owner=JSON.parse(await readFile(join(directoryPath,'installation.json'),'utf8'));
    assert.equal(directoryPath,expected);assert.equal(basename(directoryPath),'product-'+name);assert.ok(directoryPath.startsWith(resolve(root,'.agentbrake-local')+sep));assert.equal(owner.id,config.id);assert.equal(owner.name,name);assert.notEqual(name,'local');
    await rm(directoryPath,{recursive:true,force:false});report.cleanup.scopedFilesRemoved=true;
  }catch(error){report.cleanup={result:'FAIL',message:safe(error.message)};report.result='FAIL';process.exitCode=1;}}
  report.finishedAt=new Date().toISOString();
  const evidence={summary:report,sourceManifest:manifest};let serialized=JSON.stringify(evidence,null,2);
  const leaks=[...secrets].filter(secret=>serialized.includes(secret));assert.equal(leaks.length,0,'Known secret found in evidence');
  report.secretScan={result:'PASS',knownValuesChecked:secrets.size,artifacts:['enterprise-summary.json','source-manifest.json','enterprise-evidence.json.gz']};
  serialized=JSON.stringify(evidence,null,2);const archive=gzipSync(serialized);assert.equal(gunzipSync(archive).toString('utf8'),serialized);
  for(const secret of secrets)assert.ok(!serialized.includes(secret),'Known secret found in final evidence');
  await writeFile(join(directory,'source-manifest.json'),JSON.stringify(manifest,null,2));await writeFile(join(directory,'enterprise-summary.json'),JSON.stringify(report,null,2));await writeFile(join(directory,'enterprise-evidence.json.gz'),archive);
  await writeFile(join(directory,'enterprise-evidence.sha256'),createHash('sha256').update(archive).digest('hex')+'  enterprise-evidence.json.gz\n');
  await writeFile(join(root,'docs/evidence/latest-enterprise.json'),JSON.stringify({runId,directory:directory.replaceAll('\\','/'),result:report.result},null,2));
  console.log(JSON.stringify({runId,result:report.result,directory}));
}
