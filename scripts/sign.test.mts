import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PDFDocument,PDFName,PDFString,degrees} from 'pdf-lib';
import {activeRecipient,consentText,validateDraft,validateValues,type Agreement} from '../src/lib/sign/model';
import {sameOrigin,canonical,event,hash,inspectPdf,verifyEvents,sanitizeValues} from '../src/lib/sign/server';
process.env.SIGN_EVIDENCE_KEY='synthetic-test-evidence-key-never-use-in-production';
const r={id:randomUUID(),name:'Alex',email:'alex@example.com',role:'signer' as const,order:1,verification:'possession' as const,generation:0};
const f={id:randomUUID(),recipientId:r.id,type:'signature' as const,page:1,x:.1,y:.7,width:.3,height:.1,required:true,label:'Signature',placeholder:''};
const a:Agreement={title:'Agreement',sequential:true,expiresAt:new Date(Date.now()+86400000).toISOString(),recipients:[r],fields:[f],organizationName:'Synthetic org',source:{path:'synthetic.pdf',hash:hash('synthetic'),pages:[{width:595,height:842}]},consent:{version:'1',text:consentText},actions:[],events:[]};
let passed=0;function check(label:string,fn:()=>void){fn();console.log('PASS '+label);passed++;}
check('required verification cannot be silently downgraded',()=>assert.throws(()=>validateDraft(a,false)));
check('valid draft passes policy and field checks',()=>assert.doesNotThrow(()=>validateDraft(a,true)));
check('out-of-page placement is rejected',()=>assert.throws(()=>validateDraft({...a,fields:[{...f,x:.9}]},true)));
check('unknown document page is rejected',()=>assert.throws(()=>validateDraft({...a,fields:[{...f,page:3}]},true)));
check('duplicate email recipients rejected',()=>assert.throws(()=>validateDraft({...a,recipients:[r,{...r,id:randomUUID()}]},true)));
check('recipient cannot submit another field',()=>assert.throws(()=>validateValues(a,r,{foreign:'signature'})));
check('empty required signature rejected',()=>assert.throws(()=>validateValues(a,r,{[f.id]:''})));
check('future recipient is inactive',()=>assert.equal(activeRecipient({...a,recipients:[r,{...r,id:'future',order:2}]},'future'),false));
check('JSON canonicalization survives database key reordering',()=>assert.equal(canonical({z:1,a:{c:2,b:3}}),canonical({a:{b:3,c:2},z:1})));
event(a,'agreement.sent');const action={recipientId:r.id,action:'signed' as const,at:new Date().toISOString(),values:{[f.id]:'Alex'},method:'possession',consentVersion:'1',sourceHash:a.source.hash};a.actions.push(action);event(a,'recipient.signed',hash(canonical(action)),r.id);
check('authenticated evidence verifies',()=>assert.equal(verifyEvents(a),true));
check('signature substitution invalidates evidence',()=>{const copy=structuredClone(a);copy.actions[0].values[f.id]='Mallory';assert.equal(verifyEvents(copy),false);});
check('event alteration invalidates evidence',()=>{const copy=structuredClone(a);copy.events[0].detail='altered';assert.equal(verifyEvents(copy),false);});
check('truncated action event invalidates evidence',()=>{const copy=structuredClone(a);copy.events.pop();assert.equal(verifyEvents(copy),false);});
const finalized=structuredClone(a);finalized.final={path:'final.pdf',hash:hash('final'),certificatePath:'certificate.pdf',certificateHash:hash('certificate')};event(finalized,'agreement.completed.v2',hash(canonical(finalized.final)));
check('completion binds certificate and final PDF together',()=>assert.equal(verifyEvents(finalized),true));
check('certificate substitution invalidates completion evidence',()=>{const copy=structuredClone(finalized);copy.final!.certificateHash=hash('forged');assert.equal(verifyEvents(copy),false);});
check('completion event truncation cannot hide substitution',()=>{const copy=structuredClone(finalized);copy.events.pop();assert.equal(verifyEvents(copy),false);});
const pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save();assert.equal((await inspectPdf(bytes)).length,1);console.log('PASS valid PDF parser');passed++;
await assert.rejects(()=>inspectPdf(Buffer.from('%PDF- fake')));console.log('PASS malformed PDF parser rejection');passed++;
pdf.catalog.set(PDFName.of('OpenAction'),pdf.context.obj({S:'JavaScript',JS:PDFString.of('alert(1)')}));const unsafe=await pdf.save();await assert.rejects(()=>inspectPdf(unsafe));console.log('PASS active PDF content rejection');passed++;
const rotated=await PDFDocument.create();rotated.addPage().setRotation(degrees(90));const rotatedBytes=await rotated.save();assert.deepEqual(await inspectPdf(rotatedBytes),[{width:rotated.getPage(0).getHeight(),height:rotated.getPage(0).getWidth()}]);console.log('PASS rotated PDF reports displayed page dimensions');passed++;
await assert.rejects(()=>sanitizeValues({[f.id]:'data:image/svg+xml;base64,PHN2Zz4='}));console.log('PASS unsafe signature image rejected');passed++;
check('manual-link recipient may omit email',()=>assert.doesNotThrow(()=>validateDraft({...a,recipients:[{...r,email:''}]},true)));
check('OTP recipient must supply an email',()=>assert.throws(()=>validateDraft({...a,recipients:[{...r,email:'',verification:'email_otp'}]},true)));
console.log(`${passed} focused assertions passed.`);

const previousPublicUrl = process.env.NEXT_PUBLIC_APP_URL;
try {
  process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.invalid';
  const upload = (origin: string, site = 'same-origin') => new Request('http://localhost:3000/api/sign', {
    method: 'POST', headers: { origin, 'sec-fetch-site': site },
  });
  sameOrigin(upload('https://crm.example.invalid'));
  sameOrigin(upload('http://localhost:3000'));
  assert.throws(() => sameOrigin(upload('https://untrusted.invalid')));
  assert.throws(() => sameOrigin(upload('https://crm.example.invalid', 'cross-site')));
  console.log('PASS signing origin behind a proxy and cross-site rejection');
} finally {
  if (previousPublicUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = previousPublicUrl;
}