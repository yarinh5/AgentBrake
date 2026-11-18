import {readFile,writeFile,lstat,rename,open} from 'node:fs/promises';import {join} from 'node:path';import {createHash,randomUUID} from 'node:crypto';import {z} from 'zod';
import {enterpriseRoutes,validateEnterpriseServices} from '../server/enterprise/config.js';
// @ts-expect-error Shared Node ESM installation loader.
import {loadEnterprise} from './enterprise-manifest.mjs';
export {loadEnterprise};
type Installation={name:string;id:string;dir:string;candidate?:{httpsOrigin?:string}};
export async function configureEnterprise(config:Installation,input:unknown){
  if(config.name==='local'||!config.candidate?.httpsOrigin)throw Error('Use a dedicated HTTPS installation');
  const owner=JSON.parse(await readFile(join(config.dir,'installation.json'),'utf8'));
  const ownerStat=await lstat(join(config.dir,'installation.json'));
  if(!ownerStat.isFile()||ownerStat.isSymbolicLink()||ownerStat.nlink!==1)throw Error('Invalid installation identity file');
  if(owner.name!==config.name||owner.id!==config.id)throw Error('Installation identity mismatch');
  if(owner.enterpriseRequired!==undefined&&owner.enterpriseRequired!==true)throw Error('Invalid enterprise requirement marker');
  if(owner.enterpriseIdentityRequired!==undefined&&(owner.enterpriseIdentityRequired!==true||owner.enterpriseRequired!==true))throw Error('Invalid enterprise identity requirement marker');
  if(await loadEnterprise(config))throw Error('Enterprise is already configured; no in-place authority replacement');
  const parsed=z.object({managedAccountsInitialized:z.literal(true),identity:z.unknown().optional(),audit:z.unknown().optional()}).strict().parse(input);
  const services=validateEnterpriseServices({identity:parsed.identity,audit:parsed.audit});
  if(owner.enterpriseIdentityRequired&&!services.identity)throw Error('Restored SSO requirement cannot be satisfied by audit-only configuration');
  if(services.identity&&new URL(services.identity.redirectUri).origin!==config.candidate.httpsOrigin)throw Error('Identity callback must match installation HTTPS origin');
  const configuration=JSON.stringify(services,null,2),egress=JSON.stringify({routes:enterpriseRoutes(services)},null,2);
  const manifest={schema:1,installationId:config.id,identity:!!services.identity,audit:!!services.audit,configHash:createHash('sha256').update(configuration).digest('hex'),egressHash:createHash('sha256').update(egress).digest('hex')};
  // Persist the nonsecret requirement before authority/config commit. Backup
  // carries it; missing credentials after restore cannot enable local fallback.
  const temporary=join(config.dir,'installation.enterprise-'+randomUUID()+'.tmp');
  const handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(JSON.stringify({...owner,enterpriseRequired:true,...(services.identity?{enterpriseIdentityRequired:true}:{})},null,2));await handle.sync();}finally{await handle.close();}
  await rename(temporary,join(config.dir,'installation.json'));
  if(process.platform!=='win32'){const parent=await open(config.dir,'r');try{await parent.sync();}finally{await parent.close();}}
  // Commit marker last; partial preparation never enables an external route.
  for(const [name,data] of [['enterprise.json',configuration],['enterprise-egress.json',egress],['enterprise-manifest.json',JSON.stringify(manifest,null,2)]])await writeFile(join(config.dir,name),data,{flag:'wx',mode:0o600});
  return manifest;
}
