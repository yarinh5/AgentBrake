import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../server/store.js';
import { LocalOperators } from '../../server/security/operators.js';
import { ManagedAccounts } from '../../server/security/accounts.js';

const key = 'fixture-bootstrap-key-00000000000000';
const password = 'Fixture enterprise password 47!';
async function fixture(breakGlassAccountId?: string) {
  const store = new Store(':memory:');
  const legacy = new LocalOperators(key);
  const local = new ManagedAccounts(store, legacy);
  const owner = await local.setup({key,password,email:'owner@example.test',name:'Owner'});
  const enterprise = new (ManagedAccounts as any)(store,legacy,{ssoRequired:true,breakGlassAccountId}) as ManagedAccounts;
  return {store,legacy,local,owner,enterprise};
}
test('SSO policy rejects password, legacy sessions, recovery and bootstrap bypasses', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.enterprise.login({email:'owner@example.test',password}), /federated|SSO/i);
    await assert.rejects(f.enterprise.authenticate('ab_session='+f.owner.token), /federated|SSO/i);
    await assert.rejects(f.enterprise.recovery(f.owner,f.owner.actor.id,{}), /federated|SSO/i);
    await assert.rejects(f.enterprise.reset({token:'old-token',password}), /federated|SSO/i);
    await assert.rejects(f.enterprise.accept({token:'old-token',name:'Other',password}), /federated|SSO/i);
    await assert.rejects(f.enterprise.setup({key,password,email:'other@example.test',name:'Other'}), /federated|SSO/i);
  } finally {f.store.close();}
});
test('explicit break-glass only authenticates named admin and does not claim OIDC assurance', async () => {
  const f = await fixture('local-administrator');
  try {
    const session = await f.enterprise.login({email:'owner@example.test',password});
    assert.equal((session as any).assurance?.method,'break-glass');
    assert.equal((await f.enterprise.authenticate('ab_session='+session.token) as any).assurance?.method,'break-glass');
    assert.ok(f.store.auditTrail().some(e => JSON.parse(e.data).type === 'identity.break-glass-login'));
  } finally {f.store.close();}
});
test('federated account cannot also act as break-glass even with its former local password',async()=>{
  const f=await fixture('local-administrator');try {
    f.store.changeIdentity(state=>{state.accounts[0].federation={issuer:'https://fixture.test',subject:'person',externalId:'person'};return {result:undefined,audit:{type:'fixture.provisioned',details:{actorId:'fixture',targetId:'fixture',reason:'test'}}};});
    await assert.rejects(f.enterprise.login({email:'owner@example.test',password}),/federated|SSO/i);
  }finally{f.store.close();}
});
