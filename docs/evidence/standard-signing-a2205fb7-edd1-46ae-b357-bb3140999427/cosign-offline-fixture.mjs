import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const meta=JSON.parse(await readFile('/inputs/metadata.json','utf8'));
assert.equal(hash(await readFile('/inputs/archive.tar.gz')),meta.archiveSha256);
assert.equal(hash(await readFile('/tools/cosign')),meta.toolSha256);
const password=randomBytes(32).toString('hex');
const report={startedAt:new Date().toISOString(),...meta,result:'IN_PROGRESS',commands:[],scope:'Offline Cosign3.1.4 synthetic-key verification and SLSA-v1-format local assembly attestation. No organizational identity, public transparency, trusted CI builder, reproducible-build or SLSA level claim. Private keys exist only in disposable container tmpfs.'};
function run(label,args,positive=true){
  const r=spawnSync('/tools/cosign',args,{cwd:'/tmp',encoding:'utf8',env:{PATH:process.env.PATH,HOME:'/tmp',COSIGN_PASSWORD:password},timeout:30000});
  const output=(r.stdout??'')+(r.stderr??'');assert.ok(!output.includes(password));
  report.commands.push({label,args,exitCode:r.status,expected:positive?'zero':'nonzero'});
  return writeFile('/out/'+label+'.log',output).then(()=>{if(positive)assert.equal(r.status,0,label+': '+output);else {assert.notEqual(r.status,null);assert.notEqual(r.status,0,label+' must reject');}return output;});
}
try{
  await run('version',['version']);
  await run('config',['signing-config','create','--out','/out/signing-config.json']);
  const config=JSON.parse(await readFile('/out/signing-config.json','utf8'));
  for(const key of ['caUrls','oidcUrls','rekorTlogUrls','tsaUrls'])assert.equal((config[key]??[]).length,0);
  await run('generate',['generate-key-pair','--output-key-prefix','/tmp/fixture']);
  await copyFile('/tmp/fixture.pub','/out/fixture.pub');
  report.publicKeySha256=hash(await readFile('/out/fixture.pub'));
  const common=['--key','/tmp/fixture.key','--signing-config','/out/signing-config.json','--oidc-disable-ambient-providers','--yes'];
  await run('sign',['sign-blob',...common,'--bundle','/out/archive.sigstore.json','/inputs/archive.tar.gz']);
  const verify=(bundle,key,file)=>['verify-blob','--bundle',bundle,'--key',key,'--insecure-ignore-tlog',file];
  await run('verify',verify('/out/archive.sigstore.json','/out/fixture.pub','/inputs/archive.tar.gz'));
  const tampered=Buffer.from(await readFile('/inputs/archive.tar.gz'));tampered[0]^=1;await writeFile('/tmp/tampered.tar.gz',tampered);
  await run('reject-tampered',verify('/out/archive.sigstore.json','/out/fixture.pub','/tmp/tampered.tar.gz'),false);
  await run('generate-other',['generate-key-pair','--output-key-prefix','/tmp/other']);
  await copyFile('/tmp/other.pub','/out/other.pub');
  await run('reject-wrong-key',verify('/out/archive.sigstore.json','/out/other.pub','/inputs/archive.tar.gz'),false);
  await run('reject-missing-bundle',verify('/tmp/missing.json','/out/fixture.pub','/inputs/archive.tar.gz'),false);
  const bundle=JSON.parse(await readFile('/out/archive.sigstore.json','utf8'));bundle.messageSignature.signature='AA==';await writeFile('/out/tampered.sigstore.json',JSON.stringify(bundle));
  await run('reject-tampered-signature',verify('/out/tampered.sigstore.json','/out/fixture.pub','/inputs/archive.tar.gz'),false);
  await run('attest',['attest-blob',...common,'--predicate','/inputs/provenance.json','--type','slsaprovenance1','--bundle','/out/provenance.sigstore.json','/inputs/archive.tar.gz']);
  const verifyAtt=(file,type='slsaprovenance1')=>['verify-blob-attestation','--key','/out/fixture.pub','--bundle','/out/provenance.sigstore.json','--type',type,'--insecure-ignore-tlog',file];
  await run('verify-attestation',verifyAtt('/inputs/archive.tar.gz'));
  await run('reject-wrong-subject',verifyAtt('/tmp/tampered.tar.gz'),false);
  await run('reject-wrong-predicate',verifyAtt('/inputs/archive.tar.gz','spdxjson'),false);
  const att=JSON.parse(await readFile('/out/provenance.sigstore.json','utf8'));
  const statement=JSON.parse(Buffer.from(att.dsseEnvelope.payload,'base64').toString('utf8'));
  assert.equal(statement.predicateType,'https://slsa.dev/provenance/v1');
  assert.equal(statement.subject[0].digest.sha256,meta.archiveSha256);
  assert.deepEqual(statement.predicate,JSON.parse(await readFile('/inputs/provenance.json','utf8')));
  await writeFile('/out/provenance.statement.json',JSON.stringify(statement,null,2));
  report.result='PASS_SCOPED_OFFLINE_STANDARD_SIGNING';
}catch(error){report.result='FAIL';report.error=error.message;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile('/out/summary.json',JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,error:report.error,checks:report.commands.length}));}
