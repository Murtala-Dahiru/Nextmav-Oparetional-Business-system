import {signatureAppearance} from './appearance';
import { z } from 'zod';
export const consentText='I agree to use electronic records and signatures. I have had the opportunity to review and download this document. By confirming, I intend to sign or approve this exact document in my stated capacity.';
export const signSettingsSchema=z.object({allowPossession:z.boolean().default(true),defaultDays:z.number().int().min(1).max(365).default(14),senderName:z.string().trim().max(120).default(''),supportEmail:z.union([z.email(),z.literal('')]).default(''),consentAddendum:z.string().trim().max(2000).default(''),allowExternal:z.boolean().default(true)}).strict();
export type SignSettings=z.infer<typeof signSettingsSchema>;
export const fieldTypes=['signature','initials','date','date_input','name','email','company','text','checkbox'] as const;
export const recipientSchema=z.object({id:z.uuid(),name:z.string().trim().min(1).max(120),email:z.union([z.email().max(254),z.literal('')]),role:z.enum(['signer','witness','countersigner','approver','viewer']),order:z.number().int().min(1).max(50),verification:z.enum(['email_otp','possession']),generation:z.number().int().nonnegative().default(0)}).strict();
export const fieldSchema=z.object({id:z.uuid(),recipientId:z.uuid(),type:z.enum(fieldTypes),page:z.number().int().min(1).max(100),x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().min(.02).max(1),height:z.number().min(.015).max(1),required:z.boolean(),label:z.string().max(100),placeholder:z.string().max(100).default(''),signatureFieldId:z.uuid().optional(),inputMode:z.enum(['editable','readonly','auto']).optional(),defaultValue:z.string().max(1000).optional(),fontSize:z.number().min(6).max(72).optional(),fontFamily:z.enum(['sans','serif','mono']).optional(),alignment:z.enum(['left','center','right']).optional(),multiline:z.boolean().optional(),validation:z.enum(['none','letters','number']).optional(),maxLength:z.number().int().min(1).max(1000).optional(),timeZone:z.string().max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}},'Invalid timezone').optional(),dateFormat:z.enum(['iso','medium']).optional()}).strict().refine(f=>f.x+f.width<=1.00001&&f.y+f.height<=1.00001,'Field extends beyond page');
export const draftSchema=z.object({title:z.string().trim().min(1).max(200),sequential:z.boolean(),expiresAt:z.iso.datetime(),recipients:z.array(recipientSchema).min(1).max(30),fields:z.array(fieldSchema).max(300)}).strict();
// Drafts may retain an unfinished recipient. Issuing still uses draftSchema.
export const savedDraftSchema=draftSchema.extend({
 recipients:z.array(recipientSchema.extend({name:z.string().trim().max(120)})).max(30),
});
export function signValidationMessage(error:unknown):string {
 if(!(error instanceof z.ZodError))return error instanceof Error?error.message:'Unable to update the agreement.';
 return error.issues.map(issue=>{
   const [collection,index,property]=issue.path;
   if(collection==='recipients'&&typeof index==='number'){
     const prefix='Recipient '+(index+1);
     if(property==='name'&&issue.code==='too_small')return prefix+' needs a name. Enter their full name or remove this recipient before enabling signing.';
     if(property==='email')return prefix+' needs a valid email address, or leave it blank for secure-link signing.';
     if(property==='order')return prefix+' needs a signing order from 1 to 50.';
     return prefix+' has an invalid '+String(property??'setting')+'. '+issue.message;
   }
   if(collection==='recipients')return 'Add at least one recipient before enabling signing (maximum 30).';
   if(collection==='fields'&&typeof index==='number')return 'Field '+(index+1)+': '+issue.message;
   return String(collection??'Agreement')+': '+issue.message;
 }).join(' ');
}
export type Recipient=z.infer<typeof recipientSchema>;
export type Field=z.infer<typeof fieldSchema>;
export type ActionRecord={recipientName?:string;recipientEmail?:string;recipientRole?:string;recipientId:string;action:'signed'|'approved';at:string;values:Record<string,string|boolean>;method:string;consentVersion:string;sourceHash:string};
export type EvidenceEvent={sequence:number;type:string;at:string;recipientId?:string;detail:string;previous:string;hash:string;seal:string};
export type Agreement=z.infer<typeof draftSchema>&{envelopeId?:string;template?:{id:string;revision:number};supportEmail?:string;organizationName:string;source:{path:string;hash:string;pages:{width:number;height:number}[]};consent:{version:string;text:string};actions:ActionRecord[];events:EvidenceEvent[];final?:{path:string;hash:string;certificatePath:string;certificateHash:string};};
export type Envelope={archived_at?:string|null;id:string;organization_id:string;owner_id:string;record_id:string|null;version_id:string|null;title:string;status:string;revision:number;data:Agreement;created_at:string;updated_at:string};
export function activeRecipient(a:Agreement,id:string){const r=a.recipients.find(r=>r.id===id);if(!r)return false;if(!a.sequential||r.role==='viewer'||a.actions.some(x=>x.recipientId===id))return true;const pending=a.recipients.filter(r=>r.role!=='viewer'&&!a.actions.some(x=>x.recipientId===r.id));return !pending.length||r.order===Math.min(...pending.map(r=>r.order));}
export function validateFieldAssignments(fields:Field[], recipients:Recipient[], pages:number){
 const byId=new Map(fields.map(field=>[field.id,field]));
 if(byId.size!==fields.length)throw Error('Each field needs its own identifier.');
 const eligible=new Set(recipients.filter(r=>r.role!=='viewer').map(r=>r.id));
 for(const field of fields){
   const label=field.label||field.type;
   if(!eligible.has(field.recipientId))throw Error('Assign '+label+' to a signing recipient.');
   if(field.page>pages)throw Error('Choose an existing page for '+label+'.');
   if(field.signatureFieldId){
     const signature=byId.get(field.signatureFieldId);
     if(field.type!=='date'||signature?.type!=='signature'||signature.recipientId!==field.recipientId)throw Error('Link '+label+' to a signature belonging to the same recipient.');
   }
 }
}
export function validateDraft(a:Agreement,allowPossession:boolean){draftSchema.parse({title:a.title,sequential:a.sequential,expiresAt:a.expiresAt,recipients:a.recipients,fields:a.fields});if(new Set(a.recipients.filter(r=>r.email).map(r=>r.email.toLowerCase())).size!==a.recipients.filter(r=>r.email).length||new Set(a.recipients.map(r=>r.id)).size!==a.recipients.length)throw Error('Recipient identities must be unique');if(new Set(a.fields.map(f=>f.id)).size!==a.fields.length)throw Error('Field identifiers must be unique');if(a.recipients.some(r=>r.verification==='email_otp'&&!r.email))throw Error('Email is required for email verification');if(!a.recipients.some(r=>r.role!=='viewer'))throw Error('Add a signer or approver');if(Date.parse(a.expiresAt)<=Date.now()||Date.parse(a.expiresAt)>Date.now()+365*86400000)throw Error('Expiration must be within the next year');if(!allowPossession&&a.recipients.some(r=>r.verification==='possession'))throw Error('Organization policy requires email verification');for(const f of a.fields){if(f.signatureFieldId&&!a.fields.some(s=>s.id===f.signatureFieldId&&s.type==='signature'&&s.recipientId===f.recipientId))throw Error('Date must be associated with the same signer');if(f.page>a.source.pages.length||!a.recipients.some(r=>r.id===f.recipientId&&r.role!=='viewer'))throw Error('Fields must belong to a signer and an existing page');}for(const f of a.fields){if(f.signatureFieldId&&f.type!=='date')throw Error('Only signing dates can link to signatures');if(f.inputMode==='auto'&&!['date','name','email'].includes(f.type))throw Error('Automatic values are only supported for signing dates and recipient details');if(f.inputMode==='readonly'&&(!['name','email','company','text','date_input'].includes(f.type)||!f.defaultValue))throw Error('Read-only fields require a safe text default');if(['signature','initials','checkbox','date'].includes(f.type)&&f.defaultValue)throw Error('This field cannot have a default value');
 const owner=a.recipients.find(r=>r.id===f.recipientId)!;
 if(f.inputMode==='auto'&&f.type==='email'&&f.required&&!owner.email)throw Error('Add a recipient email or choose editable email');
 if(f.defaultValue)validateValues({...a,fields:[f]},owner,{[f.id]:f.defaultValue});}}
