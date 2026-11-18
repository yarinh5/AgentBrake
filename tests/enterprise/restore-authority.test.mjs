import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir,mkdtemp,rm,stat} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import * as vm from 'node:vm';
import * as product from '../../scripts/product.mjs';
import {root} from '../../scripts/opa-runtime.mjs';
import {encryptBackup,decryptBackup} from '../../scripts/backup-format.mjs';

const scenario=process.argv.find(v=>v.startsWith('--fixture='))?.slice(10);
if(!scenario){
  for(const name of ['enterprise-backup','marked-backup','plain-backup','malformed-marker','malformed-identity-marker','identity-without-enterprise','enterprise-restore','stale-start']) test('backup/restore preserves authentication requirement: '+name,()=>{
    const child=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(import.meta.url),'--fixture='+name],{encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(child.status,0,child.stdout+child.stderr);
  });
}else{
  const parent=resolve(root,'.agentbrake-local');await mkdir(parent,{recursive:true});
  const scratch=await mkdtemp(join(parent,'enterprise-restore-'));
  const name='verify-auth-'+randomUUID().slice(0,8),destination=join(parent,'product-'+name),id=randomUUID(),key=randomBytes(32);
  const files=['session-key','binding-key','bridge-key','opa-token','target-token','observer-token','control-password','control-owner-password','postgres-bootstrap','target-read-password','target-write-password','operators.json'];
  const volumes=['control-data','target-data','git-data'],snapshot=gzipSync(JSON.stringify([])).toString('base64');
  const image=(await product.productImages()).env.POSTGRES_IMAGE;
  const installation={schema:1,id,name:'synthetic-source',port:4310};
  if(scenario==='marked-backup'||scenario==='stale-start'){installation.enterpriseRequired=true;installation.enterpriseIdentityRequired=true;}
  const payload={format:'agentbrake-cold-backup',schema:1,id:randomUUID(),createdAt:new Date().toISOString(),installation,postgresImage:image,files:Object.fromEntries(files.map(n=>[n,Buffer.from(n==='operators.json'?'[]':'synthetic-secret').toString('base64')])),volumes:Object.fromEntries(volumes.map(n=>[n,snapshot]))};
  const config={name:'synthetic-source-'+randomUUID().slice(0,8),dir:scratch,id,project:'synthetic-source-project',env:{POSTGRES_IMAGE:image,NODE_IMAGE:'synthetic'}};
  let artifact;const composeCalls=[];let dockerCalls=0;
  const composeProduct=async(_config,args)=>{composeCalls.push(args);if(args.includes('ps'))return JSON.stringify([{Service:'control-db',State:'stopped'},{Service:'target-db',State:'stopped'}]);return '';};
  const dockerProduct=async(c,args)=>{dockerCalls++;if(args[0]==='volume'&&args[1]==='inspect')return JSON.stringify([{Name:args[2],Labels:{'com.agentbrake.product':id,'com.docker.compose.project':c.project}}]);if(args[0]==='run'){assert.ok(['snapshot','restore'].includes(args.at(-2)));return args.at(-2)==='snapshot'?snapshot:JSON.stringify({restored:0});}return '';};
  try{
    for(const [file,bytes]of Object.entries(payload.files))await writeFile(join(scratch,file),Buffer.from(bytes,'base64'));
    await writeFile(join(scratch,'installation.json'),JSON.stringify(installation));await writeFile(join(scratch,'recovery-key'),key);
    const module=new vm.SourceTextModule(await readFile(join(root,'scripts/product-maintenance.mjs'),'utf8'));
    await module.link(async specifier=>{
      const values=specifier==='./product.mjs'?{...product,composeProduct,dockerProduct}:specifier==='./opa-runtime.mjs'?{root}:await import(specifier.startsWith('node:')?specifier:new URL('../../scripts/'+specifier,import.meta.url));
      return new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);});
    });await module.evaluate();
    const {backupProduct,inspectBackup,restoreProduct,startProduct}=module.namespace;
    if(scenario==='stale-start'){
      await assert.rejects(startProduct(config,{build:false}),/enterprise.*required|enterprise.*re.?provision|enterprise.*configuration/i);
      assert.equal(composeCalls.length,0,'Fresh persisted requirement must block even a config object loaded before enablement');
      await assert.rejects(startProduct({...config,enterprise:{identity:false,audit:true}},{build:false}),/enterprise.*identity/i);
      assert.equal(composeCalls.length,0,'Audit-only configuration cannot satisfy a restored SSO requirement');
      await writeFile(join(scratch,'installation.json'),JSON.stringify({...installation,enterpriseRequired:false}));
      await assert.rejects(startProduct(config,{build:false}),/enterprise.*requirement|enterprise.*marker/i);
      assert.equal(composeCalls.length,0);
    }else if(scenario==='enterprise-backup'||scenario==='marked-backup'||scenario==='plain-backup'){
      const result=await backupProduct({...config,...(scenario==='enterprise-backup'?{enterprise:{schema:1,identity:true}}:{})});artifact=result.file;
      const recovered=decryptBackup(await readFile(artifact),key);
      assert.equal(recovered.installation.enterpriseRequired,scenario==='plain-backup'?undefined:true,'Authenticated backup must retain enterprise requirement even for a legacy enabled manifest');
      assert.equal(recovered.installation.enterpriseIdentityRequired,scenario==='plain-backup'?undefined:true,'Authenticated backup must retain exact SSO requirement');
      assert.equal(recovered.files['enterprise.json'],undefined,'Never implicitly copy enterprise credentials/endpoints');
      assert.equal((await inspectBackup(artifact,join(scratch,'recovery-key'))).installation.enterpriseRequired,recovered.installation.enterpriseRequired);
    }else{
      payload.installation.enterpriseRequired=scenario==='malformed-marker'?false:true;
      payload.installation.enterpriseIdentityRequired=scenario==='malformed-identity-marker'?false:true;
      if(scenario==='identity-without-enterprise')delete payload.installation.enterpriseRequired;
      const file=join(scratch,'backup.abk');await writeFile(file,encryptBackup(payload,key));
      if(['malformed-marker','malformed-identity-marker','identity-without-enterprise'].includes(scenario)){
        await assert.rejects(inspectBackup(file,join(scratch,'recovery-key')),/enterprise.*requirement|enterprise.*marker/i);
        assert.equal(dockerCalls,0);
      }else{
        const result=await restoreProduct(file,join(scratch,'recovery-key'),name,4339);
        assert.equal(result.status,'RESTORED_REQUIRES_ENTERPRISE_CONFIGURATION');
        const restored=JSON.parse(await readFile(join(destination,'installation.json'),'utf8'));
        assert.equal(restored.enterpriseRequired,true);
        assert.equal(restored.enterpriseIdentityRequired,true);
        await assert.rejects(stat(join(destination,'recovery-incomplete.json')),{code:'ENOENT'});
        assert.ok(composeCalls.some(args=>args.includes('infra/product/recovery.ts')),'Recovery authority suspension must run before reporting staged success');
        assert.ok(composeCalls.some(args=>args.includes('stop')),'Restored services must be stopped');
        assert.equal(composeCalls.some(args=>args.includes('up')&&args.includes('--profile')&&args.includes('agent')),false,'Enterprise restore must not auto-start the application');
        const restoredConfig=await product.productConfig(name),count=composeCalls.length;
        await assert.rejects(startProduct(restoredConfig,{build:false}),/enterprise.*required|enterprise.*re.?provision|enterprise.*configuration/i);
        assert.equal(composeCalls.length,count,'Ordinary start remains blocked until enterprise reprovisioning');
      }
    }
  }finally{
    for(const path of [scratch,destination]){assert.equal(dirname(resolve(path)),parent);await rm(path,{recursive:true,force:true});}
    if(artifact){assert.equal(dirname(resolve(artifact)),join(parent,'backups'));assert.ok(basename(artifact).startsWith(config.name+'-'));await rm(artifact);}
  }
}
