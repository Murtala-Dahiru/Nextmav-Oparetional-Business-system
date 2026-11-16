import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(join(tmpdir(),'nextmav-browser/node_modules/playwright/index.mjs')).href);
const base=process.env.APP_URL ?? 'http://localhost:3000';
const fixture=JSON.parse(readFileSync(process.env.FINANCE_TEST_SESSION ?? join(tmpdir(),'nextmav-retirement-governance-fixture.json')));
const browser=await chromium.launch({channel:'msedge'});
mkdirSync('docs/financial-chart-evidence',{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.setDefaultNavigationTimeout(180000);
 page.setDefaultTimeout(60000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error' && !m.text().includes('500 (Internal Server Error)')) errors.push(m.text())});
 assert.ok((await page.request.post(base+'/api/auth/login',{data:{email:fixture.email,password:fixture.password}})).ok());
 const response=await page.request.get(base+'/api/dashboard');assert.equal(response.status(),200);
 const original=await response.json();assert.ok(original.data.finance);
 const f=original.data.finance;
 assert.equal(f.revenue,f.revenueByMonth.reduce((s,m)=>s+m.revenue,0));
 assert.equal(f.totalExpenses,f.revenueByMonth.reduce((s,m)=>s+m.expenses,0));
 assert.equal(f.revenueThisMonth,f.revenueByMonth.at(-1).revenue);
 console.log('PASS authenticated API totals reconcile with monthly history and current-month KPI');
 // Browser-only fixtures: no writes to business records. Screenshots explicitly labelled.
 let state='populated';
 await page.route('**/api/dashboard', async route=>{
  if(state==='error')return route.fulfill({status:500,json:{error:'Financial chart test: service unavailable'}});
  const body=structuredClone(original);const finance=body.data.finance;
  finance.revenueByMonth=finance.revenueByMonth.map((m,i)=>({...m,revenue:2000+i*750,expenses:900+i*125,invoiced:3000+i*900}));
  if(state==='zero')finance.revenueByMonth=finance.revenueByMonth.map(m=>({...m,revenue:0,expenses:0,invoiced:0}));
  if(state==='empty')finance.revenueByMonth=[];
  if(state==='partial')finance.revenueByMonth=finance.revenueByMonth.slice(-1);
  if(state==='edge')finance.revenueByMonth=finance.revenueByMonth.map((m,i)=>({...m,revenue:i%2?-0.25:1500000000,expenses:i%2?-1200:0.05,invoiced:0}));
  if(state==='unavailable'){delete body.data.finance;body.data.unavailable=['Financial intelligence'];}
  if(state==='loading')await new Promise(r=>setTimeout(r,2000));
  await route.fulfill({json:body});
 });
 const section=page.getByRole('region',{name:'Financial performance: payment receipts, issued invoices and approved expenses'});
 const chart=section.locator('.cc-finance-chart');
 const open=async()=>{await page.goto(base+'/dashboard');await section.waitFor({timeout:90000});};
 await open();
 for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:1000});
  for(const range of ['3','6','12']){
   await page.getByLabel('Financial reporting window').selectOption(range);
   for(const mode of ['Bars','Trend','Bars','Trend']){
    await section.getByRole('button',{name:mode,exact:true}).click();
    assert.equal(await section.getByRole('button',{name:mode,exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await page.getByLabel('Financial reporting window').inputValue(),range);
    if(mode==='Bars')assert.equal(await chart.locator('.recharts-bar-rectangle path').count(),Number(range)*3);
    else {assert.equal(await chart.locator('.recharts-line-curve').count(),2);assert.equal(await chart.locator('.recharts-area-curve').count(),1);}
   }
  }
  assert.ok(await section.evaluate(e=>e.scrollWidth<=e.clientWidth),`section overflow ${width}`);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`page overflow ${width}`);
  for(const mode of ['Bars','Trend']){
   await section.getByRole('button',{name:mode,exact:true}).click();await chart.scrollIntoViewIfNeeded();
   const box=await chart.boundingBox();assert.ok(box.width>100 && box.height>=250);
   await page.mouse.move(box.x+box.width*.55,box.y+box.height*.5);
   await section.locator('.recharts-tooltip-wrapper').waitFor({state:'visible'});
   const tip=section.locator('.recharts-tooltip-wrapper');
   const tipText=await tip.innerText();assert.match(tipText,/Collected/);assert.match(tipText,/₦/);
   const month=f.revenueByMonth.findIndex(m=>tipText.split('\n')[0].toLowerCase().includes(m.month.toLowerCase()));assert.ok(month>=0);
   assert.ok(tipText.includes(new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(2000+month*750)),tipText);
   await page.mouse.move(0,0);
   if(width!==768){
    await section.evaluate(e=>{const p=document.createElement('p');p.dataset.testLabel='true';p.textContent='TEST FIXTURE · browser-only financial data';p.style.cssText='font:12px sans-serif;color:#64748b;padding:8px';e.prepend(p)});
    await section.screenshot({path:`docs/financial-chart-evidence/${mode.toLowerCase()}-${width}.png`});
    await section.locator('[data-test-label]').evaluate(e=>e.remove());
   }
  }
  console.log('PASS repeated switching, 3/6/12 months, tooltips, resizing, no overflow at '+width);
 }
 for(const value of ['zero','empty','partial','edge']){
  state=value;await open();
  if(value==='empty')await section.getByText(/No financial periods available/).waitFor();
  else for(const mode of ['Bars','Trend']){
   await section.getByRole('button',{name:mode,exact:true}).click();
   assert.ok(await chart.locator(mode==='Bars'?'.recharts-bar':'.recharts-area-dot').count()>0);
   assert.equal(await chart.locator('[d*="NaN"]').count(),0);
  }
  console.log('PASS '+value+' state');
 }
 state='loading';await page.goto(base+'/dashboard');await page.getByText('Loading Executive Overview',{exact:true}).waitFor();await section.waitFor();console.log('PASS loading skeleton resolves to financial chart');
 state='unavailable';await page.goto(base+'/dashboard');await page.getByText(/Some intelligence is unavailable/).waitFor();
 state='error';await page.goto(base+'/dashboard');await page.getByText(/The request came back empty.|Financial chart test: service unavailable|couldn’t|could not/i).first().waitFor({timeout:30000});
 assert.deepEqual(errors,[]);console.log('PASS API unavailable/error states and no unexpected console/runtime errors');
}finally{await browser.close()}

