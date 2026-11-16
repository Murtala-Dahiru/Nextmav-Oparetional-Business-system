import {z} from 'zod';
export const captureTargets=['first_name','last_name','email','phone','company_name','job_title','notes','territory','industry','service_interest'] as const;
export const captureField=z.object({key:z.string().regex(/^[a-z][a-z0-9]{0,39}$/),label:z.string().trim().min(1).max(100),target:z.enum(captureTargets),required:z.boolean()}).strict();
export const captureFormSchema=z.object({id:z.uuid().nullable(),version:z.number().int().min(0),name:z.string().trim().min(1).max(100),fields:z.array(captureField).min(1).max(15),source:z.string().trim().min(1).max(100),campaign:z.string().max(250),consentText:z.string().trim().min(1).max(2000),enabled:z.boolean()}).strict().superRefine((v,c)=>{
 if(new Set(v.fields.map(f=>f.key)).size!==v.fields.length||new Set(v.fields.map(f=>f.target)).size!==v.fields.length)c.addIssue({code:'custom',message:'Field keys and destinations must be unique'});
 if(!v.fields.some(f=>f.target==='email'||f.target==='phone'))c.addIssue({code:'custom',message:'Include email or phone'});
 if(!v.fields.some(f=>['first_name','last_name','company_name'].includes(f.target)))c.addIssue({code:'custom',message:'Include a name or company'});
});
export type CaptureForm=z.infer<typeof captureFormSchema>;
export type PublicCaptureForm=Pick<CaptureForm,'id'|'version'|'name'|'fields'|'consentText'>&{challenge:string};
export const captureSubmissionSchema=z.object({formId:z.uuid(),challenge:z.string().max(2000),values:z.record(z.string().max(40),z.string().max(4000)),consent:z.literal(true),website:z.string().max(500).default('')}).strict();
