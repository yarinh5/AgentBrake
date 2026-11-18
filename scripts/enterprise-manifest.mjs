import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
const schema=z.object({schema:z.literal(1),installationId:z.string().uuid(),identity:z.boolean(),audit:z.boolean(),configHash:z.string().regex(/^[a-f0-9]{64}$/),egressHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export async function loadEnterprise(config){
  const path=join(config.dir,'enterprise-manifest.json');
  let stat;try{stat=await lstat(path);}catch(e){if(e.code==='ENOENT')return undefined;throw e;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)throw Error('Invalid enterprise manifest');
  const manifest=schema.parse(JSON.parse(await readFile(path,'utf8')));
  if(config.name==='local'||manifest.installationId!==config.id||!config.candidate?.httpsOrigin)throw Error('Enterprise requires its dedicated HTTPS installation');
  for(const [file,expected] of [['enterprise.json',manifest.configHash],['enterprise-egress.json',manifest.egressHash]]){
    const info=await lstat(join(config.dir,file));if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>65536)throw Error('Invalid enterprise config file');
    if(createHash('sha256').update(await readFile(join(config.dir,file))).digest('hex')!==expected)throw Error('Enterprise configuration changed; staged reconfiguration required');
  }
  return manifest;
}
