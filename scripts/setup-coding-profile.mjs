// Operator-only offline model metadata preparation. Inference remains read-only.
import {spawn} from 'node:child_process';
import {readFile,access,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {verifyModelCache} from './verify-model-cache.mjs';
import {codingModelManifestPath,verifyCodingModelCache} from './coding-model-profile.mjs';
const cache=resolve('.tools/ollama-models'),config=resolve('.agentbrake-local/docker-public');
const lock=JSON.parse(await readFile('infra/local/codex.lock.json','utf8'));
const profile=JSON.parse(await readFile('infra/local/coding-model-profile.json','utf8'));
await verifyModelCache(cache,lock.model.expectedRegistryManifestSha256);
const exists=await access(codingModelManifestPath(cache,profile)).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
if(exists) {
  console.log(JSON.stringify(await verifyCodingModelCache(cache,profile)));
} else {
  await mkdir(config,{recursive:true});
  const prefix=['--config',config,...(process.platform==='win32'?['--host','npipe:////./pipe/docker_engine']:[])];
  const name='agentbrake-coding-setup-'+randomUUID().slice(0,8);
  const docker=args=>new Promise((res,rej)=>{
    let tail='';const p=spawn('docker',[...prefix,...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>{p.kill();rej(Error('Offline coding setup deadline'));},60000);
    for(const pipe of [p.stdout,p.stderr])pipe.on('data',b=>{tail=(tail+b).slice(-4000);});
    p.on('error',e=>{clearTimeout(timer);rej(e);});p.on('exit',code=>{clearTimeout(timer);code===0?res(tail):rej(Error('Offline coding setup failed: '+tail));});
  });
  try {
    await docker(['run','-d','--pull=never','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','512m','--pids-limit','128','--tmpfs','/tmp:size=64m,mode=1777','--mount','type=bind,src='+cache+',dst=/models','--mount','type=bind,src='+resolve('infra/local/coding.Modelfile')+',dst=/tmp/Coding.Modelfile,readonly','-e','HOME=/tmp','-e','OLLAMA_MODELS=/models','-e','OLLAMA_NO_CLOUD=1',lock.ollama.image,'serve']);
    let ready=false;
    for(let attempt=0;attempt<10;attempt++) {try{await docker(['exec',name,'ollama','list']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}
    if(!ready)throw Error('Offline model preparation did not become ready');
    await docker(['exec',name,'ollama','create',profile.name,'-f','/tmp/Coding.Modelfile']);
    await verifyModelCache(cache,lock.model.expectedRegistryManifestSha256);
    console.log(JSON.stringify(await verifyCodingModelCache(cache,profile)));
  } finally {await docker(['rm','--force',name]);}
}
