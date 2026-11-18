import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as oidc from 'openid-client';
import { z } from 'zod';
import { HttpError } from '../contracts.js';
import type { ControlStore } from '../control-store.js';
import { digest } from '../store.js';
import type { ManagedAccounts } from './accounts.js';
import { LocalOperators } from './operators.js';
import { mountScim, provisionedRole } from './enterprise-scim.js';

const configSchema = z.object({
  issuer:z.string().url().max(2048),authorizationEndpoint:z.string().url().max(2048),tokenEndpoint:z.string().url().max(2048),jwksUri:z.string().url().max(2048),
  clientId:z.string().min(1).max(256),clientSecret:z.string().min(16).max(4096),redirectUri:z.string().url().max(2048),
  requiredAcr:z.array(z.string().min(1).max(256)).min(1).max(16),requiredAmr:z.array(z.string().min(1).max(80)).min(1).max(16),
  maxAuthAgeSeconds:z.number().int().min(1).max(3600),scimToken:z.string().regex(/^[\x21-\x7e]{32,512}$/),
  groupRoleMapping:z.record(z.string().min(1).max(256),z.enum(['administrator','operator','approver','viewer'])),
  breakGlassAccountId:z.string().min(1).max(64).optional(),providerLabel:z.string().min(1).max(80).optional(),testOnlyAllowLoopbackHttp:z.boolean().optional(),
}).strict();
export type EnterpriseIdentityConfig = z.infer<typeof configSchema>;
export function validateEnterpriseIdentityConfig(input:unknown):EnterpriseIdentityConfig {
  const c=configSchema.parse(input);
  for(const value of [c.issuer,c.authorizationEndpoint,c.tokenEndpoint,c.jwksUri,c.redirectUri]) {
    const u=new URL(value);
    if(u.username || u.password || u.hash || u.search || !(u.protocol==='https:' || (c.testOnlyAllowLoopbackHttp && u.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(u.hostname)))) throw Error('Enterprise identity URLs require HTTPS and no credentials, query or fragment');
  }
  if(new URL(c.redirectUri).pathname!=='/api/enterprise/oidc/callback') throw Error('Enterprise identity callback path is fixed');
  if([c.authorizationEndpoint,c.tokenEndpoint,c.jwksUri].some(value=>new URL(value).origin!==new URL(c.issuer).origin)) throw Error('Identity endpoints must share the configured issuer origin');
  if(Object.keys(c.groupRoleMapping).length>128) throw Error('Too many SCIM group mappings');
  return c;
}
export type EnterpriseIdentityMountOptions = {
  store:ControlStore;accounts:ManagedAccounts;legacy:LocalOperators;config:EnterpriseIdentityConfig;
  secureCookies?:boolean;sessionCookie:(token:string,seconds:number)=>string;
  transport?:typeof fetch;
};
export function mountEnterpriseIdentity(app:express.Express,options:EnterpriseIdentityMountOptions) {
  const c=validateEnterpriseIdentityConfig(options.config),{store,legacy}=options;
  if(!options.secureCookies && !c.testOnlyAllowLoopbackHttp) throw Error('Enterprise identity requires secure cookies');
  const client=new oidc.Configuration({issuer:c.issuer,authorization_endpoint:c.authorizationEndpoint,token_endpoint:c.tokenEndpoint,jwks_uri:c.jwksUri,id_token_signing_alg_values_supported:['RS256']},c.clientId,{client_secret:c.clientSecret,id_token_signed_response_alg:'RS256'},oidc.ClientSecretPost(c.clientSecret));
  client.timeout=10;
  client[oidc.customFetch]=async(url,init)=>{
    if(![c.tokenEndpoint,c.jwksUri].includes(url)) throw Error('Unconfigured identity endpoint');
    return (options.transport??fetch)(url,{...init,redirect:'error'} as RequestInit);
  };
  if(c.testOnlyAllowLoopbackHttp) oidc.allowInsecureRequests(client);
  oidc.enableNonRepudiationChecks(client);
  type Pending={nonce:string;verifier:string;browserHash:string;expiresAt:number;revisions:Map<string,number>};
  const pending=new Map<string,Pending>();
  const cookie=(value:string,seconds:number)=>`ab_oidc=${value}; HttpOnly; SameSite=Lax; Path=/api/enterprise/oidc; Max-Age=${seconds}${options.secureCookies?'; Secure':''}`;
  const ready=async()=>{
    const state=await store.identityState();
    if(!state.initialized) throw new HttpError(503,'Initialize managed accounts before enabling SSO');
    if(c.breakGlassAccountId && !state.accounts.some(a=>a.id===c.breakGlassAccountId && a.active && a.role==='administrator' && !a.federation)) throw new HttpError(503,'Configured break-glass account is unavailable');
    return state;
  };
  app.get(['/api/enterprise/auth','/api/enterprise/auth/status'],async(_q,r)=>r.json({enabled:true,providerLabel:c.providerLabel??'Organization SSO',ssoRequired:true,breakGlassEnabled:!!c.breakGlassAccountId,initialized:(await store.identityState()).initialized}));
  app.post('/api/enterprise/oidc/start',async(q,r)=>{
    if(q.body && Object.keys(q.body).length) throw new HttpError(400,'SSO start does not accept parameters');
    const state=await ready();
    for(const [key,p] of pending) if(p.expiresAt<=Date.now()) pending.delete(key);
    if(pending.size>=256) throw new HttpError(429,'Too many pending sign-ins');
    const stateToken=oidc.randomState(),nonce=oidc.randomNonce(),verifier=oidc.randomPKCECodeVerifier(),browser=randomBytes(32).toString('hex');
    const challenge=await oidc.calculatePKCECodeChallenge(verifier);
    // Recheck after the asynchronous digest, before consuming bounded capacity.
    if(pending.size>=256) throw new HttpError(429,'Too many pending sign-ins');
    pending.set(stateToken,{nonce,verifier,browserHash:digest(browser),expiresAt:Date.now()+300000,revisions:new Map(state.accounts.filter(a=>a.active).map(a=>[a.id,a.revision]))});
    const url=oidc.buildAuthorizationUrl(client,{redirect_uri:c.redirectUri,scope:'openid',response_type:'code',response_mode:'query',state:stateToken,nonce,code_challenge:challenge,code_challenge_method:'S256',max_age:String(c.maxAuthAgeSeconds),acr_values:c.requiredAcr.join(' ')});
    r.setHeader('Set-Cookie',cookie(browser,300));r.json({authorizationUrl:url.href});
  });
  app.get('/api/enterprise/oidc/callback',async(q,r)=>{
    let reservation:ReturnType<LocalOperators['reserveSession']>|undefined;
    try {
      const query=new URLSearchParams(q.originalUrl.split('?')[1]??'');
      if(query.getAll('state').length!==1 || query.getAll('code').length>1 || [...query].some(([k])=>!['state','code','iss','error','error_description','error_uri','session_state'].includes(k))) throw Error('Invalid response');
      const key=query.get('state')!,p=pending.get(key);
      const browser=q.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('ab_oidc='))?.slice(8);
      if(!p || !browser || p.expiresAt<=Date.now() || !timingSafeEqual(Buffer.from(p.browserHash),Buffer.from(digest(browser)))) throw Error('Invalid transaction');
      pending.delete(key); // One use, including failed token exchanges.
      reservation=legacy.reserveSession();
      const callback=new URL(c.redirectUri);callback.search=query.toString();
      const tokens=await oidc.authorizationCodeGrant(client,callback,{expectedState:key,expectedNonce:p.nonce,pkceCodeVerifier:p.verifier,idTokenExpected:true,maxAge:c.maxAuthAgeSeconds});
      const claims=tokens.claims();
      const now=Math.floor(Date.now()/1000);
      const amr=claims?.amr;
      if(!claims || typeof claims.sub!=='string' || typeof claims.acr!=='string' || !c.requiredAcr.includes(claims.acr) || !Array.isArray(amr) || !c.requiredAmr.every(v=>amr.includes(v)) || typeof claims.auth_time!=='number' || !Number.isInteger(claims.auth_time) || claims.auth_time>now+30 || now-claims.auth_time>c.maxAuthAgeSeconds) throw Error('Insufficient assurance');
      const account=await store.changeIdentity(state=>{
        const a=state.accounts.find(a=>a.federation?.issuer===c.issuer && a.federation.subject===claims.sub);
        if(!state.initialized || !a?.active || a.federation?.deleted || p.revisions.get(a.id)!==a.revision || a.id===c.breakGlassAccountId) throw Error('Unprovisioned identity');
        const role=provisionedRole(state,c,a.id);
        if(a.role!==role){a.role=role;a.revision++;state.recoveries=state.recoveries.filter(v=>v.accountId!==a.id);}
        return {result:a,audit:{type:'identity.federated-login',details:{actorId:a.id,targetId:a.id,reason:'signed-idp-mfa'}}};
      });
      const session=reservation.issue({id:account.id,name:account.name,role:account.role,tenant:account.tenant},'account',account.revision,{method:'oidc',issuer:c.issuer,authTime:claims.auth_time});
      r.setHeader('Set-Cookie',[options.sessionCookie(session.token,28800),cookie('',0)]);r.redirect(303,'/');
    } catch {
      r.status(401).json({error:'Federated authentication failed'});
    } finally {reservation?.release();}
  });
  mountScim(app,{store,config:c,ready});
  return {close:()=>pending.clear(),validateReady:ready};
}
