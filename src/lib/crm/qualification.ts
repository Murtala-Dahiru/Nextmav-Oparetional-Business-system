import {z} from 'zod';
export const qualificationField=z.object({key:z.string().regex(/^[a-z][a-z0-9]{0,39}$/),label:z.string().trim().min(1).max(100),type:z.enum(['text','number','date','boolean']),required:z.boolean()}).strict();
export const frameworkSchema=z.object({version:z.number().int().min(0),name:z.string().trim().min(1).max(100),fields:z.array(qualificationField).min(1).max(30)}).strict().refine(v=>new Set(v.fields.map(f=>f.key)).size===v.fields.length,'Field keys must be unique');
export type Framework=z.infer<typeof frameworkSchema>;
export const qualificationSchema=z.object({version:z.number().int().min(0),frameworkVersion:z.number().int().min(1),answers:z.record(z.string().max(40),z.union([z.string().max(4000),z.number().finite(),z.boolean(),z.null()])),metadata:z.object({territory:z.string().max(250),industry:z.string().max(250),serviceInterest:z.string().max(250),campaign:z.string().max(250)}).strict()}).strict();
export const defaultFramework:Framework={version:0,name:'Lead qualification',fields:[['need','Customer need'],['budget','Budget'],['authority','Authority and decision-maker'],['timeline','Timeline'],['service','Service interest'],['opportunity','Estimated opportunity value'],['notes','Qualification notes']].map(([key,label])=>({key,label,type:'text',required:false}))};

