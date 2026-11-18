import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../../server/app.js';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

test('frozen benign and hostile content cases preserve output disclosure boundaries', async () => {
  const cases=JSON.parse(await readFile(new URL('./credential-marker-cases.json',import.meta.url),'utf8')).cases;
  const s=createApp({databasePath:':memory:',adminKey:'marker-holdout-fixture-0000000000000'});
  const {agent}=s.store.createAgent({name:'Disclosure holdout',tools:['database_read'],resources:['customers'],sandbox:true});
  try {
    for(const item of cases) {
      s.gateway.connectors.execute=async()=>item.value;
      const a=await s.gateway.submit(agent.id,{requestId:randomUUID(),tool:'database_read',arguments:{limit:1}});
      assert.equal(a.status,'allowed',item.id);
      assert.equal(a.resultDisclosure,item.expectedSensitive?'withheld':'released',item.id);
      if(item.expectedSensitive) assert.equal(a.result,undefined,item.id);
    }
  } finally {await s.close();}
});

test('public-marker classification accepts only the complete literal, never credential suffixes', async () => {
  const s=createApp({databasePath:':memory:',adminKey:'marker-boundary-fixture-000000000000'});
  const {agent}=s.store.createAgent({name:'Marker boundary',tools:['github_create_issue'],resources:['agentbrake/sandbox'],sandbox:true});
  try {
    for(const suffix of [',opaque-suffix',';opaque-suffix',')opaque-suffix',']opaque-suffix','}opaque-suffix',"'opaque-suffix",'\\nopaque-suffix','\\topaque-suffix','X','\u200bopaque-suffix']) {
      const result=await s.gateway.evaluate(agent,'github_create_issue',{repo:'agentbrake/sandbox',title:'Synthetic',body:'password=example-only-placeholder'+suffix});
      assert.equal(result.status,'blocked',JSON.stringify(suffix));
      assert.equal(result.rule,'secret-protection');
    }
    for(const body of ['password=example-only-placeholder','PASSWORD=example-only-placeholder\nDocumentation', 'api_key=example-only-placeholder\r\nDocumentation']) {
      assert.equal((await s.gateway.evaluate(agent,'github_create_issue',{repo:'agentbrake/sandbox',title:'Synthetic',body})).status,'pending');
    }
  } finally {await s.close();}
});
