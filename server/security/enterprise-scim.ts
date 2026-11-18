import express from 'express';
import { randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ControlStore } from '../control-store.js';
import type { Account,IdentityState } from './accounts-state.js';
import { accountSchemas } from './accounts.js';
import { digest } from '../store.js';
import type { EnterpriseIdentityConfig } from './enterprise-identity.js';
const USER='urn:ietf:params:scim:schemas:core:2.0:User',GROUP='urn:ietf:params:scim:schemas:core:2.0:Group';
const EXT='urn:agentbrake:params:scim:schemas:extension:identity:2.0:User';
const PATCH='urn:ietf:params:scim:api:messages:2.0:PatchOp';
type Group=NonNullable<IdentityState['scimGroups']>[number];
class ScimError extends Error {constructor(readonly status:number,message:string,readonly scimType?:string){super(message);}}
const fail=(status:number,message:string,type?:string):never=>{throw new ScimError(status,message,type);};
const etag=(revision:number)=>`W/"${revision}"`;
const extensionSchema=z.object({issuer:z.string().url().max(2048),subject:z.string().min(1).max(256),accountId:z.string().min(1).max(64).optional()}).strict();
const userSchema=z.object({schemas:z.array(z.string()).max(8),externalId:z.string().min(1).max(256),userName:accountSchemas.email,displayName:accountSchemas.name,active:z.boolean(),[EXT]:extensionSchema}).strict();
const groupSchema=z.object({schemas:z.array(z.string()).max(8),externalId:z.string().min(1).max(256),displayName:accountSchemas.name,members:z.array(z.object({value:z.string().min(1).max(64)}).strict()).max(256).default([])}).strict();
function userResource(a:Account) {return {schemas:[USER,EXT],id:a.id,externalId:a.federation!.externalId,userName:a.email,displayName:a.name,active:a.active,[EXT]:{issuer:a.federation!.issuer,subject:a.federation!.subject},meta:{resourceType:'User',version:etag(a.revision),location:'/api/scim/v2/Users/'+a.id}};}
function groupResource(g:Group) {return {schemas:[GROUP],id:g.id,externalId:g.externalId,displayName:g.displayName,members:g.members.map(value=>({value})),meta:{resourceType:'Group',version:etag(g.revision),location:'/api/scim/v2/Groups/'+g.id}};}
function version(req:express.Request,revision:number){if(req.headers['if-match'] && req.headers['if-match']!==etag(revision))fail(412,'Resource version does not match','invalidVers');}
function schemas(actual:string[],required:string[]){if(actual.length!==required.length || !required.every(v=>actual.includes(v)))fail(400,'Unsupported resource schema','invalidValue');}
function memberIds(input:{value:string}[],state:IdentityState) {
  const ids=[...new Set(input.map(m=>m.value))].sort();
  if(ids.some(id=>!state.accounts.some(a=>a.id===id && a.federation && !a.federation.deleted))) fail(400,'Unknown provisioned group member','invalidValue');
  return ids;
}
export function provisionedRole(state:IdentityState,config:EnterpriseIdentityConfig,id:string):Account['role'] {
  const priorities={viewer:0,approver:1,operator:2,administrator:3};
  let role:Account['role']='viewer';
    for(const g of state.scimGroups??[]) if(!g.deleted && g.members.includes(id)) {
      const mapped=config.groupRoleMapping[g.externalId];if(mapped && priorities[mapped]>priorities[role])role=mapped;
    }
  return role;
}
function applyRoles(state:IdentityState,config:EnterpriseIdentityConfig) {
  for(const a of state.accounts.filter(a=>a.federation && !a.federation.deleted)) {
    const role=provisionedRole(state,config,a.id);
    if(a.role!==role){a.role=role;a.revision++;state.recoveries=state.recoveries.filter(r=>r.accountId!==a.id);}
  }
}
const audit=(type:string,id:string)=>({type:'identity.scim-'+type,details:{actorId:'scim-service',targetId:id,reason:'service-provisioning'}});
function patchInput(input:unknown) {
  const parsed=z.object({schemas:z.array(z.string()),Operations:z.array(z.object({op:z.enum(['add','replace','remove','Add','Replace','Remove']),path:z.string().max(256).optional(),value:z.unknown().optional()}).strict()).min(1).max(32)}).strict().parse(input);
  schemas(parsed.schemas,[PATCH]);return parsed.Operations;
}
function replaceUser(old:Account,raw:unknown,state:IdentityState,config:EnterpriseIdentityConfig) {
  const input=userSchema.parse(raw);schemas(input.schemas,[USER,EXT]);const binding=input[EXT];
  if(binding.issuer!==old.federation!.issuer || binding.subject!==old.federation!.subject || input.externalId!==old.federation!.externalId || (binding.accountId && binding.accountId!==old.id))fail(400,'Federated binding is immutable','mutability');
  if(state.accounts.some(a=>a.id!==old.id && a.email===input.userName))fail(409,'User name already exists','uniqueness');
  if(old.name!==input.displayName || old.email!==input.userName || old.active!==input.active) {
    old.name=input.displayName;old.email=input.userName;old.active=input.active;old.revision++;
    state.recoveries=state.recoveries.filter(r=>r.accountId!==old.id);
  }
  applyRoles(state,config);return old;
}
export function mountScim(app:express.Express,{store,config,ready}:{store:ControlStore;config:EnterpriseIdentityConfig;ready:()=>Promise<IdentityState>}) {
  const router=express.Router();
  router.use((q,r,next)=>{
    r.type('application/scim+json');r.setHeader('Cache-Control','no-store');
    const supplied=q.headers.authorization;
    if(!supplied || !timingSafeEqual(Buffer.from(digest(supplied)),Buffer.from(digest('Bearer '+config.scimToken)))) {next(new ScimError(401,'Service credential required'));return;}
    next();
  });
  router.use(express.json({type:['application/scim+json','application/json'],limit:'32kb'}));
  router.use(async(_q,_r,next)=>{await ready();next();});
  router.get('/ServiceProviderConfig',(_q,r)=>r.json({schemas:['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],patch:{supported:true},bulk:{supported:false,maxOperations:0,maxPayloadSize:0},filter:{supported:true,maxResults:100},changePassword:{supported:false},sort:{supported:false},etag:{supported:true},authenticationSchemes:[{type:'oauthbearertoken',name:'Service bearer token',description:'Dedicated provisioning token',primary:true}]}));
  router.get('/ResourceTypes',(_q,r)=>r.json({schemas:['urn:ietf:params:scim:api:messages:2.0:ListResponse'],totalResults:2,startIndex:1,itemsPerPage:2,Resources:[{schemas:['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],id:'User',name:'User',endpoint:'/Users',schema:USER,schemaExtensions:[{schema:EXT,required:true}]},{schemas:['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],id:'Group',name:'Group',endpoint:'/Groups',schema:GROUP}]}));
  for(const kind of ['Users','Groups'] as const) {
    router.get('/'+kind,async(q,r)=>{
      if(Object.keys(q.query).some(k=>!['filter','startIndex','count'].includes(k)))fail(400,'Unsupported list parameter','invalidValue');
      const integer=(value:unknown,fallback:number,min:number,max:number)=>{if(value===undefined)return fallback;if(typeof value!=='string'||!/^\d{1,8}$/.test(value))return fail(400,'Invalid pagination','invalidValue');const n=Number(value);if(n<min||n>max)fail(400,'Pagination out of bounds','invalidValue');return n;};
      const start=integer(q.query.startIndex,1,1,1000000),count=integer(q.query.count,100,0,100);
      const state=await store.identityState();
      let resources:Record<string,any>[]=kind==='Users'?state.accounts.filter(a=>a.federation&&!a.federation.deleted).map(userResource):(state.scimGroups??[]).filter(g=>!g.deleted).map(groupResource);
      if(q.query.filter!==undefined){const filter=q.query.filter;if(typeof filter!=='string'||filter.length>512)fail(400,'Invalid filter','invalidFilter');const match=/^(id|userName|externalId|displayName) eq "([^"\\]{1,256})"$/.exec(filter as string);if(!match || (kind==='Groups'&&match[1]==='userName'))fail(400,'Supported filters: id, userName, externalId, displayName eq string','invalidFilter');resources=resources.filter(v=>v[match![1]]===match![2]);}
      r.json({schemas:['urn:ietf:params:scim:api:messages:2.0:ListResponse'],totalResults:resources.length,startIndex:start,itemsPerPage:resources.slice(start-1,start-1+count).length,Resources:resources.slice(start-1,start-1+count)});
    });
    router.get('/'+kind+'/:id',async(q,r)=>{
      const state=await store.identityState(),id=String(q.params.id);
      const resource=kind==='Users'?state.accounts.find(a=>a.id===id&&a.federation&&!a.federation.deleted):(state.scimGroups??[]).find(g=>g.id===id&&!g.deleted);
      if(!resource)fail(404,'Resource not found');r.setHeader('ETag',etag(resource!.revision));r.json(kind==='Users'?userResource(resource as Account):groupResource(resource as Group));
    });
  }
  router.post('/Users',async(q,r)=>{
    const input=userSchema.parse(q.body);schemas(input.schemas,[USER,EXT]);const binding=input[EXT];
    if(binding.issuer!==config.issuer)fail(400,'Configured issuer required','invalidValue');
    const result=await store.changeIdentity(state=>{
      if(state.accounts.some(a=>a.federation&&(a.federation.externalId===input.externalId || (a.federation.issuer===binding.issuer&&a.federation.subject===binding.subject))))fail(409,'Federated identity already exists','uniqueness');
      let a=state.accounts.find(a=>a.id===binding.accountId);
      if(binding.accountId && (!a || a.federation || a.id===config.breakGlassAccountId))fail(400,'Explicit account binding is unavailable','invalidValue');
      if(state.accounts.some(other=>other.email===input.userName && other.id!==a?.id))fail(409,'User name already exists; explicit account ID binding required','uniqueness');
      if(!a){if(state.accounts.length>=256)fail(409,'Account capacity reached');a={id:randomUUID(),name:input.displayName,email:input.userName,role:'viewer',tenant:'local',active:input.active,revision:1,passwordHash:{salt:randomBytes(16).toString('hex'),hash:randomBytes(64).toString('hex')}};state.accounts.push(a);}
      else {a.revision++;a.name=input.displayName;a.email=input.userName;a.active=input.active;a.role='viewer';a.passwordHash={salt:randomBytes(16).toString('hex'),hash:randomBytes(64).toString('hex')};}
      a.federation={issuer:binding.issuer,subject:binding.subject,externalId:input.externalId};state.recoveries=state.recoveries.filter(v=>v.accountId!==a!.id);state.invitations=state.invitations.filter(v=>v.email!==a!.email);
      return {result:userResource(a),audit:audit('user-created',a.id)};
    });r.status(201).setHeader('Location',result.meta.location);r.setHeader('ETag',result.meta.version);r.json(result);
  });
  for(const method of ['put','patch'] as const) router[method]('/Users/:id',async(q,r)=>{
    const result=await store.changeIdentity(state=>{
      const a=state.accounts.find(a=>a.id===q.params.id&&a.federation&&!a.federation.deleted);if(!a)fail(404,'Resource not found');version(q,a!.revision);
      let body=q.body;
      if(method==='patch') {
        const base=userResource(a!);body={schemas:base.schemas,externalId:base.externalId,userName:base.userName,displayName:base.displayName,active:base.active,[EXT]:base[EXT]};
        for(const op of patchInput(q.body)) {
          if(!op.path || !['active','displayName','userName'].includes(op.path) || op.op.toLowerCase()==='remove')fail(400,'Unsupported User patch operation','invalidPath');
          body[op.path!]=op.value;
        }
      }
      const changed=replaceUser(a!,body,state,config);return {result:userResource(changed),audit:audit('user-updated',changed.id)};
    });r.setHeader('ETag',result.meta.version);r.json(result);
  });
  router.delete('/Users/:id',async(q,r)=>{
    await store.changeIdentity(state=>{
      const a=state.accounts.find(a=>a.id===q.params.id&&a.federation);if(!a)fail(404,'Resource not found');version(q,a!.revision);
      if(!a!.federation!.deleted){a!.active=false;a!.federation!.deleted=true;a!.revision++;state.recoveries=state.recoveries.filter(v=>v.accountId!==a!.id);for(const g of state.scimGroups??[])if(g.members.includes(a!.id)){g.members=g.members.filter(id=>id!==a!.id);g.revision++;}}
      return {result:undefined,audit:audit('user-deleted',a!.id)};
    });r.status(204).end();
  });
  router.post('/Groups',async(q,r)=>{
    const input=groupSchema.parse(q.body);schemas(input.schemas,[GROUP]);
    const result=await store.changeIdentity(state=>{
      state.scimGroups??=[];if(state.scimGroups.some(g=>g.externalId===input.externalId))fail(409,'Group already exists','uniqueness');if(state.scimGroups.length>=128)fail(409,'Group capacity reached');
      const group:Group={id:randomUUID(),externalId:input.externalId,displayName:input.displayName,members:memberIds(input.members,state),revision:1};state.scimGroups.push(group);applyRoles(state,config);
      return {result:groupResource(group),audit:audit('group-created',group.id)};
    });r.status(201).setHeader('Location',result.meta.location);r.setHeader('ETag',result.meta.version);r.json(result);
  });
  for(const method of ['put','patch'] as const)router[method]('/Groups/:id',async(q,r)=>{
    const result=await store.changeIdentity(state=>{
      const group=state.scimGroups?.find(g=>g.id===q.params.id&&!g.deleted);if(!group)fail(404,'Resource not found');version(q,group!.revision);
      let body=q.body;
      if(method==='patch'){
        body={schemas:[GROUP],externalId:group!.externalId,displayName:group!.displayName,members:group!.members.map(value=>({value}))};
        for(const op of patchInput(q.body)){
          const action=op.op.toLowerCase();
          if(op.path==='displayName'&&action!=='remove')body.displayName=op.value;
          else if(op.path==='members'){
            if(action==='remove')body.members=[];
            else {const members=z.array(z.object({value:z.string().min(1).max(64)}).strict()).max(256).parse(op.value);body.members=action==='add'?[...body.members,...members]:members;}
          }else {const match=/^members\[value eq "([a-zA-Z0-9_-]{1,64})"\]$/.exec(op.path??'');if(!match||action!=='remove')fail(400,'Unsupported Group patch operation','invalidPath');body.members=body.members.filter((m:{value:string})=>m.value!==match![1]);}
        }
      }
      const input=groupSchema.parse(body);schemas(input.schemas,[GROUP]);if(input.externalId!==group!.externalId)fail(400,'Group externalId is immutable','mutability');
      const members=memberIds(input.members,state);
      if(group!.displayName!==input.displayName||JSON.stringify(group!.members)!==JSON.stringify(members)){group!.displayName=input.displayName;group!.members=members;group!.revision++;}
      applyRoles(state,config);return {result:groupResource(group!),audit:audit('group-updated',group!.id)};
    });r.setHeader('ETag',result.meta.version);r.json(result);
  });
  router.delete('/Groups/:id',async(q,r)=>{
    await store.changeIdentity(state=>{const g=state.scimGroups?.find(g=>g.id===q.params.id);if(!g)fail(404,'Resource not found');version(q,g!.revision);if(!g!.deleted){g!.deleted=true;g!.members=[];g!.revision++;applyRoles(state,config);}return {result:undefined,audit:audit('group-deleted',g!.id)};});r.status(204).end();
  });
  router.use((_q,_r,next)=>next(new ScimError(501,'SCIM operation is not supported')));
  router.use((error:unknown,_q:express.Request,r:express.Response,_n:express.NextFunction)=>{
    const status=error instanceof ScimError?error.status:error instanceof z.ZodError?400:503;
    r.status(status).json({schemas:['urn:ietf:params:scim:api:messages:2.0:Error'],status:String(status),detail:error instanceof ScimError?error.message:error instanceof z.ZodError?'Invalid SCIM resource':'Identity service unavailable',...(error instanceof ScimError&&error.scimType?{scimType:error.scimType}:{})});
  });
  app.use('/api/scim/v2',router);
}
