import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer, request as httpRequest, type Server, type IncomingHttpHeaders } from 'node:http';
import { request as tlsRequest } from 'node:https';
import { randomBytes, randomUUID, generateKeyPairSync, createHash, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app.js';
import { Store } from '../../server/store.js';
import { RemoteGateway } from '../../server/gateway-bridge.js';
import { LocalOperators } from '../../server/security/operators.js';
import { ManagedAccounts } from '../../server/security/accounts.js';
import type { EnterpriseIdentityConfig } from '../../server/security/enterprise-identity.js';
import { controlProxy } from '../../apps/dashboard/lib/control-proxy.js';
// Existing JavaScript production ingress is deliberately exercised, not mocked.
// @ts-expect-error Production .mjs module has no declaration file.
import { createHttpsIngress } from '../../infra/product/https-ingress.mjs';

const origin='https://brake.example.test';
const extension='urn:agentbrake:params:scim:schemas:extension:identity:2.0:User';
const userSchema='urn:ietf:params:scim:schemas:core:2.0:User';
const groupSchema='urn:ietf:params:scim:schemas:core:2.0:Group';
const secret=(length=64)=>randomBytes(Math.ceil(length/2)).toString('hex').slice(0,length);
const listen=async(server:Server)=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return (server.address() as {port:number}).port;};
const close=async(server:Server)=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));};

async function signedIdp() {
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'fixture-key',use:'sig',alg:'RS256'};
  const codes=new Map<string,URL>();let exchanges=0;
  const app=express();app.use(express.urlencoded({extended:false}));
  app.get('/jwks',(_q,r)=>r.json({keys:[jwk]}));
  app.get('/authorize',(q,r)=>{
    const auth=new URL(q.originalUrl,base),code=randomUUID();codes.set(code,auth);
    const callback=new URL(auth.searchParams.get('redirect_uri')!);
    callback.searchParams.set('code',code);callback.searchParams.set('state',auth.searchParams.get('state')!);
    r.redirect(callback.href);
  });
  app.post('/token',(q,r)=>{
    const auth=codes.get(q.body.code);codes.delete(q.body.code);
    if(!auth || q.body.client_id!=='http-fixture-client' || q.body.client_secret!=='http-fixture-client-secret' || q.body.redirect_uri!==auth.searchParams.get('redirect_uri') || createHash('sha256').update(q.body.code_verifier??'').digest('base64url')!==auth.searchParams.get('code_challenge')) {
      r.status(400).json({error:'invalid_grant'});return;
    }
    exchanges++;const now=Math.floor(Date.now()/1000);
    const payload={iss:base,aud:'http-fixture-client',sub:'full-http-person',iat:now,exp:now+300,auth_time:now,nonce:auth.searchParams.get('nonce'),acr:'urn:fixture:mfa',amr:['pwd','otp']};
    const content=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture-key'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url');
    r.json({token_type:'Bearer',access_token:'unused-fixture-access-token',id_token:content+'.'+sign('RSA-SHA256',Buffer.from(content),privateKey).toString('base64url')});
  });
  const server=createServer(app),port=await listen(server),base='http://127.0.0.1:'+port;
  return {base,exchanges:()=>exchanges,close:()=>close(server)};
}

