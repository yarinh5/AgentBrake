import test from 'node:test';
import assert from 'node:assert/strict';
import { identityFixture,extension } from './identity-fixture.js';
const modulePath='../../server/security/enterprise-identity.js';
async function fixture(overrides:Record<string,unknown>={}) {
  const implementation=await import(modulePath).catch(()=>({}));
  assert.equal(typeof implementation.mountEnterpriseIdentity,'function','enterprise identity mount must exist');
  return identityFixture(implementation.mountEnterpriseIdentity,overrides);
}
test('signed OIDC code exchange requires provisioned subject, browser state and MFA',async()=>{
  const f=await fixture();try {
    assert.equal((await f.finish(await f.begin())).status,401);
    const created=await f.request('/api/scim/v2/Users',f.user());assert.equal(created.status,201);
    const flow=await f.begin();
    assert.equal((await fetch(flow.url,{redirect:'manual'})).status,401);
    // A missing cookie cannot consume the legitimate browser's transaction.
    const result=await f.finish(flow);assert.equal(result.status,303);assert.equal(result.headers.get('location'),'/');
    const cookie=result.headers.get('set-cookie')!.split(';')[0];
    const session=await f.request('/api/session',undefined,'GET',{Cookie:cookie});assert.equal(session.status,200);assert.equal(session.body.actor.role,'viewer');assert.equal(session.body.assurance.method,'oidc');
    assert.equal((await f.finish(flow)).status,401);
    for (const claims of [{iss:'https://wrong.example'},{aud:'wrong-client'},{nonce:'wrong'},{sub:'unprovisioned',email:'person@example.test'},{acr:'password'},{amr:['pwd']},{auth_time:1},{exp:1}]) {
      f.setClaims(claims);const rejected=await f.finish(await f.begin());assert.equal(rejected.status,401,JSON.stringify(claims));assert.equal((await rejected.json()).error,'Federated authentication failed');
    }
    f.setClaims({});f.setCorruptSignature(true);assert.equal((await f.finish(await f.begin())).status,401);
    assert.ok(f.tokenCalls()>=10);assert.equal(f.store.verifyAudit(),true);
  }finally{await f.close();}
});
test('SCIM service auth, atomic groups, ETags, immutable bindings and revocation',async()=>{
  const f=await fixture();try {
    assert.equal((await f.request('/api/scim/v2/Users',undefined,'GET',{Authorization:'Bearer wrong'})).status,401);
    const first=await f.request('/api/scim/v2/Users',f.user());assert.equal(first.status,201);const id=first.body.id;
    assert.equal((await f.request('/api/scim/v2/Users',f.user())).status,409);
    const group=await f.request('/api/scim/v2/Groups',{schemas:['urn:ietf:params:scim:schemas:core:2.0:Group'],externalId:'operators',displayName:'Operators',members:[{value:id}]});assert.equal(group.status,201);
    const login=await f.finish(await f.begin());const cookie=login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await f.request('/api/session',undefined,'GET',{Cookie:cookie})).body.actor.role,'operator');
    const before=f.store.identityState();
    const patch={schemas:['urn:ietf:params:scim:api:messages:2.0:PatchOp'],Operations:[{op:'replace',path:'active',value:false}]};
    assert.equal((await f.request('/api/scim/v2/Users/'+id,patch,'PATCH',{'If-Match':'W/"wrong"'})).status,412);assert.deepEqual(f.store.identityState(),before);
    const current=await f.request('/api/scim/v2/Users/'+id);
    assert.equal((await f.request('/api/scim/v2/Users/'+id,patch,'PATCH',{'If-Match':current.headers.get('etag')!})).status,200);
    assert.equal((await f.request('/api/session',undefined,'GET',{Cookie:cookie})).status,401);
    assert.equal((await f.finish(await f.begin())).status,401);
    const altered={...f.user(),[extension]:{issuer:f.config.issuer,subject:'attacker'}};
    assert.equal((await f.request('/api/scim/v2/Users/'+id,altered,'PUT')).status,400);
    assert.equal((await f.request('/api/scim/v2/Users?filter='+encodeURIComponent('userName eq "person@example.test"'))).body.totalResults,1);
    assert.equal((await f.request('/api/scim/v2/Users?filter='+encodeURIComponent('active pr'))).status,400);
    assert.equal((await f.request('/api/scim/v2/Bulk',{})).status,501);
  }finally{await f.close();}
});
test('in-flight OIDC exchange cannot resurrect an offboarded and reactivated account',async()=>{
  const f=await fixture();try {
    const user=await f.request('/api/scim/v2/Users',f.user());
    const flow=await f.begin();
    f.setBeforeToken(async()=>{
      for(const active of [false,true]) assert.equal((await f.request('/api/scim/v2/Users/'+user.body.id,{schemas:['urn:ietf:params:scim:api:messages:2.0:PatchOp'],Operations:[{op:'replace',path:'active',value:active}]},'PATCH')).status,200);
    });
    assert.equal((await f.finish(flow)).status,401);
    f.setBeforeToken(undefined);assert.equal((await f.finish(await f.begin())).status,303);
  }finally{await f.close();}
});
test('SCIM group changes roll back with audit and revoke sessions atomically',async()=>{
  const f=await fixture();try {
    const user=await f.request('/api/scim/v2/Users',f.user()),id=user.body.id;
    const group=await f.request('/api/scim/v2/Groups',{schemas:['urn:ietf:params:scim:schemas:core:2.0:Group'],externalId:'admins',displayName:'Admins',members:[{value:id}]});
    const session=await f.finish(await f.begin()),cookie=session.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await f.request('/api/session',undefined,'GET',{Cookie:cookie})).body.actor.role,'administrator');
    const patch={schemas:['urn:ietf:params:scim:api:messages:2.0:PatchOp'],Operations:[{op:'remove',path:'members[value eq "'+id+'"]'}]};
    const before=f.store.identityState();f.store.db.exec("CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'fixture unavailable'); END");
    assert.equal((await f.request('/api/scim/v2/Groups/'+group.body.id,patch,'PATCH')).status,503);assert.deepEqual(f.store.identityState(),before);
    f.store.db.exec('DROP TRIGGER fixture_audit_failure');
    const changed=await f.request('/api/scim/v2/Groups/'+group.body.id,patch,'PATCH');assert.equal(changed.status,200);
    assert.equal((await f.request('/api/session',undefined,'GET',{Cookie:cookie})).status,401);
    assert.equal(f.store.identityState().accounts.find(a=>a.id===id)!.role,'viewer');
    const again=await f.request('/api/scim/v2/Groups/'+group.body.id,patch,'PATCH');assert.equal(again.headers.get('etag'),changed.headers.get('etag'));
    assert.equal((await f.request('/api/scim/v2/Users/'+id,undefined,'DELETE')).status,204);
    assert.equal((await f.request('/api/scim/v2/Users/'+id,undefined,'DELETE')).status,204);
    assert.equal((await f.request('/api/scim/v2/Users/'+id)).status,404);
    assert.equal((await f.request('/api/scim/v2/Users',f.user())).status,409);
  }finally{await f.close();}
});
test('SCIM never links by email and explicit linking cannot claim break-glass',async()=>{
  const f=await fixture();try {
    assert.equal((await f.request('/api/scim/v2/Users',f.user('person-1','owner@example.test'))).status,409);
    const attempted={...f.user('person-1','owner@example.test'),[extension]:{issuer:f.config.issuer,subject:'person-1',accountId:'local-administrator'}};
    assert.equal((await f.request('/api/scim/v2/Users',attempted)).status,400);
    const state=f.store.identityState();assert.equal(state.accounts.length,1);assert.equal(state.accounts[0].federation,undefined);
    assert.equal((await f.request('/api/scim/v2/Users?count=101')).status,400);
    assert.equal((await f.request('/api/scim/v2/Users?startIndex=0')).status,400);
    assert.equal((await f.request('/api/scim/v2/Users?count=0')).body.itemsPerPage,0);
  }finally{await f.close();}
});
test('OIDC pending browser state expires and has bounded capacity',async()=>{
  const f=await fixture();const realNow=Date.now;try {
    await f.request('/api/scim/v2/Users',f.user());
    const expired=await f.begin();const started=realNow();Date.now=()=>started+301000;
    assert.equal((await f.finish(expired)).status,401);Date.now=realNow;
    // The expired entry is removed on the next start.
    Date.now=()=>started+301000;
    for(let i=0;i<256;i++)assert.equal((await f.request('/api/enterprise/oidc/start',{})).status,200);
    assert.equal((await f.request('/api/enterprise/oidc/start',{})).status,429);
  }finally{Date.now=realNow;await f.close();}
});
test('OIDC uses current configured group mapping rather than a persisted obsolete role',async()=>{
  const f=await fixture({groupRoleMapping:{}});try {
    const user=await f.request('/api/scim/v2/Users',f.user());
    // Persisted identity snapshot from an earlier installation configuration.
    f.store.changeIdentity(state=>{state.accounts.find(a=>a.id===user.body.id)!.role='administrator';state.scimGroups=[{id:'old-admin-group',externalId:'admins',displayName:'Admins',members:[user.body.id],revision:1}];return {result:undefined,audit:{type:'fixture.previous-configuration',details:{actorId:'fixture',targetId:'fixture',reason:'previous-mapping'}}};});
    const login=await f.finish(await f.begin());assert.equal(login.status,303);
    const cookie=login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await f.request('/api/session',undefined,'GET',{Cookie:cookie})).body.actor.role,'viewer');
  }finally{await f.close();}
});
