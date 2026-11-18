// Disposable verification service only. No real IdP or audit sink is contacted.
import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { createHash, generateKeyPairSync, randomUUID, sign, timingSafeEqual } from 'node:crypto';

const config=JSON.parse(await readFile('/run/secrets/enterprise-fixture.json','utf8')) as {clientSecret:string;sinkToken:string;redirectUri:string};
const issuer='https://enterprise-fixture:8443';
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...pair.publicKey.export({format:'jwk'}),kid:'synthetic-key',use:'sig',alg:'RS256'};
const codes=new Map<string,{parameters:URLSearchParams;expiresAt:number}>();
const seen=new Map<string,string>();
let exchanges=0,batches=0,duplicateEvents=0;
const same=(a:string,b:string)=>timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
const server=createServer({cert:await readFile('/run/secrets/fixture-cert.pem'),key:await readFile('/run/secrets/fixture-key.pem'),minVersion:'TLSv1.2',maxHeaderSize:16384},async(req,res)=>{
  const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  try {
    const url=new URL(req.url!,issuer);
    if(req.method==='GET'&&url.pathname==='/health')return json(200,{ok:true});
    if(req.method==='GET'&&url.pathname==='/jwks')return json(200,{keys:[jwk]});
    if(req.method==='GET'&&url.pathname==='/status'){
      if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))return json(403,{error:'Local fixture inspection only'});
      return json(200,{exchanges,batches,duplicateEvents,eventCount:seen.size,events:[...seen].map(([id,type])=>({id,type}))});
    }
    if(req.method==='GET'&&url.pathname==='/authorize'){
      const p=url.searchParams;
      if(p.get('client_id')!=='enterprise-fixture-client'||p.get('redirect_uri')!==config.redirectUri||p.get('response_type')!=='code'||p.get('code_challenge_method')!=='S256'||!p.get('code_challenge')||!p.get('state')||!p.get('nonce'))return json(400,{error:'invalid_request'});
      for(const [code,entry] of codes)if(entry.expiresAt<=Date.now())codes.delete(code);
      if(codes.size>=256)return json(429,{error:'fixture_capacity'});
      const code=randomUUID();codes.set(code,{parameters:p,expiresAt:Date.now()+300000});
      const callback=new URL(config.redirectUri);callback.searchParams.set('code',code);callback.searchParams.set('state',p.get('state')!);
      res.writeHead(302,{Location:callback.href,'Cache-Control':'no-store'});res.end();return;
    }
    if(req.method!=='POST'||!['/token','/sink'].includes(url.pathname))return json(404,{error:'fixture_route'});
    let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>524288)return json(413,{error:'fixture_limit'});chunks.push(Buffer.from(chunk));}
    const raw=Buffer.concat(chunks).toString('utf8');
    if(url.pathname==='/token'){
      const p=new URLSearchParams(raw),entry=codes.get(p.get('code')??'');codes.delete(p.get('code')??'');
      if(!entry||entry.expiresAt<=Date.now()||p.get('client_id')!=='enterprise-fixture-client'||!same(p.get('client_secret')??'',config.clientSecret)||p.get('redirect_uri')!==config.redirectUri||createHash('sha256').update(p.get('code_verifier')??'').digest('base64url')!==entry.parameters.get('code_challenge'))return json(400,{error:'invalid_grant'});
      exchanges++;const now=Math.floor(Date.now()/1000);
      const payload={iss:issuer,aud:'enterprise-fixture-client',sub:'container-person',iat:now,exp:now+300,auth_time:now,nonce:entry.parameters.get('nonce'),acr:'urn:fixture:mfa',amr:['pwd','otp']};
      const content=Buffer.from(JSON.stringify({alg:'RS256',kid:'synthetic-key'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url');
      return json(200,{token_type:'Bearer',access_token:'unused-synthetic-access-token',id_token:content+'.'+sign('RSA-SHA256',Buffer.from(content),pair.privateKey).toString('base64url')});
    }
    if(!same(req.headers.authorization??'','Bearer '+config.sinkToken))return json(401,{error:'sink_credential'});
    const body=JSON.parse(raw);
    if(body.schemaVersion!==1||!Array.isArray(body.events)||!body.events.length||body.events.length>100)return json(400,{error:'sink_schema'});
    for(const event of body.events){
      if(Object.keys(event).sort().join(',')!=='at,id,previousSourceHash,sequence,sourceHash,type'||event.id!==body.installationId+':'+event.sequence||typeof event.type!=='string')return json(400,{error:'sink_event'});
      if(seen.has(event.id))duplicateEvents++;seen.set(event.id,event.type);
    }
    batches++;return json(200,{schemaVersion:1,acceptedEventIds:body.events.map((event:{id:string})=>event.id)});
  }catch{return json(400,{error:'fixture_request'});}
});
server.headersTimeout=10000;server.requestTimeout=15000;server.keepAliveTimeout=2000;server.maxConnections=32;
server.listen(8443,'0.0.0.0');
process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
