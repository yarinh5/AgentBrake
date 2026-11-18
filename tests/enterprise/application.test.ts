import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../../server/app.js';

test('compatibility install exposes disabled enterprise sign-in without enabling provisioning',async t=>{
  const system=createApp({databasePath:':memory:',adminKey:'synthetic-administrator-key-12345678',managedAccounts:true});
  const server=system.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  t.after(async()=>{server.closeAllConnections();server.close();await system.close();});
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const status=await fetch(base+'/api/enterprise/auth');assert.equal(status.status,200);assert.deepEqual(await status.json(),{enabled:false});
  assert.equal((await fetch(base+'/api/scim/v2/Users')).status,404);
  assert.equal((await fetch(base+'/api/enterprise/status')).status,401);
});
test('gateway surface cannot enable human enterprise credentials',()=>{
  assert.throws(()=>createApp({databasePath:':memory:',adminKey:'synthetic-administrator-key-12345678',surface:'gateway',enterpriseIdentity:{} as any}),/Enterprise identity requires managed control accounts/);
});
