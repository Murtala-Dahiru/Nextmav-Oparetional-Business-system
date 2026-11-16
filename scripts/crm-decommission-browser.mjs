import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const base=process.env.APP_URL;
assert.ok(base && process.env.CRM_AUDIT_FIXTURE,'Set APP_URL and CRM_AUDIT_FIXTURE to an isolated owner session');
const fixture=JSON.parse(readFileSync(process.env.CRM_AUDIT_FIXTURE));
const { chromium }=await import(pathToFileURL(join(tmpdir(),'nextmav-browser/node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({channel:'msedge'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];
  const pending=new Set();
  page.on('request', request=>{
    if(new URL(request.url()).pathname.startsWith('/api/crm/')) pending.add(request);
  });
  page.on('requestfinished', request=>pending.delete(request));
  page.on('requestfailed', request=>pending.delete(request));
  const evidence=process.env.CRM_SCREENSHOT_DIR;
  if(evidence)mkdirSync(evidence,{recursive:true});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{
    const path=new URL(r.url()).pathname;
    if(path.startsWith('/api/crm/engagement') || (path.startsWith('/api/crm/') && r.status()>=400)) errors.push(path+' '+r.status());
  });
  const login=await page.request.post(base+'/api/auth/login',{data:{email:fixture.email,password:fixture.password}});
  assert.ok(login.ok());
  for(const path of ['','/actions','/history','/templates','/templates/preview','/sequences','/mailboxes','/mailboxes/connect','/mailboxes/callback','/mailboxes/messages','/mailboxes/associate']){
    const url=base+'/api/crm/engagement'+path;
    for(const method of ['GET','POST']){
      const r=await page.request.fetch(url,{method,maxRedirects:0});
      assert.equal(r.status(),404,method+' '+path);
    }
  }
  console.log('PASS authenticated GET and POST on all eleven former endpoints return 404');
  await page.goto(base+'/dashboard');
  await page.getByRole('button',{name:'Customers & revenue',exact:true}).click();
  const nav=page.getByRole('navigation',{name:'CRM sections'});
  await nav.waitFor();
  const select=nav.locator('select');
  await select.locator('option').first().waitFor({state:'attached'});
  const options=await select.locator('option').evaluateAll(nodes=>nodes.map(n=>({id:n.value,label:n.textContent})));
  assert.equal(options.length,12);assert.ok(!options.some(o=>o.id==='engagement'));
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    for(const {id,label} of options.filter(option=>!process.env.CRM_SCREENSHOT_SECTION || option.id===process.env.CRM_SCREENSHOT_SECTION)){
      if(await select.isVisible())await select.selectOption(id);
      else {
        const button=nav.getByRole('button',{name:label,exact:true});
        if(await button.isVisible())await button.click();
        else {await nav.getByRole('button',{name:'More CRM destinations'}).click();await page.getByRole('menuitem',{name:label,exact:true}).click();}
      }
      await page.waitForTimeout(500);
      const deadline=Date.now()+180000;
      while(pending.size && Date.now()<deadline) await page.waitForTimeout(250);
      assert.equal(pending.size,0,`CRM requests settled for ${id}`);
      await page.waitForTimeout(500);
      if(id==='commercial') await page.getByText('Loading authorized commercial data…',{exact:true}).waitFor({state:'hidden',timeout:180000});
      assert.equal(await select.inputValue(),id);
      assert.ok(await nav.evaluate(el=>el.scrollWidth<=el.clientWidth));
      if(evidence)await page.screenshot({path:join(evidence,id+'-'+width+'.png'),animations:'disabled'});
      if(id==='commercial' && !process.env.CRM_SCREENSHOT_SECTION){
        await page.getByRole('button',{name:'NextMav Sign',exact:true}).click();
        await page.getByRole('heading',{name:'NextMav Sign',exact:true}).waitFor();
      }
    }
    console.log('PASS '+(process.env.CRM_SCREENSHOT_SECTION || 'all twelve destinations and signing workspace')+' at '+width);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS no browser runtime errors or requests to retired endpoints');
}finally{await browser.close()}