export function automaticField(f:Field){return f.type==='date'||f.inputMode==='auto'||(f.inputMode===undefined&&['name','email'].includes(f.type));}
export function validateValues(a:Agreement,r:Recipient,raw:unknown){
 const values=z.record(z.string(),z.union([z.string().max(400000),z.boolean()])).parse(raw);
 const fields=a.fields.filter(f=>f.recipientId===r.id);
 if(Object.keys(values).some(k=>!fields.some(f=>f.id===k)))throw Error('A field belongs to another recipient');
 for(const f of fields){
  if(automaticField(f)){delete values[f.id];continue;}
  if(f.inputMode==='readonly')values[f.id]=f.defaultValue??'';
  const v=values[f.id];
  if(f.required&&(v===undefined||v===false||typeof v==='string'&&!v.trim()))throw Error('Complete every required field');
  if(v===undefined||v===''){delete values[f.id];continue;}
  if(f.type==='checkbox'){if(typeof v!=='boolean')throw Error('Invalid checkbox');continue;}
  if(typeof v!=='string')throw Error('Invalid field value');
  if(['signature','initials'].includes(f.type)){const appearance=signatureAppearance(v);if(!appearance.mark.startsWith('data:')&&appearance.mark.length>100)throw Error('Typed signature exceeds 100 characters');continue;}
  if(v.length>(f.maxLength??1000))throw Error('Text is too long');
  if(v.startsWith('data:')||v.startsWith('nextmav-signature:'))throw Error('Images are only allowed in signature fields');
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v))throw Error('Unsupported control characters');
  if(f.type==='email'&&!z.email().safeParse(v).success)throw Error('Enter a valid email');
  if(f.type==='date_input'&&!z.iso.date().safeParse(v).success)throw Error('Enter a valid calendar date');
  if(f.validation==='letters'&&!/^[\p{L}\p{M} .’'-]+$/u.test(v))throw Error('Use letters only');
  if(f.validation==='number'&&!/^-?\d+(\.\d+)?$/.test(v))throw Error('Enter a number');
 }
 return values;
}
