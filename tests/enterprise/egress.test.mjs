import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../../infra/product/enterprise-egress.mjs').catch(() => ({}));
test('enterprise egress exposes only exact numbered HTTPS routes, never request-selected destinations', async t => {
  assert.equal(typeof module.createEnterpriseEgress, 'function', 'fixed enterprise egress is required');
  let calls = 0;
  const server = module.createEnterpriseEgress({routes:[{method:'POST',url:'https://idp.example/token'}]}, async(url,init)=>{
    calls++; assert.equal(String(url),'https://idp.example/token'); assert.equal(init.redirect,'error');
    assert.equal(new Headers(init.headers).get('cookie'),null); return Response.json({ok:true});
  }).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port;
  for(const path of ['/route/1','/route/0?target=https://evil.invalid','/token','/https://evil.invalid'])assert.equal((await fetch(base+path,{method:'POST'})).status,403);
  assert.equal((await fetch(base+'/route/0')).status,403);assert.equal(calls,0);
  assert.equal((await fetch(base+'/route/0',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',cookie:'synthetic-secret'},body:'code=synthetic'})).status,200);
  assert.equal(calls,1);
});
test('enterprise egress rejects unsafe config, redirects and oversized replies', async t=>{
  assert.equal(typeof module.createEnterpriseEgress,'function');
  for(const url of ['http://example.com/token','https://user:pass@example.com/token','https://example.com/token#fragment'])assert.throws(()=>module.createEnterpriseEgress({routes:[{method:'POST',url}]}));
  let result=Response.redirect('https://evil.invalid',302);
  const server=module.createEnterpriseEgress({routes:[{method:'GET',url:'https://idp.example/jwks'}]},async()=>result).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port+'/route/0';
  assert.equal((await fetch(base)).status,502);
  result=new Response('x'.repeat(128001)); assert.equal((await fetch(base)).status,502);
});
