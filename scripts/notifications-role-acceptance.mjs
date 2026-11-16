/** Production acceptance with disposable accounts. The DB creates isolated memberships;
 * every navigation and business event under test uses the signed-in production app. */
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { connect, readEnv } from './db-connect.mjs';
process.loadEnvFile('.env');
const base = new URL(process.env.APP_URL).origin;
const { chromium, devices } = await import(pathToFileURL(join(tmpdir(),'nextmav-browser/node_modules/playwright/index.mjs')).href);
const admin = createClient(readEnv('NEXT_PUBLIC_SUPABASE_URL'),readEnv('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const { client } = await connect(readEnv('DIRECT_URL') || readEnv('DATABASE_URL'));
const browser = await chromium.launch({channel:'msedge'});
const accounts = [], orgs = [];
async function one(sql, params) { return (await client.query(sql,params)).rows[0]; }
async function api(ctx,path,data) {
  const r = data ? await ctx.request.post(base+path,{data}) : await ctx.request.get(base+path);
  assert.ok(r.ok(),path+' returned '+r.status());
  return (await r.json()).data;
}
async function identity(person, role, org) {
  const session = await api(person.ctx,'/api/auth/session');
  assert.equal(session.user.id,person.id);
  assert.equal(session.user.role,role);
  assert.equal(session.organization.id,org);
}
async function member(org,person,role) {
  return (await one('insert into organization_members(organization_id,user_id,role) values ($1,$2,$3) returning id',[org,person.id,role])).id;
}
async function assertDestination(page,path,key,id) {
  await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForURL(url=>url.pathname==='/dashboard' && url.searchParams.get(key)===id);
}
try {
  for(const name of ['Internal acceptance','Portal acceptance']) {
    orgs.push((await one('insert into organizations(name,slug) values ($1,$2) returning id',[name,'acceptance-'+randomUUID()])).id);
  }
  const [internal,portal]=orgs;
  for(const role of ['owner','administrator','employee','client']){
    const email='notifications-'+randomUUID()+'@example.com', password='Test!'+randomUUID();
    const result=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{first_name:'Acceptance',last_name:role}});
    assert.ifError(result.error);
    const user={id:result.data.user.id,role}; accounts.push(user);
    if(role==='owner') user.other=await member(portal,user,'client');
    user.member=await member(internal,user,role);
    user.ctx=role==='owner' ? await chromium.launchPersistentContext('',{channel:'msedge'}) : await browser.newContext(role==='client'?devices['Pixel 7']:{});
    const login=await api(user.ctx,'/api/auth/login',{email,password});
    assert.equal(login.user.role,role); assert.equal(login.user.organizationId,internal);
    await identity(user,role,internal);
    console.log('PASS login and session agree: '+role);
  }
  const [owner,administrator,staff,customer]=accounts;
  const page=await owner.ctx.newPage(); page.setDefaultTimeout(60000);
  await owner.ctx.grantPermissions(['notifications'],{origin:base});
  await page.goto(base+'/settings/notifications',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Enable Notifications'}).click();
  await page.getByText(/This browser is connected/).waitFor();
  const worker=owner.ctx.serviceWorkers()[0];assert.ok(worker);
  async function openPush(entity,type,key,targetId){
    let notice;
    for(let i=0;i<25&&!notice;i++) {
      notice=(await api(owner.ctx,'/api/notifications?pageSize=40')).find(n=>n.entityId===entity && n.type===type);
      if(!notice)await new Promise(r=>setTimeout(r,1000));
    }
    assert.ok(notice,type);
    let path;
    for(let i=0;i<45&&!path;i++) {
      path=await worker.evaluate(async id=>(await self.registration.getNotifications()).map(n=>n.data.url).find(u=>new URL(u,self.location.origin).searchParams.get('id')===id),String(notice.id));
      if(!path)await new Promise(r=>setTimeout(r,1000));
    }
    assert.ok(path,'Real service-worker receipt: '+type);
    await assertDestination(page,path,key,targetId);
    await identity(owner,'owner',internal);
    console.log('PASS owner received and opened actual push destination: '+type);
  }
  const channel=await api(administrator.ctx,'/api/communication/channels',{name:'Owner role acceptance',type:'private'});
  await api(administrator.ctx,'/api/communication/channels/'+channel.id+'/members',{memberIds:[owner.member]});
  const msg=await api(administrator.ctx,'/api/communication/messages',{channelId:channel.id,body:'Owner conversation acceptance'});
  await openPush(msg.id,'message_received','channel',channel.id);
  await page.getByText('Owner conversation acceptance',{exact:true}).last().waitFor();
  const project=await api(administrator.ctx,'/api/projects/projects',{name:'Owner role acceptance'});
  await api(administrator.ctx,'/api/projects/members',{projectId:project.id,memberId:owner.member});
  const task=await api(administrator.ctx,'/api/projects/tasks',{projectId:project.id,title:'Owner task acceptance',assigneeId:owner.member});
  await openPush(task.id,'task_assigned','task',task.id);
  await page.getByText('Owner task acceptance',{exact:true}).last().waitFor();
  await page.reload({waitUntil:'domcontentloaded'}); await identity(owner,'owner',internal);

  // A test notification in the account's other authorized workspace.
  const note=await one("insert into notifications(organization_id,recipient_id,type,title,body,link) values($1,$2,'push_test','Workspace acceptance','Isolated test','/dashboard') returning id",[portal,owner.other]);
  const path='/api/notifications/open?'+new URLSearchParams({id:note.id,organizationId:portal});
  await page.goto(base+path,{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Open in another workspace?'}).waitFor();
  await identity(owner,'owner',internal);
  await page.getByRole('button',{name:'Switch workspace and open'}).click();
  await page.waitForURL(base+'/dashboard');await identity(owner,'client',portal);
  await page.reload({waitUntil:'domcontentloaded'});await identity(owner,'client',portal);
  await page.goto(base+'/settings/workspaces',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Switch workspace'}).click();await page.waitForURL(base+'/dashboard');
  await identity(owner,'owner',internal);console.log('PASS confirmed organization switch, refresh and return to owner');
  for(const user of [staff,customer]){
    const denied=await user.ctx.request.get(base+path,{maxRedirects:0});assert.equal(denied.status(),403);
    await identity(user,user.role,internal);
    const sample=await one("insert into notifications(organization_id,recipient_id,type,title,body,link) values($1,$2,'push_test','Role acceptance','Isolated test','/dashboard') returning id",[internal,user.member]);
    const tab=await user.ctx.newPage();
    await tab.goto(base+'/api/notifications/open?'+new URLSearchParams({id:sample.id,organizationId:internal}),{waitUntil:'domcontentloaded'});
    await tab.waitForURL(base+'/dashboard');await tab.reload({waitUntil:'domcontentloaded'});await identity(user,user.role,internal);
    if(user===customer){const r=await user.ctx.request.get(base+'/api/admin/settings');assert.equal(r.status(),403);}
    console.log('PASS own notification, cross-workspace denial and retained role: '+user.role);
  }
} finally {
  await browser.close();
  for(const user of accounts) {
    if(user.role==='owner') await user.ctx?.close();
    const r=await admin.auth.admin.updateUserById(user.id,{password:randomBytes(48).toString('base64url'),ban_duration:'876000h'});assert.ifError(r.error);
  }
  await client.query('update notification_devices set enabled=false,retired_at=now() where organization_id=any($1::uuid[])',[orgs]);
  await client.query("update organization_members set is_active=false where organization_id=any($1::uuid[]) and role<>'owner' and user_id=any($2::uuid[])",[orgs,accounts.map(a=>a.id)]);
  await client.end();
}
