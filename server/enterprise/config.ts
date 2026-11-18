import {z} from 'zod';
import {validateEnterpriseIdentityConfig} from '../security/enterprise-identity.js';
const endpoint=z.string().url().max(2048).refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&u.href===value;});
const auditSchema=z.object({endpoint,bearerToken:z.string().min(32).max(256).regex(/^[^\s]+$/),batchSize:z.number().int().min(1).max(100).default(100),timeoutMs:z.number().int().min(100).max(10000).default(5000),intervalMs:z.number().int().min(1000).max(3600000).default(5000)}).strict();
export function validateEnterpriseServices(input:unknown){
  const parsed=z.object({identity:z.unknown().optional(),audit:auditSchema.optional()}).strict().parse(input);
  const identity=parsed.identity===undefined?undefined:validateEnterpriseIdentityConfig(parsed.identity);
  if(identity?.testOnlyAllowLoopbackHttp)throw Error('Testing identity transport cannot be deployed');
  if(!identity&&!parsed.audit)throw Error('At least one enterprise service required');
  return {identity,audit:parsed.audit};
}
export type EnterpriseServices=ReturnType<typeof validateEnterpriseServices>;
export function enterpriseRoutes(config:EnterpriseServices){return [
  ...(config.identity?[{method:'POST',url:config.identity.tokenEndpoint},{method:'GET',url:config.identity.jwksUri}]:[]),
  ...(config.audit?[{method:'POST',url:config.audit.endpoint}]:[]),
];}
export function enterpriseTransport(routes:ReturnType<typeof enterpriseRoutes>,transport:typeof fetch=fetch):typeof fetch{
  return async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    const method=init?.method??(input instanceof Request?input.method:'GET');
    const index=routes.findIndex(r=>r.url===url&&r.method===method);
    if(index<0 || input instanceof Request)throw Error('Unconfigured enterprise transport request');
    return transport(new URL('/route/'+index,'http://enterprise-egress:8080'),{...init,redirect:'error'});
  };
}
