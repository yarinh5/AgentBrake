// Trusted control-plane egress only. The agent network is never attached.
// Configuration contains endpoints, never credentials. No request chooses a URL.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function createEnterpriseEgress(config, transport = fetch) {
  if (!Array.isArray(config?.routes) || config.routes.length < 1 || config.routes.length > 3) throw Error('Invalid enterprise routes');
  const routes = config.routes.map(route => {
    const url = new URL(route.url);
    if (!['GET','POST'].includes(route.method) || url.protocol !== 'https:' || url.username || url.password || url.hash || route.url !== url.href) throw Error('Invalid enterprise route');
    return {url: url.href, method: route.method};
  });
  const server = createServer({maxHeaderSize:16384}, async(req,res) => {
    const fail = status => {if(res.headersSent)return res.destroy();res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close'});res.end('{"error":"Enterprise egress refused"}');};
    const match = /^\/route\/([0-2])$/.exec(req.url ?? ''), route = match ? routes[Number(match[1])] : undefined;
    if(!route || route.method !== req.method)return fail(403);
    if(Number(req.headers['content-length'] ?? 0)>524288)return fail(413);
    try {
      let length=0;const chunks=[];
      for await(const chunk of req){length+=chunk.length;if(length>524288)return fail(413);chunks.push(chunk);}
      if(route.method==='GET' && length)return fail(403);
      const headers = new Headers({Accept:'application/json'});
      for(const name of ['authorization','content-type'])if(req.headers[name])headers.set(name,req.headers[name]);
      const upstream=await transport(route.url,{method:route.method,headers,...(route.method==='POST'?{body:Buffer.concat(chunks)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});
      if(upstream.status>=300 && upstream.status<400){await upstream.body?.cancel();return fail(502);}
      const reader=upstream.body?.getReader(), output=[];let size=0;
      if(reader)try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>128000){await reader.cancel();return fail(502);}output.push(part.value);}}finally{reader.releaseLock();}
      res.writeHead(upstream.status,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(upstream.ok?Buffer.concat(output):'{"error":"Enterprise upstream request failed"}');
    }catch{fail(502);}
  });
  server.maxConnections=32;server.headersTimeout=10000;server.requestTimeout=15000;server.keepAliveTimeout=5000;
  server.on('connect',(_req,socket)=>socket.destroy());server.on('upgrade',(_req,socket)=>socket.destroy());
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const server=createEnterpriseEgress(JSON.parse(await readFile('/run/config/enterprise-egress.json','utf8')));
  server.listen(8080,'0.0.0.0');process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
}
