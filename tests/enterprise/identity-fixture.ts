import express from 'express';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { Server } from 'node:http';
import { Store } from '../../server/store.js';
import { ManagedAccounts } from '../../server/security/accounts.js';
import { LocalOperators } from '../../server/security/operators.js';
export const extension = 'urn:agentbrake:params:scim:schemas:extension:identity:2.0:User';
export const scimToken = 'fixture-scim-service-token-00000000000000000000';
const listen = async (app: express.Express) => {
  const server = app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve => server.once('listening',resolve));
  return {server,base:'http://127.0.0.1:'+(server.address() as {port:number}).port};
};
const close = async (server:Server) => {server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r()));};
export async function identityFixture(mount: Function, overrides: Record<string,unknown> = {}) {
  const pair = generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk = {...pair.publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig'};
  const idpApp = express(); idpApp.use(express.urlencoded({extended:false}));
  const codes = new Map<string,URL>();
  let claims:Record<string,unknown> = {}, beforeToken:(()=>Promise<void>)|undefined, corruptSignature=false;
  let tokenCalls=0;
  idpApp.get('/jwks',(_q,r)=>r.json({keys:[jwk]}));
  idpApp.get('/authorize',(q,r)=>{
    const u = new URL(q.originalUrl,idp.base), code=randomUUID();codes.set(code,u);
    const target=new URL(u.searchParams.get('redirect_uri')!); target.searchParams.set('code',code);target.searchParams.set('state',u.searchParams.get('state')!);r.redirect(target.href);
  });
  idpApp.post('/token',async(q,r)=>{
    tokenCalls++;
    const u=codes.get(q.body.code);codes.delete(q.body.code);
    if (!u || q.body.client_id!=='fixture-client' || q.body.client_secret!=='fixture-client-secret' || q.body.redirect_uri!==u.searchParams.get('redirect_uri') || createHash('sha256').update(q.body.code_verifier??'').digest('base64url')!==u.searchParams.get('code_challenge')) {r.status(400).json({error:'invalid_grant',error_description:'private-token-error-secret'});return;}
    if(beforeToken) await beforeToken();
    const now=Math.floor(Date.now()/1000);
    const payload={iss:idp.base,aud:'fixture-client',sub:'person-1',iat:now,exp:now+300,auth_time:now,nonce:u.searchParams.get('nonce'),acr:'urn:fixture:mfa',amr:['pwd','otp'],...claims};
    const content=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature=sign('RSA-SHA256',Buffer.from(content),pair.privateKey);
    if(corruptSignature) signature[0]^=1;
    r.json({token_type:'Bearer',access_token:'fixture-unused-access-token',id_token:content+'.'+signature.toString('base64url')});
  });
  const idp=await listen(idpApp);
  const store=new Store(':memory:'),legacy=new LocalOperators('fixture-bootstrap-key-000000000000');
  await new ManagedAccounts(store,legacy).setup({key:'fixture-bootstrap-key-000000000000',name:'Owner',email:'owner@example.test',password:'Fixture owner password 49!'});
  const accounts=new ManagedAccounts(store,legacy,{ssoRequired:true,breakGlassAccountId:'local-administrator'});
  const app=express();app.use(express.json({limit:'32kb',type:['application/json','application/scim+json']}));
  const control=await listen(app);
  const config={issuer:idp.base,authorizationEndpoint:idp.base+'/authorize',tokenEndpoint:idp.base+'/token',jwksUri:idp.base+'/jwks',clientId:'fixture-client',clientSecret:'fixture-client-secret',redirectUri:control.base+'/api/enterprise/oidc/callback',requiredAcr:['urn:fixture:mfa'],requiredAmr:['otp'],maxAuthAgeSeconds:300,scimToken,groupRoleMapping:{'operators':'operator','admins':'administrator'},breakGlassAccountId:'local-administrator',testOnlyAllowLoopbackHttp:true,...overrides};
  const sessionCookie=(token:string,seconds:number)=>`ab_session=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${seconds}`;
  mount(app,{store,accounts,legacy,config,secureCookies:false,sessionCookie});
  app.get('/api/session',async(q,r)=>{const s=await accounts.authenticate(q.headers.cookie);r.json({actor:s.actor,assurance:s.assurance});});
  app.use((error:any,_q:express.Request,r:express.Response,_n:express.NextFunction)=>r.status(error.status??500).json({error:error.message}));
  const request=async(path:string,body?:unknown,method=body===undefined?'GET':'POST',extra:Record<string,string>={})=>{
    const response=await fetch(control.base+path,{method,redirect:'manual',headers:{'Content-Type':'application/scim+json',Authorization:'Bearer '+scimToken,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const raw=await response.text(); return {status:response.status,body:raw?JSON.parse(raw):undefined,headers:response.headers};
  };
  const begin=async()=>{
    const start=await request('/api/enterprise/oidc/start',{});
    const authorization=await fetch(start.body.authorizationUrl,{redirect:'manual'});
    return {url:authorization.headers.get('location')!,cookie:start.headers.get('set-cookie')!.split(';')[0]};
  };
  const finish=async(flow:{url:string,cookie:string})=>fetch(flow.url,{redirect:'manual',headers:{Cookie:flow.cookie}});
  const user=(subject='person-1',userName='person@example.test')=>({schemas:['urn:ietf:params:scim:schemas:core:2.0:User',extension],userName,displayName:'Person',active:true,externalId:subject,[extension]:{issuer:idp.base,subject}});
  return {store,accounts,legacy,config,request,begin,finish,user,setClaims:(v:Record<string,unknown>)=>{claims=v;},setBeforeToken:(v:(()=>Promise<void>)|undefined)=>{beforeToken=v;},setCorruptSignature:(v:boolean)=>{corruptSignature=v;},tokenCalls:()=>tokenCalls,close:async()=>{await close(control.server);await close(idp.server);store.close();}};
}
