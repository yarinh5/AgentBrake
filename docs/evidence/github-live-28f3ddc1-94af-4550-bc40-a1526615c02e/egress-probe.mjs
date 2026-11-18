// Validation-only observer around the unchanged fixed-route production egress.
// Credentials stay in process memory; output is method/path/status only.
import {createGitHubEgress} from '/app/infra/product/github-egress.mjs';
import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile('/run/config/github-app.json','utf8'));
const tokens=new Set();let sequence=0;
const server=createGitHubEgress(config,async(url,options)=>{
 const response=await fetch(url,options);
 if(new URL(url).pathname===`/app/installations/${config.installationId}/access_tokens`&&response.ok){const minted=await response.clone().json();if(typeof minted.token==='string')tokens.add(minted.token);}
 console.log(JSON.stringify({kind:'outbound',sequence:++sequence,method:options.method,path:new URL(url).pathname,status:response.status,githubRequestId:response.headers.get('x-github-request-id')}));
 return response;
});
server.listen(8080,'0.0.0.0');
process.on('SIGTERM',async()=>{
 server.closeAllConnections();server.close();
 for(const token of tokens){let status=0;try{const r=await fetch('https://api.github.com/installation/token',{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(6000),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});status=r.status;await r.body?.cancel();}catch{}console.log(JSON.stringify({kind:'revocation',status,ok:status===204}));}
 tokens.clear();process.exit(0);
});
