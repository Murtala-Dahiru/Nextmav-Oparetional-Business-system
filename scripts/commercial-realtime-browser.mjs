import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(join(tmpdir(),'nextmav-browser/node_modules/playwright/index.mjs')).href);
const f=JSON.parse(readFileSync(join(tmpdir(),'nextmav-commercial-fixture.json'))),base=process.env.APP_URL||'http://localhost:3012';
const browser=await chromium.launch({channel:'msedge',headless:true});let passed=0;function check(ok,label){assert.ok(ok,label);console.log('PASS '+label);passed++;}
try{const context=await browser.newContext({viewport:{width:1440,height:1000}});assert.equal((await context.request.post(base+'/api/auth/login',{data:{email:f.email,password:f.password}})).status(),200);const page=await context.newPage();await page.goto(base+'/dashboard');await page.getByRole('button',{name:'Customers & revenue',exact:true}).click();await page.getByRole('navigation',{name:'CRM sections'}).getByRole('button',{name:'Commercial Hub',exact:true}).click();await page.getByText('Live updates connected',{exact:true}).waitFor({timeout:60000});await page.getByRole('button',{name:'Quotes & pricing',exact:true}).click();
const src=(await (await context.request.get(base+`/api/crm/commercial/${f.quoteId}`)).json()).data;
const title='Realtime commercial '+Date.now();const body={id:null,revision:0,kind:'quote',title,companyId:f.companyId,contactId:'',dealId:'',ownerId:f.ownerId,parentId:'',quoteVersionId:'',currency:'USD',issueDate:'2026-10-29',expiresOn:'2027-10-29',effectiveOn:'',content:src.content};
await page.getByLabel('Search commercial records').fill(title);await page.getByText('No commercial records match this view. Create a record or adjust your filters.').waitFor();
const created=await context.request.post(base+'/api/crm/commercial',{data:body});assert.equal(created.status(),200);await page.getByRole('button',{name:title,exact:true}).waitFor({timeout:30000});check(true,'record appears through realtime without manual refresh');
const id=(await created.json()).data.id;await context.setOffline(true);
const cookies=(await context.cookies()).map(c=>`${c.name}=${c.value}`).join('; ');const changed=title+' reconnect';const update=await fetch(base+'/api/crm/commercial',{method:'POST',headers:{cookie:cookies,'Content-Type':'application/json'},body:JSON.stringify({...body,id,revision:1,title:changed})});assert.equal(update.status,200);await context.setOffline(false);await page.getByRole('button',{name:changed,exact:true}).waitFor({timeout:60000});check(true,'reconnect invalidates stale directory and displays missed update');
await page.getByRole('button',{name:changed,exact:true}).click();await page.getByText('Add from product catalog',{exact:true}).click();await page.getByLabel('Search product catalog').waitFor();check(true,'catalog selection is available in quote editor');
await page.getByRole('button',{name:'Commercial Hub',exact:true}).last().click();await page.getByRole('button',{name:'Proposal Studio',exact:true}).click();await page.getByRole('button',{name:'Create proposal',exact:true}).click();await page.getByRole('combobox',{name:'Proposal template',exact:true}).selectOption('IT consulting');await page.getByLabel('Section 1 content',{exact:true}).fill('Reusable commercial template');
const templateName='Browser reusable '+Date.now();page.once('dialog',d=>d.accept(templateName));await page.getByRole('button',{name:'Save sections as template',exact:true}).click();await page.getByText('Reusable template saved.').waitFor({timeout:30000});check(true,'browser saves edited proposal as reusable organization template');
page.once('dialog',d=>d.accept());await page.getByRole('combobox',{name:'Organization proposal template',exact:true}).selectOption({label:templateName+' · v1'}); // Confirmation handled below only when it appears.
console.log(`${passed} realtime/template browser assertions passed.`);
}finally{await browser.close();}
