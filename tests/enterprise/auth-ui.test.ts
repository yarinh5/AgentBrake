import test from 'node:test';import assert from 'node:assert/strict';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {AuthPanel} from '../../src/components/AuthPanel.js';
import {TeamPanel,SettingsPanel} from '../../src/components/AccountPanels.js';
const render=(enterprise?:unknown,initialized=true)=>renderToStaticMarkup(createElement(AuthPanel,{setup:{managed:true,initialized,...(enterprise?{enterprise}:{})},landing:null,onSession:async()=>{},onReset:()=>{},retry:()=>{},initialError:''} as any));
test('enterprise sign-in has an SSO action and does not show ordinary local-password fallback',()=>{
  const html=render({enabled:true,providerLabel:'Company sign-in',breakGlassEnabled:false});
  assert.match(html,/Continue with Company sign-in/);assert.doesNotMatch(html,/id="auth-password"|id="auth-email"/);
});
test('emergency local login is an explicit secondary choice, never automatically exposed',()=>{
  const html=render({enabled:true,providerLabel:'Company sign-in',breakGlassEnabled:true});
  assert.match(html,/Emergency local sign-in/);assert.doesNotMatch(html,/id="auth-password"/);
  assert.match(render(),/id="auth-password"/);
});
test('misconfigured uninitialized enterprise install cannot offer bootstrap that server disables',()=>{
  const html=render({enabled:true,providerLabel:'Company sign-in',breakGlassEnabled:false},false);
  assert.match(html,/Initialize managed accounts before enabling/);assert.doesNotMatch(html,/id="auth-key"/);
});
test('enterprise team and password screens direct changes to organization identity management',()=>{
  const team=renderToStaticMarkup(createElement(TeamPanel,{managedExternally:true} as any));
  assert.ok(team.includes('managed by your organization'));assert.ok(!team.includes('Create invitation'));
  const settings=renderToStaticMarkup(createElement(SettingsPanel,{passwordManagedExternally:true,onSignedOut:()=>{},onProfile:async()=>{}} as any));
  assert.ok(settings.includes('password and verification methods'));
});
