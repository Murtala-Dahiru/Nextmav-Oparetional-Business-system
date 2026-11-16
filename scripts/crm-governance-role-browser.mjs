import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(join(tmpdir(),'nextmav-browser/node_modules/playwright/index.mjs')).href);
const fixture=JSON.parse(readFileSync(join(tmpdir(),'nextmav-governance-fixture.json'),'utf8'));
const base=process.env.APP_URL||'http://localhost:3037';
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});context.setDefaultTimeout(90000);
let passed=0;
const check=(ok,label)=>{assert.ok(ok,label);console.log('PASS '+label);passed++};
async function api(path){const r=await context.request.get(base+path);assert.ok(r.ok());return (await r.json()).data;}
try {
 const login=await context.request.post(base+'/api/auth/login',{data:{email:fixture.email,password:fixture.password}});assert.ok(login.ok());
 const page=await context.newPage();await page.goto(base+'/dashboard',{waitUntil:'domcontentloaded',timeout:180000});
 await page.getByRole('button',{name:'Customers & revenue',exact:true}).click();
 await page.getByRole('button',{name:'Leads',exact:true}).click();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Organization & permissions',exact:true}).click();
 await page.getByRole('tab',{name:'Users',exact:true}).click();
 const users=await api('/api/admin/users');const member=users.find(u=>u.email.startsWith('governance-readonly-'));assert.ok(member?.memberId);
 const row=page.getByRole('row').filter({hasText:member.email});
 await row.getByRole('button').last().click();await page.getByRole('menuitem',{name:'Edit',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.locator('#u-role').click();
 await page.getByRole('option',{name:/Sales Staff|Sales Representative/}).first().click();
 await dialog.getByRole('button',{name:'Save Changes'}).click();await dialog.waitFor({state:'hidden'});
 const updated=await api('/api/admin/users/'+member.memberId);check(updated.role==='sales_staff','Owner changes synthetic member role through BOS user-management UI');
 await row.getByRole('button').last().click();await page.getByRole('menuitem',{name:'Edit',exact:true}).click();
 await dialog.locator('#u-role').click();await page.getByRole('option',{name:'Support Staff',exact:true}).click();await dialog.getByRole('button',{name:'Save Changes'}).click();await dialog.waitFor({state:'hidden'});
 check((await api('/api/admin/users/'+member.memberId)).role==='support_staff','Read-only role restored through UI');
 const events=await api('/api/admin/audit-log');check(events.some(e=>JSON.stringify(e).includes(member.memberId)),'Membership change appears in BOS audit history');
 console.log(`${passed} role browser checks passed.`);
}finally{await browser.close();}
