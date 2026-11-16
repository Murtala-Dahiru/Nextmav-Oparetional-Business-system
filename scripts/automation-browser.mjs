import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { connect, readEnv } from './db-connect.mjs';
const { chromium } = await import(pathToFileURL(join(tmpdir(),'nextmav-browser/node_modules/playwright/index.mjs')).href);
const fixture=JSON.parse(readFileSync(join(tmpdir(),'nextmav-automation-fixture.json')));
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
const context=await browser.newContext({viewport:{width:1440,height:1000}});
// Start with a clean browser context. Reusing old idle-clock cookies would expire
// the new login on its first navigation even though its auth token is fresh.
const login=await context.request.post('http://localhost:3010/api/auth/login',{data:{email:fixture.email,password:fixture.password}});
assert.equal(login.status(),200,'fresh isolated acceptance session');
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let passed=0;function check(value,label){assert.ok(value,label);console.log('PASS '+label);passed++;}
await page.goto('http://localhost:3010/dashboard',{waitUntil:'domcontentloaded',timeout:180000});
await page.getByRole('button',{name:'Customers & revenue',exact:true}).click({timeout:90000});
await page.getByRole('navigation',{name:'CRM sections'}).waitFor({timeout:90000});
const destination=page.getByRole('combobox',{name:'CRM destination'});
if(await destination.isVisible()) await destination.selectOption('automations');
else await page.getByRole('button',{name:'Automation',exact:true}).click();
await page.getByRole('heading',{name:'Automation Studio',exact:true}).waitFor({timeout:60000});
await page.getByText('Loading current data…').waitFor({state:'hidden',timeout:60000});
mkdirSync('docs/automation-evidence',{recursive:true});
await page.getByText('Live updates connected').waitFor({timeout:60000});
await page.screenshot({path:'docs/automation-evidence/desktop-directory.png',fullPage:true});
check(true,'directory displays actual records and live connection');
await page.getByRole('button',{name:'Create automation',exact:true}).click();
const name='Browser acceptance '+Date.now();
await page.getByLabel('Automation name',{exact:true}).fill(name);
await page.getByLabel('Description',{exact:true}).last().fill('Browser-created follow-up');
await page.getByRole('button',{name:'Add condition group',exact:true}).click();
await page.getByRole('button',{name:'Add condition',exact:true}).click();
await page.getByLabel('Condition 1.1 value',{exact:true}).fill('manual');
await page.getByRole('button',{name:'Add action',exact:true}).click();
await page.getByLabel('Action 2',{exact:true}).selectOption('wait');
await page.getByRole('button',{name:'Move step 2 up',exact:true}).click();
check(await page.getByLabel('Action 1',{exact:true}).inputValue()==='wait','keyboard-accessible action reorder works');
await page.getByRole('button',{name:'Remove step 1',exact:true}).click();
await page.screenshot({path:'docs/automation-evidence/desktop-editor.png',fullPage:true});
await page.getByRole('button',{name:'Save draft',exact:true}).click();
await page.getByText('Draft saved. Any published version remains unchanged.').waitFor({timeout:30000});
await page.getByRole('button',{name:'← Automation Studio',exact:true}).click();
await page.getByLabel('Search automations').fill(name);
await page.getByRole('button',{name,exact:true}).click();
check(await page.getByLabel('Condition 1.1 value',{exact:true}).inputValue()==='manual','browser save and reopen preserves conditions');
await page.getByRole('button',{name:'Publish',exact:true}).click();
await page.getByText('Published. New events use this version; existing runs retain their original version.').waitFor({timeout:30000});
check(true,'browser publishes valid workflow');
for(const [width,device] of [[768,'tablet'],[390,'mobile']]) {
 await page.setViewportSize({width,height:1000});
 await page.screenshot({path:`docs/automation-evidence/${device}-editor.png`,fullPage:true});
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${device} editor has no document horizontal overflow`);
}
await page.getByRole('button',{name:'← Automation Studio',exact:true}).click();
await page.getByLabel('Search automations').fill(name);
for(const [width,device] of [[768,'tablet'],[390,'mobile']]) {
 await page.setViewportSize({width,height:1000});
 await page.screenshot({path:`docs/automation-evidence/${device}-directory.png`,fullPage:true});
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${device} directory has no document horizontal overflow`);
}
await page.setViewportSize({width:1440,height:1000});
await page.getByRole('button',{name:'Pause',exact:true}).click();
await page.getByRole('button',{name:'Resume',exact:true}).waitFor({timeout:30000});
await page.getByRole('button',{name:'Resume',exact:true}).click();
await page.getByRole('button',{name:'Pause',exact:true}).waitFor({timeout:30000});
check(true,'pause and resume work in browser');
const event=await context.request.post('http://localhost:3010/api/crm/leads',{data:{firstName:'Browser realtime',source:'manual'}});assert.equal(event.status(),201);
const {client}=await connect(readEnv('DIRECT_URL')||readEnv('DATABASE_URL'),{statement_timeout:20000});
await client.query('select crm_automation_worker(100,$1)',[fixture.orgId]);await client.end();
await page.getByText(/1 executions/).waitFor({timeout:30000});
check(true,'realtime refresh shows new execution without manual reload');
await page.getByRole('button',{name:'Runs',exact:true}).click();
await page.locator('summary').filter({hasText:name}).first().click();
await page.getByText('Immutable version',{exact:false}).waitFor({timeout:30000});
check(await page.getByRole('button',{name:'Open trigger record'}).isVisible(),'execution detail exposes step history and record navigation');
await page.screenshot({path:'docs/automation-evidence/desktop-execution.png',fullPage:true});
await page.getByRole('button',{name:'Template gallery',exact:true}).click();
check(await page.getByRole('button',{name:'Use template',exact:true}).count()===11,'eleven supported templates visible');
await page.screenshot({path:'docs/automation-evidence/templates.png',fullPage:true});
await page.getByRole('button',{name:'Create automation',exact:true}).click();
await page.getByLabel('Automation name',{exact:true}).fill('Unsaved navigation test');
page.once('dialog',dialog=>dialog.dismiss());
if(await destination.isVisible()) await destination.selectOption('leads');else await page.getByRole('button',{name:'Leads',exact:true}).click();
check(await page.getByRole('heading',{name:'Workflow editor',exact:true}).isVisible(),'cancelled navigation preserves unsaved workflow');
page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'← Automation Studio',exact:true}).click();
check(errors.length===0,`no browser runtime errors (${errors.join(';')})`);
console.log(`${passed} browser assertions passed. Screenshots require separate visual inspection.`);
} finally { await browser.close(); }
