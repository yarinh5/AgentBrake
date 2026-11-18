import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

export function codingModelManifestPath(cache, profile) {
  assert.match(profile.name,/^[a-z][a-z0-9-]*:[a-z0-9-]+$/,'Invalid coding model name');
  const [name,tag]=profile.name.split(':');
  return join(cache,'manifests-v2/ollama.com/library',name,tag);
}
export async function verifyCodingModelCache(cache, profile) {
  const bytes=await readFile(codingModelManifestPath(cache,profile));
  const hash=b=>createHash('sha256').update(b).digest('hex');
  assert.equal(hash(bytes),profile.manifestSha256,'Coding manifest integrity mismatch');
  const manifest=JSON.parse(bytes);
  const model=manifest.layers.filter(l=>l.mediaType==='application/vnd.ollama.image.model');
  const params=manifest.layers.filter(l=>l.mediaType==='application/vnd.ollama.image.params');
  assert.equal(model.length,1);assert.equal(params.length,1);
  assert.equal(model[0].digest,'sha256:'+profile.weightsSha256,'Coding weights mismatch');
  for(const blob of [manifest.config,...manifest.layers]) {
    assert.match(blob.digest,/^sha256:[a-f0-9]{64}$/);
    const digest=createHash('sha256');let size=0;
    for await(const chunk of createReadStream(join(cache,'blobs',blob.digest.replace(':','-')))){digest.update(chunk);size+=chunk.length;}
    assert.equal(size,blob.size,'Coding blob size integrity mismatch');
    assert.equal(digest.digest('hex'),blob.digest.slice(7),'Coding blob integrity mismatch');
  }
  const parameters=JSON.parse(await readFile(join(cache,'blobs',params[0].digest.replace(':','-')),'utf8'));
  assert.deepEqual(parameters,profile.parameters,'Coding sampling contract mismatch');
  return {name:profile.name,manifestSha256:profile.manifestSha256,weightsSha256:profile.weightsSha256,parameters};
}
