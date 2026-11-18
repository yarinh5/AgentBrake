import {readFile,lstat} from 'node:fs/promises';
import {configureEnterprise} from './enterprise-config.js';
// @ts-expect-error Existing Node ESM product lifecycle.
import {productConfig,composeProduct} from './product.mjs';
const [name,file]=process.argv.slice(2);
if(!name||!file)throw Error('Usage: node --import tsx scripts/configure-enterprise.ts <dedicated-installation> <configuration-file>');
const config=await productConfig(name);
if((await composeProduct(config,['ps','--status','running','--quiet'],{capture:true})).trim())throw Error('Stop the dedicated installation before changing identity configuration');
const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw Error('Invalid bounded enterprise configuration file');
await configureEnterprise(config,JSON.parse(await readFile(file,'utf8')));
console.log('Enterprise configuration prepared; no service started or external request sent. Existing managed account bootstrap is required.');
