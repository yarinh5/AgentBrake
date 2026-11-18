import test from 'node:test';
import assert from 'node:assert/strict';
import { controlProxy } from '../../apps/dashboard/lib/control-proxy.js';

const origin = 'https://enterprise.example';
const request = (path: string, method = 'GET', headers: Record<string,string> = {}, body?: string) =>
  new Request(origin + '/api/' + path, { method, headers: { host: 'enterprise.example', ...headers }, body });
test('OIDC callback forwards only relative root redirect and both secure cookies without following redirect', async () => {
  let seen: RequestInit | undefined;
  const transport: typeof fetch = async (_url, init) => { seen = init; return new Response(null, { status: 303, headers: {location:'/', 'set-cookie':'ab_session=synthetic; Path=/api; Secure; HttpOnly; SameSite=Strict'} }); };
  const result = await controlProxy(request('enterprise/oidc/callback?code=synthetic&state=bound'), ['enterprise','oidc','callback'], 'http://control-api:4314', transport, origin);
  assert.equal(result.status, 303);
  assert.equal(result.headers.get('location'), '/');
  assert.equal(seen?.redirect, 'manual');
  assert.match(result.headers.get('set-cookie') ?? '', /Secure/);
  for (const location of ['https://attacker.invalid/', '//attacker.invalid', '/other']) {
    const bad = await controlProxy(request('enterprise/oidc/callback'), ['enterprise','oidc','callback'], 'http://control-api:4314', async()=>new Response(null,{status:303,headers:{location}}), origin);
    assert.equal(bad.status, 502);
  }
});
test('SCIM machine transport passes bearer and conditional version without accepting cross-origin browser mutation', async () => {
  let forwarded: Headers | undefined;
  const transport: typeof fetch = async (_url, init) => {forwarded = new Headers(init?.headers); return Response.json({id:'synthetic'});};
  const headers = { authorization:'Bearer synthetic-service-credential-0123456789', 'content-type':'application/scim+json', 'if-match':'W/"4"' };
  const result = await controlProxy(request('scim/v2/Users/u1', 'PATCH', headers, '{}'), ['scim','v2','Users','u1'], 'http://control-api:4314', transport, origin);
  assert.equal(result.status, 200);
  assert.equal(forwarded?.get('authorization'), headers.authorization);
  assert.equal(forwarded?.get('if-match'), headers['if-match']);
  assert.equal(forwarded?.get('cookie'), null);
  const bad = await controlProxy(request('scim/v2/Users/u1', 'PATCH', {...headers,origin:'https://attacker.invalid'}, '{}'), ['scim','v2','Users','u1'], 'http://control-api:4314', transport, origin);
  assert.equal(bad.status, 403);
});
test('SCIM credentials are not forwarded to browser API and origin rules stay strict', async () => {
  let forwarded: Headers | undefined;
  const transport: typeof fetch = async (_url, init) => {forwarded = new Headers(init?.headers); return Response.json({enabled:true});};
  const result=await controlProxy(request('enterprise/auth','GET',{authorization:'Bearer synthetic-service-credential'}),['enterprise','auth'],'http://control-api:4314',transport,origin);
  assert.equal(result.status,200); assert.equal(forwarded?.get('authorization'),null);
  const start=await controlProxy(request('enterprise/oidc/start','POST',{'content-type':'application/json'},'{}'),['enterprise','oidc','start'],'http://control-api:4314',transport,origin);
  assert.equal(start.status,403);
});
