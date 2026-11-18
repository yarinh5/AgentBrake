import { createPrivateKey, createPublicKey, createHash, sign, verify } from 'node:crypto';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSafeFile, writeExclusiveFile } from './enterprise-operations.mjs';
const sha256 = data => createHash('sha256').update(data).digest('hex');
function claims(version,sourceHash) {
  if(typeof version!=='string'||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)||version.length>100) throw Error('Invalid expected version');
  if(typeof sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(sourceHash)) throw Error('Invalid expected source hash');
}
function keyId(key) { return sha256(createPublicKey(key.type==='public'?key.export({type:'spki',format:'pem'}):key).export({type:'spki',format:'der'})); }
function canonical(payload) {
  return Buffer.from(JSON.stringify({schema:1,type:'agentbrake-release-attestation',algorithm:'Ed25519',keyId:payload.keyId,version:payload.version,sourceHash:payload.sourceHash,subject:{name:payload.subject.name,bytes:payload.subject.bytes,sha256:payload.subject.sha256}}));
}
async function subject(file) {const bytes=await readSafeFile(file,512*1024*1024);return {name:basename(file),bytes:bytes.length,sha256:sha256(bytes)};}
export async function signArchive({archiveFile,privateKeyFile,version,sourceHash,attestationFile}) {
  claims(version,sourceHash);
  const bytes=await readSafeFile(privateKeyFile,16384);let key;
  try {key=createPrivateKey(bytes);}finally {bytes.fill(0);}
  if(key.asymmetricKeyType!=='ed25519') throw Error('Signing key must be Ed25519');
  const payload={schema:1,type:'agentbrake-release-attestation',algorithm:'Ed25519',keyId:keyId(key),version,sourceHash,subject:await subject(archiveFile)};
  const signature=sign(null,canonical(payload),key).toString('base64');
  await writeExclusiveFile(attestationFile,JSON.stringify({payload,signature},null,2)+'\n');
  return {attestationFile:resolve(attestationFile),keyId:payload.keyId,subject:payload.subject,version,sourceHash};
}
export async function verifyArchive({archiveFile,publicKeyFile,attestationFile,expectedVersion,expectedSourceHash}) {
  claims(expectedVersion,expectedSourceHash);
  const key=createPublicKey(await readSafeFile(publicKeyFile,16384));
  if(key.asymmetricKeyType!=='ed25519') throw Error('Verification key must be Ed25519');
  const doc=JSON.parse((await readSafeFile(attestationFile,16384)).toString('utf8')), p=doc.payload;
  if(!p||Object.keys(doc).sort().join()!=='payload,signature'||Object.keys(p).sort().join()!=='algorithm,keyId,schema,sourceHash,subject,type,version'||p.schema!==1||p.type!=='agentbrake-release-attestation'||p.algorithm!=='Ed25519'||!p.subject||Object.keys(p.subject).sort().join()!=='bytes,name,sha256'||typeof doc.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(doc.signature)) throw Error('Invalid attestation format');
  if(p.keyId!==keyId(key)) throw Error('Untrusted signing key');
  if(!verify(null,canonical(p),key,Buffer.from(doc.signature,'base64'))) throw Error('Invalid attestation signature');
  if(p.version!==expectedVersion) throw Error('Release version mismatch');
  if(p.sourceHash!==expectedSourceHash) throw Error('Release source hash mismatch');
  const actual=await subject(archiveFile);
  if(p.subject.name!==actual.name||p.subject.bytes!==actual.bytes||p.subject.sha256!==actual.sha256) throw Error('Archive subject digest mismatch');
  return {verified:true,keyId:p.keyId,version:p.version,sourceHash:p.sourceHash,subject:actual};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command,configFile]=process.argv.slice(2),actions={sign:signArchive,verify:verifyArchive};
    if(!Object.hasOwn(actions,command)||!configFile||process.argv.length!==4) throw Error('Usage: enterprise-signing.mjs <sign|verify> <config.json>');
    console.log(JSON.stringify(await actions[command](JSON.parse((await readSafeFile(configFile,65536)).toString('utf8'))),null,2));
  }catch{console.error('Release attestation failed; check trusted key, expected release claims and artifact integrity.');process.exitCode=1;}
}
