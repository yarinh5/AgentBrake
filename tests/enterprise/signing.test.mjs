import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const signing = await import('../../scripts/enterprise-signing.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND') return {}; throw e;});
async function fixture(t){
 await mkdir(resolve('.agentbrake-local'),{recursive:true,mode:0o700});
 const root=await mkdtemp(resolve('.agentbrake-local/enterprise-sign-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const archiveFile=join(root,'release.tar.gz'),privateKeyFile=join(root,'private.pem'),publicKeyFile=join(root,'public.pem'),attestationFile=join(root,'release.attestation.json');
 const pair=generateKeyPairSync('ed25519');await writeFile(privateKeyFile,pair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});await writeFile(publicKeyFile,pair.publicKey.export({type:'spki',format:'pem'}));await writeFile(archiveFile,'synthetic archive bytes');
 return {root,archiveFile,privateKeyFile,publicKeyFile,attestationFile,version:'0.3.0-rc.1',sourceHash:'a'.repeat(64),expectedVersion:'0.3.0-rc.1',expectedSourceHash:'a'.repeat(64)};
}
test('attestation binds archive digest, source, version and trusted key without bundling keys',async t=>{
 assert.equal(typeof signing.signArchive,'function');const f=await fixture(t);const result=await signing.signArchive(f);
 assert.equal((await signing.verifyArchive(f)).verified,true);
 const text=await readFile(f.attestationFile,'utf8');assert.equal(text.includes('PRIVATE KEY'),false);assert.equal(text.includes('PUBLIC KEY'),false);assert.equal(JSON.stringify(result).includes('private.pem'),false);
 await assert.rejects(signing.signArchive(f),/exist/i);
 await assert.rejects(signing.verifyArchive({...f,expectedSourceHash:'b'.repeat(64)}),/source/i);
 await assert.rejects(signing.verifyArchive({...f,expectedVersion:'0.4.0'}),/version/i);
 await writeFile(f.archiveFile,'tampered archive');await assert.rejects(signing.verifyArchive(f),/digest|subject/i);
});
test('CLI signs and verifies a real tar archive and returns failure on modified signature',async t=>{
 const f=await fixture(t), stage=join(f.root,'stage');await mkdir(stage);await writeFile(join(stage,'RELEASE.json'),JSON.stringify({version:f.version,sourceHash:f.sourceHash}));
 execFileSync('tar',['-czf',f.archiveFile,'-C',stage,'.'],{stdio:'pipe',windowsHide:true});
 const config=join(f.root,'config.json');await writeFile(config,JSON.stringify(f));
 const run=command=>spawnSync(process.execPath,['scripts/enterprise-signing.mjs',command,config],{encoding:'utf8',windowsHide:true});
 assert.equal(run('sign').status,0);const success=run('verify');assert.equal(success.status,0);assert.equal(JSON.parse(success.stdout).verified,true);
 const doc=JSON.parse(await readFile(f.attestationFile,'utf8'));const signature=Buffer.from(doc.signature,'base64');signature[0]^=1;doc.signature=signature.toString('base64');await writeFile(f.attestationFile,JSON.stringify(doc));
 const failure=run('verify');assert.equal(failure.status,1);assert.equal(failure.stdout,'');assert.equal(failure.stderr.includes('private.pem'),false);
});
test('payload edits, untrusted rotation, invalid algorithm and missing expected claims fail closed',async t=>{
 assert.equal(typeof signing.signArchive,'function');const f=await fixture(t);await signing.signArchive(f);
 const original=await readFile(f.attestationFile,'utf8'), doc=JSON.parse(original);doc.payload.version='0.4.0';await writeFile(f.attestationFile,JSON.stringify(doc));
 await assert.rejects(signing.verifyArchive({...f,expectedVersion:'0.4.0'}),/signature/i);await writeFile(f.attestationFile,original);
 const pair=generateKeyPairSync('ed25519');await writeFile(f.publicKeyFile,pair.publicKey.export({type:'spki',format:'pem'}));await assert.rejects(signing.verifyArchive(f),/key|signature/i);
 await writeFile(f.privateKeyFile,pair.privateKey.export({type:'pkcs8',format:'pem'}));const rotated=join(f.root,'rotated.json');await signing.signArchive({...f,attestationFile:rotated});assert.equal((await signing.verifyArchive({...f,attestationFile:rotated})).verified,true);
 await assert.rejects(signing.verifyArchive({...f,expectedVersion:undefined}),/version/i);
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048});await writeFile(f.privateKeyFile,rsa.privateKey.export({type:'pkcs8',format:'pem'}));await assert.rejects(signing.signArchive({...f,attestationFile:join(f.root,'rsa.json')}),/Ed25519/i);
});
