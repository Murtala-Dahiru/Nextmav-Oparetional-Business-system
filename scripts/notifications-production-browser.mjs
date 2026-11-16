/** Real production end-to-end test. No injected push events or local dispatcher.
 * Uses only the two isolated accounts created by notifications-api-test.mjs.
 * Headless receipt is NOT proof of visible operating-system display. */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { connect, readEnv } from './db-connect.mjs';
const fixture = JSON.parse(readFileSync(join(tmpdir(),'nextmav-notifications-fixture.json')));
const base = process.env.APP_URL || fixture.base;
assert.equal(base,fixture.base);
assert.match(base,/^https:\/\//);
for (const user of fixture.users) assert.match(user.email,/^notifications-[a-f0-9-]{36}@example\.com$/);
const { chromium, request } = await import(pathToFileURL(join(tmpdir(),'nextmav-browser/node_modules/playwright/index.mjs')).href);
const profile = mkdtempSync(join(tmpdir(),'nextmav-production-'));
const ctx = await chromium.launchPersistentContext(profile,{channel:'msedge',headless:process.env.HEADED!=='1'});
const sender = await request.newContext();
const { client } = await connect(readEnv('DIRECT_URL')||readEnv('DATABASE_URL'),{statement_timeout:15000});
async function api(who,path,method='GET',data) {
  const response = await who.fetch(base+path,{method,data});
  assert.ok(response.ok(),`${method} ${path}: ${response.status()}`);
  return await response.json();
}
try {
  await api(sender,'/api/auth/login','POST',fixture.users[0]);
  await api(ctx.request,'/api/auth/login','POST',fixture.users[1]);
  await ctx.grantPermissions(['notifications'],{origin:base});
  const page = await ctx.newPage(); await page.goto(base+'/settings/notifications');
  const settings = (await api(ctx.request,'/api/notifications/settings')).data;
  assert.equal(settings.pushReady,true,'Production push configuration must be ready');
  const saved = page.waitForResponse(r=>r.url()===base+'/api/notifications/devices' && r.request().method()==='POST');
  await page.getByRole('button',{name:'Enable this browser'}).click();
  await page.getByText(/This browser is connected/).waitFor({timeout:90000});
  const device = (await (await saved).json()).data.id;
  const state = await page.evaluate(async()=>{const r=await navigator.serviceWorker.ready;return {secure:isSecureContext,permission:Notification.permission,scope:new URL(r.scope).pathname,active:!!r.active,subscription:!!await r.pushManager.getSubscription()};});
  console.log('BROWSER '+JSON.stringify(state));
  assert.ok(state.subscription && state.active && state.scope==='/');
  const worker = ctx.serviceWorkers().find(w=>new URL(w.url()).pathname==='/sw.js'); assert.ok(worker);
  const prefs={...settings.preferences,push:true,quietEnabled:false,messagePreviews:true,businessPreviews:true};
  await api(ctx.request,'/api/notifications/settings','PUT',prefs);
  async function receipt(id,expectedTitle,expectedBody) {
    const started=Date.now(); let row;
    for(let i=0;i<60;i++) {
      row=(await client.query('SELECT state,last_code FROM notification_deliveries WHERE notification_id=$1 AND device_id=$2 AND organization_id=$3',[id,device,fixture.orgId])).rows[0];
      const shown=await worker.evaluate(async id=>{const n=(await self.registration.getNotifications()).find(n=>new URL(n.data.url,self.location.origin).searchParams.get('id')===String(id));return n?{title:n.title,body:n.body}:null;},String(id));
      if(row?.state==='accepted' && shown){
        assert.equal(row.last_code,201); assert.match(shown.title,expectedTitle); assert.match(shown.body,expectedBody);
        console.log('DELIVERY '+JSON.stringify({provider:row.last_code,serviceWorkerReceipt:true,previewMatches:true,elapsedMs:Date.now()-started,osDisplayVerified:false}));return;
      }
      if(row?.state==='failed'||row?.state==='skipped') throw Error(`Delivery ${row.state}, provider ${row.last_code}`);
      await pause(1000);
    }
    throw Error(`No actual push receipt within 60 seconds; last queue state: ${row?.state ?? 'missing'}`);
  }
  async function eventNotice(entityId,type) {
    const rows=(await api(ctx.request,'/api/notifications?pageSize=100')).data;
    const n=rows.find(n=>n.entityId===entityId && (!type || n.type===type));assert.ok(n,'Recipient notification created');return n;
  }
  const test=(await api(ctx.request,'/api/notifications/test','POST',{deviceId:device})).data;
  await receipt(test.notificationId,/NextMav push test/,/server push pipeline/);
  const status=(await api(ctx.request,`/api/notifications/test?id=${test.notificationId}`)).data;
  assert.equal(status.state,'accepted');
  assert.equal((await api(sender,`/api/notifications/test?id=${test.notificationId}`)).data,null,'Other user cannot inspect device delivery');
  async function message(body) {
    const msg=(await api(sender,'/api/communication/messages','POST',{channelId:fixture.channelId,body})).data;
    const n=await eventNotice(msg.id);await receipt(n.id,/Sender sent you a message/,new RegExp(body));
    const messages=(await api(ctx.request,`/api/communication/messages?channelId=${fixture.channelId}`)).data;
    assert.ok(messages.some(m=>m.id===msg.id && m.body===body),'Recipient can read actual persisted message');
    const opened=await ctx.request.get(base+`/api/notifications/open?id=${n.id}&organizationId=${fixture.orgId}`,{maxRedirects:0});
    assert.equal(opened.status(),303);assert.ok(opened.headers().location.includes(fixture.channelId));
    return n;
  }
  await message('Please review the project proposal before 3 PM.');
  const background=await ctx.newPage();await background.goto('about:blank');await background.bringToFront();
  console.log('BACKGROUND '+JSON.stringify({visibility:await page.evaluate(()=>document.visibilityState)}));
  await message('Background notification acceptance');
  await page.close();
  assert.equal(ctx.pages().filter(p=>p.url().startsWith(base)).length,0);
  console.log('CLOSED_TAB '+JSON.stringify({nextmavTabs:0}));
  await message('Closed tab production delivery acceptance');
  const project=(await api(sender,'/api/projects/projects','POST',{name:'Notification production acceptance'})).data;
  await api(sender,'/api/projects/members','POST',{projectId:project.id,memberId:fixture.memberB});
  const task=(await api(sender,'/api/projects/tasks','POST',{title:'Prepare monthly acceptance report',projectId:project.id,assigneeId:fixture.memberB})).data;
  await receipt((await eventNotice(task.id,'task_assigned')).id,/New task: Prepare monthly/,/Prepare monthly acceptance report/);
  const start=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  const leave=(await api(sender,'/api/hr/leave','POST',{memberId:fixture.memberB,startDate:start,endDate:start,reason:'Isolated acceptance fixture'})).data;
  await api(sender,`/api/hr/leave/${leave.id}`,'PATCH',{status:'approved'});
  await receipt((await eventNotice(leave.id,'leave_approved')).id,/Leave request approved/,/^Open NextMav to view the details\.$/);
  await api(ctx.request,'/api/notifications/settings','PUT',{...prefs,messagePreviews:false});
  const hidden=(await api(sender,'/api/communication/messages','POST',{channelId:fixture.channelId,body:'Hidden preview acceptance'})).data;
  await receipt((await eventNotice(hidden.id)).id,/^New message$/, /^Open NextMav to view the details\.$/);
  console.log('PASS production test, messages, closed-tab receipt, task, approval, hidden previews, and authorized destinations. OS display/click and physical mobile remain separate checks.');
} finally {
  await sender.dispose();await ctx.close();await client.end();
  const target=resolve(profile);
  assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('nextmav-production-'));
  rmSync(target,{recursive:true,force:true,maxRetries:3});
}