type Reply={status:number;text:string;headers:IncomingHttpHeaders;json:()=>any};
async function installation(idpBase:string,cert:Buffer,key:Buffer,tokenLength:number) {
  const token=secret(tokenLength),bootstrap=secret();
  const store=new Store(':memory:');
  const bootstrapOperators=new LocalOperators(bootstrap);
  await new ManagedAccounts(store,bootstrapOperators).setup({key:bootstrap,email:'owner@example.test',name:'Owner',password:'Fixture integration password 47!'});
  const config:EnterpriseIdentityConfig={issuer:idpBase,authorizationEndpoint:idpBase+'/authorize',tokenEndpoint:idpBase+'/token',jwksUri:idpBase+'/jwks',clientId:'http-fixture-client',clientSecret:'http-fixture-client-secret',redirectUri:origin+'/api/enterprise/oidc/callback',requiredAcr:['urn:fixture:mfa'],requiredAmr:['otp'],maxAuthAgeSeconds:300,scimToken:token,groupRoleMapping:{'fixture-operators':'operator'},breakGlassAccountId:'local-administrator',testOnlyAllowLoopbackHttp:true};
  const system=createApp({store,databasePath:':memory:',adminKey:bootstrap,managedAccounts:true,secureCookies:true,enterpriseIdentity:config,surface:'control',operators:[{id:'local-administrator',name:'Owner',role:'administrator',tenant:'local',key:bootstrap}],gateway:new RemoteGateway('http://127.0.0.1:9',secret())});
  await system.enterpriseReady();
  const control=createServer(system.app),controlPort=await listen(control),controlBase='http://127.0.0.1:'+controlPort;
  // Only the framework adapter is test plumbing: actual controlProxy and fetch
  // perform all routing, origin/auth validation and upstream requests.
  const dashboard=createServer(async(req,res)=>{
    try {
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const bytes=Buffer.concat(chunks),headers=new Headers();
      for(const [name,value] of Object.entries(req.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
      const url=new URL(req.url!,'http://127.0.0.1:'+dashboardPort);
      const request=new Request(url,{method:req.method,headers,...(bytes.length?{body:bytes.toString('utf8')}: {})});
      const response=await controlProxy(request,url.pathname.slice('/api/'.length).split('/'),controlBase,fetch,origin);
      res.statusCode=response.status;
      response.headers.forEach((value,name)=>{if(name!=='set-cookie')res.setHeader(name,value);});
      const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);
      res.end(Buffer.from(await response.arrayBuffer()));
    }catch{res.statusCode=500;res.end('Fixture adapter error');}
  });
  const dashboardPort=await listen(dashboard),dashboardBase='http://127.0.0.1:'+dashboardPort;
  const ingress=createHttpsIngress({origin,cert,key,backend:dashboardBase}) as Server,ingressPort=await listen(ingress);
  const call=(path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>new Promise<Reply>((resolve,reject)=>{
    const data=body===undefined?undefined:JSON.stringify(body);
    const req=tlsRequest({hostname:'127.0.0.1',port:ingressPort,servername:'brake.example.test',ca:cert,path,method,headers:{Host:'brake.example.test',...(data===undefined?{}:{'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(data))}),...headers}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode!,text,headers:res.headers,json:()=>JSON.parse(text)}));
    });req.on('error',reject);req.end(data);
  });
  const directDashboard=(path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>new Promise<Reply>((resolve,reject)=>{
    const data=body===undefined?undefined:JSON.stringify(body);
    const req=httpRequest({hostname:'127.0.0.1',port:dashboardPort,path,method,headers:{Host:'brake.example.test',...(data===undefined?{}:{'Content-Type':'application/scim+json','Content-Length':String(Buffer.byteLength(data))}),...headers}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode!,text,headers:res.headers,json:()=>JSON.parse(text)}));
    });req.on('error',reject);req.end(data);
  });
  const user=(subject='full-http-person')=>({schemas:[userSchema,extension],externalId:subject,userName:subject+'@example.test',displayName:'Fixture person',active:true,[extension]:{issuer:idpBase,subject}});
  return {call,directDashboard,user,token,config,store,close:async()=>{await close(ingress);await close(dashboard);await close(control);await system.close();}};
}

let dir:string,idp:Awaited<ReturnType<typeof signedIdp>>,long:Awaited<ReturnType<typeof installation>>,medium:Awaited<ReturnType<typeof installation>>,short:Awaited<ReturnType<typeof installation>>;
before(async()=>{
  dir=await mkdtemp(join(tmpdir(),'agentbrake-full-http-'));
  const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
  execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=brake.example.test','-addext','subjectAltName=DNS:brake.example.test','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem')],{stdio:'ignore',windowsHide:true});
  const [cert,key]=await Promise.all([readFile(join(dir,'cert.pem')),readFile(join(dir,'key.pem'))]);
  idp=await signedIdp();long=await installation(idp.base,cert,key,512);medium=await installation(idp.base,cert,key,300);short=await installation(idp.base,cert,key,64);
});
after(async()=>{for(const fixture of [long,medium,short])if(fixture)await fixture.close();if(idp)await idp.close();if(dir)await rm(dir,{recursive:true,force:true});});

test('TLS ingress preserves service authorization on exact SCIM routes',async()=>{
  const result=await short.call('/api/scim/v2/Users','GET',undefined,{Authorization:'Bearer '+short.token});
  assert.equal(result.status,200,'TLS SCIM service credential must reach the application: '+result.text);
  assert.equal(result.headers['strict-transport-security'],'max-age=31536000');
});
test('real dashboard proxy accepts the full configured 512-character SCIM token contract',async()=>{
  const result=await long.directDashboard('/api/scim/v2/Users','POST',long.user('token-boundary'),{Authorization:'Bearer '+long.token});
  assert.equal(result.status,201,'Configured 512-character service token must pass proxy origin/auth checks: '+result.text);
});
test('real dashboard proxy forwards bodyless SCIM DELETE without requiring JSON',async()=>{
  const created=await short.directDashboard('/api/scim/v2/Users','POST',short.user('delete-boundary'),{Authorization:'Bearer '+short.token});
  assert.equal(created.status,201);
  const removed=await short.directDashboard('/api/scim/v2/Users/'+created.json().id,'DELETE',undefined,{Authorization:'Bearer '+short.token});
  assert.equal(removed.status,204,'SCIM DELETE has no request document: '+removed.text);
});
test('actual TLS proxy app flow provisions with 300-character bearer and denies cross-install token',async()=>{
  const created=await medium.call('/api/scim/v2/Users','POST',medium.user(),{Authorization:'Bearer '+medium.token,'Content-Type':'application/scim+json'});
  assert.equal(created.status,201,'300-character provisioner credential must traverse HTTPS: '+created.text);
  assert.equal((await long.call('/api/scim/v2/Users','GET',undefined,{Authorization:'Bearer '+medium.token})).status,401);
});
test('full HTTPS OIDC exchange, mapped authority and SCIM offboarding use actual application sessions',async()=>{
  const created=await long.call('/api/scim/v2/Users','POST',long.user(),{Authorization:'Bearer '+long.token,'Content-Type':'application/scim+json'});
  assert.equal(created.status,201,'512-character provisioner credential must traverse HTTPS: '+created.text);
  const accountId=created.json().id;
  const group=await long.call('/api/scim/v2/Groups','POST',{schemas:[groupSchema],externalId:'fixture-operators',displayName:'Operators',members:[{value:accountId}]},{Authorization:'Bearer '+long.token});assert.equal(group.status,201);
  const read=await long.call('/api/scim/v2/Users/'+accountId,'GET',undefined,{Authorization:'Bearer '+long.token});assert.equal(read.status,200);assert.ok(read.headers.etag);
  const start=await long.call('/api/enterprise/oidc/start','POST',{}, {Origin:origin});assert.equal(start.status,200);
  const binding=(start.headers['set-cookie']??[]).find(cookie=>cookie.startsWith('ab_oidc='))!;assert.match(binding,/; Secure/);assert.match(binding,/SameSite=Lax/);
  const auth=await fetch(start.json().authorizationUrl,{redirect:'manual'});assert.equal(auth.status,302);
  const callback=new URL(auth.headers.get('location')!);assert.equal(callback.origin,origin);
  const callbackPath=callback.pathname+callback.search;
  assert.equal((await long.call(callbackPath)).status,401,'Callback requires the browser transaction cookie');
  const completed=await long.call(callbackPath,'GET',undefined,{Cookie:binding.split(';')[0]});assert.equal(completed.status,303,completed.text);assert.equal(completed.headers.location,'/');
  const session=(completed.headers['set-cookie']??[]).find(cookie=>cookie.startsWith('ab_session='))!;assert.match(session,/; Secure/);
  const sessionCookie=session.split(';')[0];
  const current=await long.call('/api/session','GET',undefined,{Cookie:sessionCookie});assert.equal(current.status,200);assert.equal(current.json().actor.id,accountId);assert.equal(current.json().actor.role,'operator');
  assert.equal((await medium.call('/api/session','GET',undefined,{Cookie:sessionCookie})).status,401);
  assert.equal((await long.call(callbackPath,'GET',undefined,{Cookie:binding.split(';')[0]})).status,401,'Consumed callback cannot replay');
  const profileHeaders={Cookie:sessionCookie,Origin:origin,'X-AB-CSRF':current.json().csrfToken};
  const task={name:'Fresh verified task',tools:['database_read'],resources:['customers'],sandbox:true};
  assert.equal((await long.call('/api/agents','POST',task,profileHeaders)).status,201);
  const count=long.store.agents().length;
  const clock=Date.now;
  try {
    Date.now=()=>clock()+301000;
    assert.equal((await long.call('/api/session','GET',undefined,{Cookie:sessionCookie})).status,200,'Bounded read session may remain active');
    assert.equal((await long.call('/api/agents','POST',{...task,name:'Must not create after stale MFA'},profileHeaders)).status,401,'Control mutation requires fresh signed authentication');
    assert.equal(long.store.agents().length,count);
  } finally {Date.now=clock;}
  assert.equal((await long.call('/api/scim/v2/Users/'+accountId,'DELETE',undefined,{Authorization:'Bearer '+long.token,'If-Match':String(read.headers.etag)})).status,204);
  assert.equal((await long.call('/api/session','GET',undefined,{Cookie:sessionCookie})).status,401);
  assert.equal((await long.call('/api/scim/v2/Users/'+accountId,'GET',undefined,{Authorization:'Bearer '+long.token})).status,404);
  assert.ok(idp.exchanges()>0,'Successful login must perform the real signed token exchange');
  assert.equal(long.store.verifyAudit(),true);
});
