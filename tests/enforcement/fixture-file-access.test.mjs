import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,stat,rm} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareFixtureAccess} from '../../scripts/fixture-file-access.mjs';
test('fixture permissions preserve private parent and authorize only the runtime group on Linux',{skip:process.platform!=='linux'?'Requires POSIX UID/GID and Docker on Linux; exercised by hosted Native CI':false},async()=>{
 const parent=resolve('.agentbrake-local');await mkdir(parent,{recursive:true});const dir=await mkdtemp(join(parent,'fixture-access-'));
 try{
  await writeFile(join(dir,'opa-auth.json'),'synthetic-fixture',{mode:0o600});await writeFile(join(dir,'agent-credential.json'),'{}',{mode:0o600});
  const access=await prepareFixtureAccess(dir,['opa-auth.json'],['agent-credential.json']);
  assert.match(access.group,/^[0-9]+$/);
  if(process.platform==='linux'){
   assert.equal((await stat(dir)).mode&0o777,0o700);assert.equal((await stat(join(dir,'opa-auth.json'))).mode&0o777,0o640);assert.equal((await stat(join(dir,'agent-credential.json'))).mode&0o777,0o660);
   const image='library/node@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee';
   const base=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','65530:65530','--mount',`type=bind,src=${join(dir,'opa-auth.json')},dst=/read,readonly`,'--mount',`type=bind,src=${join(dir,'agent-credential.json')},dst=/write`];
   const probe="const f=require('fs');try{if(f.readFileSync('/read','utf8')!=='synthetic-fixture')process.exit(3);f.writeFileSync('/write','{\"ok\":true}');process.exit(0)}catch(e){process.exit(e.code==='EACCES'?13:14)}";
   const run=extra=>spawnSync('docker',[...base,...extra,image,'node','-e',probe],{encoding:'utf8',timeout:120000});
   assert.equal(run([]).status,13,'Unrelated runtime must not read the fixture');
   assert.equal(run(['--group-add',access.group]).status,0,'Explicit runtime group can read secret and write credential');
  }
 }finally{assert.equal(dirname(dir),parent);assert.match(basename(dir),/^fixture-access-/);await rm(dir,{recursive:true,force:true});}
});
