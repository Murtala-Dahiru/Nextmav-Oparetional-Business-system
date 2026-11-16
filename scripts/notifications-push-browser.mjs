// This test uses the browser's actual PushManager and BOS endpoints. No injected push events.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
const { chromium } = await import(pathToFileURL(join(tmpdir(), 'nextmav-browser/node_modules/playwright/index.mjs')).href);
const fixture = JSON.parse(readFileSync(join(tmpdir(), 'nextmav-notifications-fixture.json')));
const base = process.env.APP_URL || fixture.base;
const profile = mkdtempSync(join(tmpdir(), 'nextmav-edge-'));
const options = {
  channel: 'msedge',
  headless: process.env.HEADED !== '1',
  ignoreDefaultArgs: process.env.DEFAULT_NETWORK_FLAGS === '1' ? [] : [
    '--disable-background-networking','--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding',
  ],
};
const privateBrowser = process.env.PRIVATE_CONTEXT === '1' ? await chromium.launch(options) : null;
const ctx = privateBrowser ? await privateBrowser.newContext() : await chromium.launchPersistentContext(profile, options);
try {
  const { email,password } = fixture.users[1];
  assert.equal((await ctx.request.post(base+'/api/auth/login',{data:{email,password}})).status(),200);
  await ctx.grantPermissions(['notifications'], { origin:base });
  const page=await ctx.newPage(); await page.goto(base+'/settings/notifications');
  const settings = await (await ctx.request.get(base+'/api/notifications/settings')).json();
  const key = Buffer.from(settings.data.publicKey, 'base64url');
  console.log(JSON.stringify({headed:process.env.HEADED==='1', normalProfile:!privateBrowser,
    keyIsUncompressedP256:key.length===65 && key[0]===4,
    ...await page.evaluate(async()=>{
      const r=await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      return {secure:isSecureContext,scope:new URL(r.scope).pathname,pushSupported:'PushManager' in window,
        preexistingSubscription:!!await r.pushManager.getSubscription()};
    })}));
  const button=page.getByRole('button',{name:'Enable Notifications'});
  const saved=page.waitForResponse(r=>r.url()===base+'/api/notifications/devices' && r.request().method()==='POST',{timeout:120000}).then(r=>r.json()).catch(()=>null);
  await button.click({timeout:60000});
  const result=await Promise.race([
    page.getByText(/This browser is connected/).waitFor({timeout:120000}).then(()=>'connected'),
    page.locator('main [role=alert]').waitFor({timeout:120000}).then(()=> 'registration failed'),
  ]);
  const state=await page.evaluate(async()=>({permission:Notification.permission,worker:!!(await navigator.serviceWorker.ready).active,subscription:!!await (await navigator.serviceWorker.ready).pushManager.getSubscription()}));
  console.log(JSON.stringify({result,...state}));
  if(result==='registration failed') {
    const message=await page.locator('main [role=alert]').innerText();
    console.log(/permission denied/i.test(message) ? 'Registration failed: permission denied' :
      /push service/i.test(message) ? 'Registration failed at push service' : 'Registration failed; inspect local browser settings');
    process.exitCode=1;
  }
  if(state.subscription&&result==='connected' && process.env.SKIP_TEST_PUSH !== '1') {
    const testRequest = page.waitForResponse(r=>r.url()===base+'/api/notifications/test' && r.request().method()==='POST');
    await page.getByRole('button',{name:'Send Test Notification'}).first().click();
    await page.getByText(/Test queued/).waitFor(); console.log('PASS real test notification queued');
    const response=await testRequest;
    assert.ok(response.ok());
    if(process.env.VERIFY_DELIVERY==='1') {
      const device=(await saved)?.data?.id;
      assert.ok(device);
      const worker=ctx.serviceWorkers().find(w=>new URL(w.url()).pathname==='/sw.js');
      assert.ok(worker);
      const background=await ctx.newPage(); await background.bringToFront();
      const session=await ctx.newCDPSession(page);
      await session.send('Emulation.setFocusEmulationEnabled',{enabled:false});
      const win=await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds',{windowId:win.windowId,bounds:{windowState:'minimized'}});
      await pause(500);
      const received=new Set();
      const monitor=setInterval(()=>{
        void worker.evaluate(async()=>(await self.registration.getNotifications()).map(n=>new URL(n.data.url,self.location.origin).searchParams.get('id')))
          .then(ids=>ids.forEach(id=>received.add(String(id)))).catch(()=>{});
      },500);
      const dispatch=()=>new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,['--import','tsx','scripts/notifications-worker.mts'],{
          env:{...process.env,NOTIFICATION_DISPATCH_ORG:fixture.orgId},stdio:'inherit'
        });
        child.on('error',reject);
        child.on('exit',code=>code===0?resolve():reject(Error('Worker exit '+code)));
      });
      async function observed(id) {
        for(let i=0;i<45;i++) {
          if(received.has(String(id))) return true;
          const found=await worker.evaluate(async id=>(await self.registration.getNotifications()).some(n=>{
            const link=new URL(n.data.url,self.location.origin);
            return link.searchParams.get('id')===String(id) && n.title==='NextMav';
          }),id);
          if(found) return true;
          await pause(1000);
        }
        return false;
      }
      const inbox=async()=>(await (await ctx.request.get(base+'/api/notifications')).json()).data;
      const test=(await inbox()).find(n=>n.type==='push_test');
      assert.ok(test);
      const visibility=await page.evaluate(()=>document.visibilityState);
      console.log('Recipient tab visibility:',visibility);
      await dispatch();
      const backgroundReceipt=await observed(test.id); console.log({receipt:backgroundReceipt,backgroundVerified:backgroundReceipt && visibility==='hidden'});
      await session.send('Browser.setWindowBounds',{windowId:win.windowId,bounds:{windowState:'normal'}});
      await page.close();
      const { request }=await import(pathToFileURL(join(tmpdir(),'nextmav-browser/node_modules/playwright/index.mjs')).href);
      const a=await request.newContext();
      try {
        const {email,password}=fixture.users[0];
        assert.ok((await a.post(base+'/api/auth/login',{data:{email,password}})).ok());
        const sent=await a.post(base+'/api/communication/messages',{data:{channelId:fixture.channelId,body:'Isolated closed-tab delivery verification'}});
        assert.ok(sent.ok()); const msg=(await sent.json()).data.id;
        const notification=(await inbox()).find(n=>n.entityId===msg);
        assert.ok(notification);
        console.log('Open NextMav tabs:',ctx.pages().filter(p=>p.url().startsWith(base)).length);
        await dispatch();
        const closedReceipt=await observed(notification.id); console.log({closedReceipt});
        if(process.env.BUSINESS_PUSH==='1') {
          const {verifyBusinessPush}=await import('./notifications-business-push.mjs');
          await verifyBusinessPush({fixture,ctx,base,device,dispatch,observed});
        }
        if(process.env.TEST_PWA==='1') {
          const browserSession=await ctx.newCDPSession(background);
          const manifestId=base+'/dashboard';
          let installed=false;
          try {
            await browserSession.send('PWA.install',{manifestId,installUrlOrBundleUrl:base+'/dashboard'});
            installed=true;
            const launched=ctx.waitForEvent('page');
            await browserSession.send('PWA.launch',{manifestId,url:base+'/settings/notifications'});
            const app=await launched;
            await app.waitForLoadState('domcontentloaded');
            await app.getByRole('heading',{name:'Notifications',exact:true}).waitFor();
            console.log({installedPWA:await app.evaluate(()=>matchMedia('(display-mode: standalone)').matches)});
            await app.getByRole('button',{name:'Send Test Notification'}).first().click();
            await app.getByText(/Test queued/).waitFor();
            const pwaTest=(await inbox()).find(n=>n.type==='push_test');
            await dispatch(); console.log({installedReceipt:await observed(pwaTest.id)});
          } catch(e) {console.log('PWA verification pending:',String(e.message).split('\n')[0].slice(0,200));}
          finally {if(installed) await browserSession.send('PWA.uninstall',{manifestId});}
        }
        if(!backgroundReceipt || !closedReceipt) process.exitCode=1;
        if(process.env.OBSERVE_CLICK==='1' && closedReceipt) {
          console.log('Waiting for Windows notification click');
          const opened=await ctx.waitForEvent('page',{timeout:180000});
          await opened.waitForURL(url=>url.searchParams.get('channel')===fixture.channelId,{timeout:25000,waitUntil:'commit'});
          console.log('PASS notification click opened expected conversation');
        }
      } finally {clearInterval(monitor); await a.dispose();}
    }
  }
} finally {await ctx.close(); await privateBrowser?.close(); rmSync(profile,{recursive:true,force:true,maxRetries:3});}
