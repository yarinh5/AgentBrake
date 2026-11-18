import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import * as vm from 'node:vm';

if(!process.argv.includes('--fixture')) {
  test('Docker deadline retains captured build output for redacted evidence',()=>{
    const child=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(import.meta.url),'--fixture'],{encoding:'utf8',windowsHide:true,timeout:10000});
    assert.equal(child.status,0,child.stdout+child.stderr);
  });
} else {
  const {SourceTextModule,SyntheticModule}=vm;
  const url=new URL('../../scripts/product.mjs',import.meta.url);let killed=0;
  const spawn=()=>{
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
    child.kill=()=>{killed++;queueMicrotask(()=>child.emit('exit',143));return true;};
    queueMicrotask(()=>{child.stdout.emit('data',Buffer.from('synthetic build progress'));child.stderr.emit('data',Buffer.from('synthetic compiler diagnostic'));});
    return child;
  };
  const module=new SourceTextModule(await readFile(url,'utf8'),{initializeImportMeta:meta=>{meta.url=url.href;}});
  await module.link(async specifier=>{
    const values=specifier==='node:child_process'?{spawn}:await import(specifier.startsWith('node:')?specifier:new URL(specifier,url));
    return new SyntheticModule(Object.keys(values),function(){for(const [key,value] of Object.entries(values))this.setExport(key,value);});
  });
  await module.evaluate();
  await assert.rejects(module.namespace.dockerProduct({env:{}},['version'],{capture:true,timeoutMs:20}),error=>{
    assert.match(error.message,/deadline/);assert.equal(error.output,'synthetic build progress');
    assert.equal(error.errorOutput,'synthetic compiler diagnostic');assert.equal(error.timedOut,true);return true;
  });
  assert.equal(killed,1);
}
