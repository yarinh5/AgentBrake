import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyCodingModelCache} from '../../scripts/coding-model-profile.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t, parameters={temperature:0,seed:42,num_predict:2048}) {
  const dir=await mkdtemp(join(tmpdir(),'agentbrake-coding-profile-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(join(dir,'blobs'));
  const put=async(type,value)=>{const bytes=Buffer.from(value);const digest=hash(bytes);await writeFile(join(dir,'blobs','sha256-'+digest),bytes);return {mediaType:type,digest:'sha256:'+digest,size:bytes.length};};
  const config=await put('application/vnd.docker.container.image.v1+json','{}');
  const model=await put('application/vnd.ollama.image.model','synthetic model bytes');
  const params=await put('application/vnd.ollama.image.params',JSON.stringify(parameters));
  const manifest=Buffer.from(JSON.stringify({schemaVersion:2,config,layers:[model,params]}));
  const manifestDir=join(dir,'manifests-v2/ollama.com/library/test-coding');await mkdir(manifestDir,{recursive:true});
  await writeFile(join(manifestDir,'latest'),manifest);
  return {dir,params,lock:{name:'test-coding:latest',manifestSha256:hash(manifest),weightsSha256:model.digest.slice(7),parameters:{temperature:0,seed:42,num_predict:2048}}};
}
test('coding model requires pinned bytes and exact bounded sampling',async t=>{
  const f=await fixture(t);const proof=await verifyCodingModelCache(f.dir,f.lock);
  assert.equal(proof.manifestSha256,f.lock.manifestSha256);assert.deepEqual(proof.parameters,f.lock.parameters);
});
test('modified sampling bytes fail before inference',async t=>{
  const f=await fixture(t);await writeFile(join(f.dir,'blobs',f.params.digest.replace(':','-')),'{}');
  await assert.rejects(verifyCodingModelCache(f.dir,f.lock),/integrity/);
});
test('a rehashed alias cannot silently change the accepted sampling contract',async t=>{
  const f=await fixture(t,{temperature:0.7,seed:42,num_predict:2048});
  await assert.rejects(verifyCodingModelCache(f.dir,f.lock),/sampling/);
});
test('missing aliases and unsafe model names fail closed',async t=>{
  const f=await fixture(t);await assert.rejects(verifyCodingModelCache(f.dir,{...f.lock,name:'../escape:latest'}),/name/);
  await assert.rejects(verifyCodingModelCache(f.dir,{...f.lock,name:'missing:latest'}),/ENOENT/);
});
