import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join,resolve,dirname,basename,sep} from 'node:path';
import {initializeProduct,composeProduct,dockerProduct} from '../../scripts/product.mjs';

test('Linux product installer permits mounted runtime secrets only to configured service identities',{
 skip:process.platform!=='linux'?'Requires real Linux bind-mount permissions and Docker':false,
},async()=>{
 const config=await initializeProduct('verify-access-'+randomUUID().slice(0,8),4338);
 try{
  const composed=JSON.parse(await composeProduct(config,['config','--format','json'],{capture:true}));
  const image=JSON.parse(await readFile('infra/local/images.lock.json','utf8')).images.node.image;
  const probe=async(user,groups,mounts)=>{
   const paths=mounts.map(m=>m.target);
   const js=`try{for(const p of ${JSON.stringify(paths)}){if(!require('fs').readFileSync(p).length)process.exit(20)}process.exit(0)}catch(e){console.error(e.code);process.exit(e.code==='EACCES'?13:21)}`;
   try{await dockerProduct(config,['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','128m','--user',user,...groups.flatMap(g=>['--group-add',String(g)]),...mounts.flatMap(m=>['--mount',`type=bind,src=${m.source},dst=${m.target},readonly`]),image,'node','-e',js],{capture:true});return 0;}
   catch(e){return /EACCES/.test(e.errorOutput??'')?13:1;}
  };
  for(const [name,uid] of [['gateway','1000:1000'],['opa','1000:1000'],['control-db','70:70'],['target-db','70:70']]){
   const service=composed.services[name];
   assert.equal(service.user,name.endsWith('-db')?'postgres':'1000:1000');
   const mounts=service.volumes.filter(m=>m.type==='bind'&&m.source.startsWith(config.dir+sep));
   assert.ok(mounts.length>0);assert.ok(mounts.every(m=>m.read_only===true));
   assert.equal(await probe(uid,service.group_add??[],mounts),0,name+' must read its actual mounted installation files');
   const unrelated=process.getgid()===65530?'65531:65531':'65530:65530';
   assert.equal(await probe(unrelated,[],mounts),13,name+' files must deny an unrelated runtime');
  }
  assert.equal((await stat(config.dir)).mode&0o777,0o700,'Host users cannot traverse the private installation directory');
  assert.equal((await stat(join(config.dir,'installation.json'))).mode&0o777,0o600,'Operator-only metadata keeps owner-only permissions');
 }finally{
  assert.equal(dirname(config.dir),resolve('.agentbrake-local'));assert.match(basename(config.dir),/^product-verify-access-[a-f0-9]{8}$/);
  await rm(config.dir,{recursive:true,force:true});
 }
});
