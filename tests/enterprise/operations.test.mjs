import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink, stat, utimes } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { encryptBackup, decryptBackup } from '../../scripts/backup-format.mjs';
const ops = await import('../../scripts/enterprise-operations.mjs').catch(e => { if(e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
async function fixture(t) {
  await mkdir(resolve('.agentbrake-local'),{recursive:true,mode:0o700});
  const root = await mkdtemp(resolve('.agentbrake-local/enterprise-ops-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const sourceFile=join(root,'source.abk'), keyFile=join(root,'recovery-key'), destinationDirectory=join(root,'destination');
  await mkdir(destinationDirectory,{mode:0o700});
  const key=randomBytes(32), value={format:'agentbrake-cold-backup',schema:1,id:'12345678-1234-1234-1234-123456789abc',createdAt:new Date().toISOString(),files:{secret:'synthetic-secret'},volumes:{}};
  await writeFile(keyFile,key,{mode:0o600}); await writeFile(sourceFile,encryptBackup(value,key),{mode:0o600});
  return {root,sourceFile,keyFile,destinationDirectory,key,value};
}
test('encrypted copy preserves recoverable content, verifies checksum and refuses overwrite', async t=>{
  assert.equal(typeof ops.copyEncryptedBackup,'function'); const f=await fixture(t);
  const result=await ops.copyEncryptedBackup(f), bytes=await readFile(result.file);
  assert.deepEqual(decryptBackup(bytes,f.key),f.value);
  assert.equal(result.sha256,createHash('sha256').update(await readFile(f.sourceFile)).digest('hex'));
  assert.equal(result.verified,true); assert.equal(JSON.stringify(result).includes('synthetic-secret'),false);
  await assert.rejects(ops.copyEncryptedBackup(f),/exist|collision/i);
  assert.deepEqual(await readFile(result.file),bytes);
  if(process.platform!=='win32') assert.equal((await stat(result.file)).mode & 0o777,0o600);
  await writeFile(result.file,Buffer.from('corrupt'));
  await assert.rejects(ops.verifyEncryptedBackup({file:result.file,keyFile:f.keyFile,expectedSha256:result.sha256}),/checksum/i);
  await writeFile(result.file,bytes);
  assert.equal((await ops.verifyEncryptedBackup({file:result.file,keyFile:f.keyFile,expectedSha256:result.sha256})).verified,true);
});
test('corrupt source and wrong recovery key never create destination files', async t=>{
  assert.equal(typeof ops.copyEncryptedBackup,'function'); const f=await fixture(t);
  await writeFile(f.keyFile,randomBytes(32)); await assert.rejects(ops.copyEncryptedBackup(f),/authentication/i);
  await writeFile(f.sourceFile,'plaintext'); await assert.rejects(ops.copyEncryptedBackup(f),/envelope/i);
  assert.deepEqual(await readdir(f.destinationDirectory),[]);
});
test('destination junction ancestors and source symlinks are refused',async t=>{
  assert.equal(typeof ops.copyEncryptedBackup,'function');const f=await fixture(t), link=join(f.root,'link');
  await symlink(f.destinationDirectory,link,process.platform==='win32'?'junction':'dir');
  await assert.rejects(ops.copyEncryptedBackup({...f,destinationDirectory:link}),/link/i);
  await mkdir(join(f.destinationDirectory,'nested'),{mode:0o700});
  await assert.rejects(ops.copyEncryptedBackup({...f,destinationDirectory:join(link,'nested')}),/link/i);
  await assert.rejects(ops.copyEncryptedBackup({...f,sourceFile:join(link,'missing.abk')}),/link/i);
});
test('retention is a bounded preview and never removes files',async t=>{
  assert.equal(typeof ops.previewRetention,'function');const f=await fixture(t);
  for(let i=0;i<3;i++){const p=join(f.destinationDirectory,`${i}.abk`);await writeFile(p,'encrypted');await utimes(p,100+i,100+i);}
  await writeFile(join(f.destinationDirectory,'unrelated.txt'),'keep');
  const before=await readdir(f.destinationDirectory), result=await ops.previewRetention({directory:f.destinationDirectory,keep:1});
  assert.deepEqual(result.candidates.map(x=>x.name),['1.abk','0.abk']);assert.equal(result.previewOnly,true);
  assert.deepEqual(await readdir(f.destinationDirectory),before);
  await assert.rejects(ops.previewRetention({directory:f.destinationDirectory,keep:1,maxEntries:2}),/limit/i);
});
test('fresh health distinguishes unavailable, low disk, stale backup, certificate warning and UNKNOWN',async t=>{
  assert.equal(typeof ops.collectHealth,'function');const f=await fixture(t);
  const server=createServer((req,res)=>{res.writeHead(req.url==='/ok'?200:503);res.end();});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const config={healthUrl:base+'/ok',allowLoopbackHttp:true,diskPath:f.root,backupFile:f.sourceFile,keyFile:f.keyFile,minFreeBytes:0};
  const start=Date.now(), good=await ops.collectHealth(config);
  assert.equal(good.checks.availability.status,'OK');assert.equal(good.checks.disk.status,'OK');assert.equal(good.checks.backup.status,'OK');assert.equal(good.checks.certificate.status,'UNKNOWN');assert.equal(good.status,'UNKNOWN');assert.ok(Date.parse(good.checkedAt)>=start);
  const bad=await ops.collectHealth({...config,healthUrl:base+'/bad',minFreeBytes:Number.MAX_SAFE_INTEGER,maxBackupAgeMs:0});
  assert.equal(bad.checks.availability.status,'CRITICAL');assert.equal(bad.checks.disk.status,'CRITICAL');assert.equal(bad.checks.backup.status,'CRITICAL');assert.equal(bad.status,'CRITICAL');
  assert.equal((await ops.collectHealth({})).status,'UNKNOWN');
  await assert.rejects(ops.collectHealth({...config,allowLoopbackHttp:false}),/HTTPS/i);
  const certificateFile=join(f.root,'cert.pem');
  execFileSync(process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',join(f.root,'tls-key.pem'),'-out',certificateFile],{stdio:'ignore',windowsHide:true});
  assert.equal((await ops.collectHealth({...config,certificateFile})).checks.certificate.status,'WARNING');
  const fresh=await ops.collectHealth({...config,certificateFile,certificateWarningDays:0});assert.equal(fresh.status,'OK');
  execFileSync(process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl',['x509','-in',certificateFile,'-signkey',join(f.root,'tls-key.pem'),'-days','-1','-out',join(f.root,'expired.pem')],{stdio:'ignore',windowsHide:true});
  assert.equal((await ops.collectHealth({...config,certificateFile:join(f.root,'expired.pem')})).checks.certificate.status,'CRITICAL');
  await writeFile(f.sourceFile,'corrupt');assert.equal((await ops.collectHealth(config)).checks.backup.status,'CRITICAL');
});
test('systemd templates remain inert and reject directive injection',()=>{
  assert.equal(typeof ops.systemdTemplates,'function');
  const input={nodePath:'/usr/bin/node',workspacePath:'/opt/agentbrake',configFile:'/etc/agentbrake/health.json',user:'agentbrake'};
  const result=ops.systemdTemplates(input);assert.equal(typeof result.service,'string');assert.equal(typeof result.timer,'string');
  assert.throws(()=>ops.systemdTemplates({...input,configFile:'/tmp/x\nExecStart=/bin/evil'}),/invalid/i);
  assert.throws(()=>ops.systemdTemplates({...input,workspacePath:'/opt/%h'}),/invalid/i);
});
test('availability rejects redirects, enforces deadline and CLI makes UNKNOWN actionable',async t=>{
  const f=await fixture(t);let redirected=0;
  const server=createServer((req,res)=>{
    if(req.url==='/hang')return;
    if(req.url==='/redirect'){res.writeHead(302,{location:'/secret'});res.end();return;}
    redirected++;res.end('secret');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['/hang','/redirect']) {
    const report=await ops.collectHealth({healthUrl:base+path,allowLoopbackHttp:true,timeoutMs:50});
    assert.equal(report.checks.availability.status,'CRITICAL');
  }
  assert.equal(redirected,0);
  const config=join(f.root,'config.json');await writeFile(config,'{}');
  const result=spawnSync(process.execPath,['scripts/enterprise-operations.mjs','health',config],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,2);assert.equal(JSON.parse(result.stdout).status,'UNKNOWN');
  await writeFile(config,JSON.stringify({sourceFile:'synthetic-secret-missing-path',keyFile:f.keyFile,destinationDirectory:f.destinationDirectory}));
  const failure=spawnSync(process.execPath,['scripts/enterprise-operations.mjs','copy',config],{encoding:'utf8',windowsHide:true});
  assert.equal(failure.status,1);assert.equal(failure.stderr.includes('synthetic-secret'),false);
});
