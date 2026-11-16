import {z} from 'zod';
export const appearanceSchema=z.object({mark:z.string().min(1).max(400000),scale:z.number().min(.25).max(1),x:z.number().min(0).max(1),y:z.number().min(0).max(1)}).strict();
export const appearancePrefix='nextmav-signature:';
export function signatureAppearance(value:string){return value.startsWith(appearancePrefix)?appearanceSchema.parse(JSON.parse(value.slice(appearancePrefix.length))):{mark:value,scale:1,x:.5,y:.5};}
export function encodeAppearance(value:z.infer<typeof appearanceSchema>){return appearancePrefix+JSON.stringify(appearanceSchema.parse(value));}
export function fitSignature(imageWidth:number,imageHeight:number,width:number,height:number,scale=1,x=.5,y=.5){const ratio=Math.min(width/imageWidth,height/imageHeight)*scale;const w=imageWidth*ratio,h=imageHeight*ratio;return {width:w,height:h,x:(width-w)*x,y:(height-h)*y};}
export function signingDate(at:string,timeZone='UTC',format:'iso'|'medium'='iso'){const date=new Date(at);if(format==='medium')return new Intl.DateTimeFormat('en-GB',{timeZone,day:'2-digit',month:'short',year:'numeric'}).format(date);const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);return ['year','month','day'].map(type=>parts.find(p=>p.type===type)!.value).join('-');}
