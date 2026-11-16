import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {PDFDocument,degrees} from 'pdf-lib';
import sharp from 'sharp';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(join(tmpdir(),'nextmav-browser/node_modules/playwright/index.mjs')).href);
const fixture=JSON.parse(readFileSync(join(tmpdir(),'nextmav-sign-fixture.json')));const base=process.env.APP_URL||'http://localhost:3018';
const browser=await chromium.launch({channel:'msedge',headless:true});let passed=0;const errors=[];
function check(ok,label){assert.ok(ok,label);console.log('PASS '+label);passed++;}
mkdirSync('docs/sign-evidence',{recursive:true});
try{const internal=await browser.newContext({viewport:{width:1440,height:1000}});internal.setDefaultTimeout(90000);const login=await internal.request.post(base+'/api/auth/login',{data:{email:fixture.email,password:fixture.password}});assert.equal(login.status(),200);
const page=await internal.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/dashboard',{waitUntil:'domcontentloaded',timeout:180000});await page.getByRole('button',{name:'Customers & revenue',exact:true}).click({timeout:90000});await page.getByRole('navigation',{name:'CRM sections'}).waitFor({timeout:90000});const select=page.getByRole('combobox',{name:'CRM destination'});if(await select.isVisible())await select.selectOption('commercial');else await page.getByRole('button',{name:'Commercial Hub',exact:true}).click();await page.getByRole('button',{name:'NextMav Sign',exact:true}).click();await page.getByRole('heading',{name:'NextMav Sign',exact:true}).waitFor();check(true,'Commercial Hub contextual navigation opens Sign');await page.screenshot({path:'docs/sign-evidence/internal-overview.png',fullPage:true});
const title="Builder browser "+randomUUID();const doc=await PDFDocument.create();doc.addPage().drawText('Browser acceptance agreement');const rotated=doc.addPage([760,460]);rotated.setRotation(degrees(90));rotated.drawText('Second page - all pages remain accessible');const bytes=Buffer.from(await doc.save());
await page.getByRole('button',{name:'Advanced Send',exact:true}).click();await page.getByLabel('Upload agreement PDF').setInputFiles({name:title+'.pdf',mimeType:'application/pdf',buffer:bytes});await page.getByRole('heading',{name:title,exact:true}).waitFor({timeout:60000}).catch(async err=>{console.log((await page.locator('body').innerText()).slice(-6000));await page.screenshot({path:'docs/sign-evidence/preparation-failure.png',fullPage:true});throw err;});await page.getByRole('button',{name:'recipients',exact:true}).click();await page.getByRole('button',{name:'Add recipient',exact:true}).click();await page.getByLabel('name',{exact:true}).fill('Browser Signer');await page.getByLabel('email',{exact:true}).fill('browser@example.com');await page.getByLabel('verification',{exact:true}).selectOption('possession');await page.getByRole('button',{name:'document',exact:true}).click();await page.getByLabel('Assigned recipient').selectOption({label:'Browser Signer · signer'});await page.getByRole('button',{name:'Signature',exact:true}).click();await page.locator('#pdf-page-1').click({position:{x:100,y:150}});await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('status').filter({hasText:'Changes saved.'}).waitFor();check(await page.getByRole('button',{name:'Signature (required), page 1',exact:true}).count()===1,'browser adds recipient and places required field on PDF page');await page.getByRole('button',{name:'Zoom in',exact:true}).click();check(await page.getByRole('button',{name:'Signature (required), page 1',exact:true}).count()===1,'field remains attached after zoom');const paper=page.locator('#pdf-page-1');let pb=await paper.boundingBox();
for(const [tool,y] of [['Full Name',.3],['Date Signed',.4]]){await page.getByRole('button',{name:tool,exact:true}).click();await paper.click({position:{x:pb.width*.2,y:pb.height*y}});}
await page.getByRole('button',{name:'recipients',exact:true}).click();await page.getByRole('button',{name:'Add recipient',exact:true}).click();await page.getByLabel('name',{exact:true}).nth(1).fill('Browser Witness');await page.getByLabel('role',{exact:true}).nth(1).selectOption('witness');await page.getByLabel('verification',{exact:true}).nth(1).selectOption('possession');await page.getByRole('button',{name:'document',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#pdf-page-1 canvas')?.width>300);pb=await paper.boundingBox();
for(const [tool,y] of [['Witness Name',.5],['Witness Signature',.6],['Witness Date',.7]]){await page.getByRole('button',{name:tool,exact:true}).click();await paper.click({position:{x:pb.width*.2,y:pb.height*y}});}
const witnessField=paper.getByRole('button',{name:'Witness Date (required), page 1'});
await witnessField.focus();await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');
check(await paper.locator('[data-resize]').count()===7,'copy and paste create one independent field');
await page.keyboard.press('Delete');check(await paper.locator('[data-resize]').count()===6,'Delete removes the selected copy');
await page.keyboard.press('Control+z');check(await paper.locator('[data-resize]').count()===7,'undo deletion restores the copy');
await page.keyboard.press('Control+Shift+z');check(await paper.locator('[data-resize]').count()===6,'redo deletion removes the copy');
await page.getByRole('button',{name:'Text',exact:true}).dragTo(paper,{targetPosition:{x:40,y:40}});
const textField=paper.getByRole('button',{name:'Text (required), page 1'});await textField.waitFor();
const originalLeft=await textField.evaluate(el=>el.style.left);
await textField.focus();await page.keyboard.press('Shift+ArrowRight');
const nudged=await textField.evaluate(el=>el.style.left);check(nudged!==originalLeft,'large keyboard nudge moves a dropped field');
await page.keyboard.press('Control+z');check(await textField.evaluate(el=>el.style.left)===originalLeft,'undo moves back');
await page.keyboard.press('Control+y');check(await textField.evaluate(el=>el.style.left)===nudged,'redo restores movement');
await page.getByLabel('Recipient',{exact:true}).selectOption({label:'Browser Signer · signer'});
await page.getByLabel('Required',{exact:true}).uncheck();await page.getByLabel('Font size (pt)').fill('16');
await page.getByRole('button',{name:'Remove field'}).click();
await witnessField.click();
check(await page.locator('[data-resize]').count()===6,'sender independently places six customer and witness fields');await page.getByRole('button',{name:'Duplicate field',exact:true}).click();check(await page.locator('[data-resize]').count()===7,'selected field duplicates');await page.getByRole('button',{name:'Remove field',exact:true}).click();check(await page.locator('[data-resize]').count()===6,'deletion removes only chosen field');await page.route('**/api/sign/*',async route=>{
 const request=route.request();
 if(request.method()==='POST'&&request.postDataJSON()?.operation==='save'){
  await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test save unavailable'})});
 }else await route.continue();
});
await page.getByRole('button',{name:'Save draft',exact:true}).click();
await page.getByRole('alert').filter({hasText:'Test save unavailable'}).waitFor();
assert.equal(await page.locator('[data-resize]').count(),6);
await page.unroute('**/api/sign/*');
check(true,'failed save leaves six editable fields available for retry');
await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('status').filter({hasText:'Changes saved.'}).waitFor();
for(const width of [1440,768,390]){await page.setViewportSize({width,height:1000});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'preparation fits '+width);await page.screenshot({path:'docs/sign-evidence/customization-editor-'+width+'.png',fullPage:true});}await page.setViewportSize({width:1440,height:1000});
await page.screenshot({path:'docs/sign-evidence/internal-preparation.png',fullPage:true});
const matches=await (await internal.request.get(base+'/api/sign?search='+encodeURIComponent(title))).json();
let prepared=matches.data.find(row=>row.title===title);
assert.ok(prepared);const savedFields=prepared.data.fields;assert.equal(savedFields.length,6);
await page.reload({waitUntil:'domcontentloaded'});
await page.getByRole('button',{name:'Customers & revenue',exact:true}).click();
const destination=page.getByRole('combobox',{name:'CRM destination'});
if(await destination.isVisible())await destination.selectOption('commercial');else await page.getByRole('button',{name:'Commercial Hub',exact:true}).click();
await page.getByRole('button',{name:'NextMav Sign',exact:true}).click();
await page.getByRole('button',{name:'Agreements',exact:true}).click();await page.getByLabel('Search agreements').fill(title);
await page.getByRole('button',{name:title,exact:true}).click();
await page.locator('#pdf-page-1 canvas').waitFor();
assert.equal(await page.locator('#pdf-page-1 [data-resize]').count(),6);
await page.getByRole('button',{name:'Preview as recipient'}).click();
await page.getByLabel('Assigned recipient').selectOption({label:'Browser Witness · witness'});
assert.equal(await page.locator('#pdf-page-1 button').count(),3);
assert.equal(await page.locator('#pdf-page-1 [data-resize]').count(),0);
await page.getByRole('button',{name:'Exit recipient preview'}).click();
check(true,'reopening saved agreement restores all six overlays and witness preview shows three read-only fields');
const reopened=await (await internal.request.get(base+'/api/sign/'+prepared.id)).json();
assert.deepEqual(reopened.data.data.fields,savedFields);
check(true,'fresh request after browser reload returns identical editor fields and recipient assignments');
async function operatePrepared(operation,extra={}){
 const response=await internal.request.post(base+'/api/sign/'+prepared.id,{data:{operation,revision:prepared.revision,...extra}});
 assert.equal(response.status(),200,(await response.text()).slice(0,180));const result=await response.json();prepared=result.data;return result;
}
await operatePrepared('send');
for(const owner of prepared.data.recipients){
 const result=await operatePrepared('link',{recipientId:owner.id});
 const isolated=await browser.newContext();const recipientPage=await isolated.newPage();
 await recipientPage.goto(result.link);const ownerFields=savedFields.filter(f=>f.recipientId===owner.id);
 assert.equal(ownerFields.length,3);const nameField=ownerFields.find(f=>f.type==='name');
 await recipientPage.getByRole('textbox',{name:new RegExp('^'+nameField.label)}).fill(owner.name);
 await recipientPage.getByText('Add signature',{exact:true}).click();
 await recipientPage.getByLabel('Typed signature').fill(owner.name);
 await recipientPage.getByRole('button',{name:'Apply signature',exact:true}).click();
 await recipientPage.getByRole('checkbox').check();await recipientPage.getByRole('button',{name:'Review & confirm',exact:true}).click();
 await recipientPage.getByRole('button',{name:'Confirm & sign',exact:true}).click();
 await recipientPage.getByRole('heading',{name:/Your action is recorded|Agreement completed/}).waitFor({timeout:90000});
 await isolated.close();prepared=(await(await internal.request.get(base+'/api/sign/'+prepared.id)).json()).data;
 const action=prepared.data.actions.find(a=>a.recipientId===owner.id);assert.ok(action);
 assert.ok(action.values[ownerFields.find(f=>f.type==='date').id]);check(true,owner.role+' completes the exact fields placed in Advanced Send');
}
assert.equal(prepared.status,'completed');check((await operatePrepared('verify')).verified,'editor-prepared PDF and evidence chain verify');
const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
const {createCanvas}=await import('@napi-rs/canvas');
const finalResponse=await internal.request.get(base+'/api/sign/'+prepared.id+'?file=completed');
const finalTask=getDocument({data:new Uint8Array(await finalResponse.body()),useSystemFonts:true});const finalPdf=await finalTask.promise;
const originalTask=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});const originalPdf=await originalTask.promise;
async function pixels(doc,pageNumber){
 const pdfPage=await doc.getPage(pageNumber);const viewport=pdfPage.getViewport({scale:1});
 const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
 const context=canvas.getContext('2d');await pdfPage.render({canvas,canvasContext:context,viewport}).promise;
 return {width:canvas.width,height:canvas.height,pixels:context.getImageData(0,0,canvas.width,canvas.height).data};
}
for(let pageNumber=1;pageNumber<=finalPdf.numPages;pageNumber++){
 const before=await pixels(originalPdf,pageNumber),after=await pixels(finalPdf,pageNumber);
 const boxes=savedFields.filter(f=>f.page===pageNumber).map(f=>({left:f.x*after.width-2,right:(f.x+f.width)*after.width+2,top:f.y*after.height-2,bottom:(f.y+f.height)*after.height+2,count:0}));
 for(let y=0;y<after.height;y++)for(let x=0;x<after.width;x++){
  const i=4*(x+y*after.width);
  if(Math.abs(before.pixels[i]-after.pixels[i])<12)continue;
  const box=boxes.find(box=>x>=box.left&&x<=box.right&&y>=box.top&&y<=box.bottom);assert.ok(box,'unexpected ink outside a field');box.count++;
 }
 assert.ok(boxes.every(box=>box.count>0),'each assigned field renders ink');
}
await finalTask.destroy();await originalTask.destroy();
check(true,'completed PDF raster comparison finds new ink in each assigned field and nowhere else');
const recipients=[1,2,3].map((n)=>({id:randomUUID(),name:`Browser Signer ${n}`,email:`browser${n}@example.com`,role:n===2?'witness':n===3?'countersigner':'signer',order:1,verification:'possession',generation:0}));
const fields=recipients.map((r,i)=>({id:randomUUID(),recipientId:r.id,type:'signature',page:i%2+1,x:.1,y:.5+i*.1,width:.4,height:.08,required:true,label:'Signature',placeholder:''}));
for(const [index,r] of recipients.entries()){for(const type of ['name','date'])fields.push({id:randomUUID(),recipientId:r.id,type,page:1,x:.1,y:.08+index*.12+(type==='date'?.052:0),width:.5,height:.04,required:true,label:type==='name'?'Legal full name':'Date signed',placeholder:'',inputMode:type==='name'?'editable':'auto',fontSize:16});}
const uploaded=await internal.request.post(base+'/api/sign',{headers:{'Content-Type':'application/pdf','X-File-Name':'Parallel browser agreement.pdf'},data:bytes});assert.equal(uploaded.status(),200);let e=(await uploaded.json()).data;
async function op(operation,extra={}){const r=await internal.request.post(`${base}/api/sign/${e.id}`,{timeout:180000,data:{operation,revision:e.revision,...extra}});const j=await r.json();assert.equal(r.status(),200,JSON.stringify(j));e=j.data;return j;}
await op('save',{data:{title:'Parallel browser agreement',sequential:false,expiresAt:new Date(Date.now()+86400000).toISOString(),recipients,fields}});await op('send');
for(let index=0;index<3;index++){e=(await (await internal.request.get(`${base}/api/sign/${e.id}`)).json()).data;const link=(await op('link',{recipientId:recipients[index].id})).link;const context=await browser.newContext({viewport:{width:index===0?1440:390,height:1000}});const portal=await context.newPage();if(index===0){await portal.route('**/api/sign-portal?file=original',route=>route.fulfill({status:503,body:'Temporary failure'}),{times:1});}portal.on('pageerror',e=>errors.push(e.message));const response=await portal.goto(link,{waitUntil:'domcontentloaded',timeout:90000});await portal.getByRole('heading',{name:'Parallel browser agreement',exact:true}).waitFor({timeout:60000});check(!portal.url().includes('#'),'recipient token is removed from browser URL');check(response.headers()['referrer-policy']==='no-referrer','portal blocks referrer leakage');if(index===0){await portal.getByRole('button',{name:'Retry document',exact:true}).click();check(true,'failed PDF download offers an explicit retry');}await portal.locator('#pdf-page-1 canvas').waitFor();await portal.waitForFunction(()=>document.querySelector('#pdf-page-1 canvas')?.width>300);check(true,'real PDF pages render in browser');
if(index===0){for(const width of [1440,1280,768,390,360]){await portal.setViewportSize({width,height:1000});await portal.screenshot({path:`docs/sign-evidence/portal-${width}.png`,fullPage:true});check(await portal.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`portal has no horizontal page overflow at ${width}px`);}await portal.setViewportSize({width:1440,height:1000});}
await portal.getByRole('textbox',{name:/Legal full name/}).fill('Entered Legal Name '+index);check(await portal.getByRole('textbox',{name:/Legal full name/}).inputValue()==='Entered Legal Name '+index,'recipient can type assigned name independently');console.log('STEP signature dialog '+index);await portal.getByText('Add signature',{exact:true}).click();if(index===0){await portal.getByLabel('Typed signature').fill('Browser Signer 1');await portal.keyboard.press('Tab');check(await portal.evaluate(()=>document.querySelector('[aria-labelledby="signature-title"]')?.contains(document.activeElement)),'signature dialog retains keyboard focus');}else if(index===1){await portal.getByRole('button',{name:'Draw',exact:true}).click();const box=await portal.getByLabel('Draw your signature with a pointer or touch').boundingBox();await portal.mouse.move(box.x+30,box.y+70);await portal.mouse.down();for(let i=0;i<10;i++)await portal.mouse.move(box.x+30+i*15,box.y+70+Math.sin(i)*20);await portal.mouse.up();}else{await portal.getByRole('button',{name:'Upload',exact:true}).click();const png=await sharp({create:{width:240,height:80,channels:4,background:{r:255,g:255,b:255,alpha:1}}}).composite([{input:Buffer.from('<svg width="240" height="80"><path d="M20 55 Q55 5 75 50 T130 30 L190 55" fill="none" stroke="black" stroke-width="3"/></svg>')}]).png().toBuffer();await portal.getByLabel('Upload signature image').setInputFiles({name:'signature.png',mimeType:'image/png',buffer:png});}
await portal.getByLabel('Signature size',{exact:true}).fill('75');check(await portal.getByLabel('Signature size',{exact:true}).inputValue()==='75','signature size slider changes scale');await portal.getByRole('button',{name:'Reset to Fit',exact:true}).click();check(await portal.getByLabel('Signature size',{exact:true}).inputValue()==='100','Reset to Fit restores full proportional fit');if(index===2)await portal.screenshot({path:'docs/sign-evidence/finishing-upload-preview.png',fullPage:true});await portal.getByRole('button',{name:'Apply signature',exact:true}).click();await portal.getByRole('checkbox').check();await portal.getByRole('button',{name:'Review & confirm',exact:true}).click();await portal.getByRole('button',{name:'Confirm & sign',exact:true}).click();await portal.getByRole('heading',{name:/Your action is recorded|Agreement completed/}).waitFor({timeout:90000}).catch(async error=>{console.log('PORTAL ERROR '+(await portal.getByRole('alert').allTextContents()).join(' | '));await portal.screenshot({path:'docs/sign-evidence/portal-failure.png',fullPage:true});throw error;});check(true,`${['typed','drawn','uploaded'][index]} signature completed with separate explicit confirmation`);if(index===2)await portal.screenshot({path:'docs/sign-evidence/portal-completed.png',fullPage:true});await context.close();}
const finishedPdf=await internal.request.get(`${base}/api/sign/${e.id}?file=completed`);assert.equal(finishedPdf.status(),200);writeFileSync('docs/sign-evidence/customization-image-signatures.pdf',await finishedPdf.body());e=(await (await internal.request.get(`${base}/api/sign/${e.id}`)).json()).data;check(e.status==='completed'&&e.data.actions.length===3,'parallel three-signer browser journey completes');check(errors.length===0,`no uncaught browser errors: ${errors.join('; ')}`);writeFileSync('docs/sign-evidence/browser-envelope-id.txt',e.id);console.log(`${passed} browser assertions passed.`);
}catch(err){console.error(String(err.message).split('\n').filter(x=>!/cookie|authorization|base64-/i.test(x)).slice(0,12).join('\n').replace(/#[A-Za-z0-9_-]{43}/g,'#[redacted]'));process.exitCode=1;}finally{await browser.close();}
