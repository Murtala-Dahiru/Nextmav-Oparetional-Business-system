import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
export function issueCaptureChallenge(secret:string,formId:string,version:number,now=Date.now()){
 const payload=Buffer.from(JSON.stringify({formId,version,nonce:randomUUID(),issued:now})).toString('base64url');
 return `${payload}.${createHmac('sha256',secret).update(payload).digest('base64url')}`;
}
export function verifyCaptureChallenge(secret:string,token:string,formId:string,now=Date.now()):{nonce:string;version:number}|null{
 try{const [payload,signature,...extra]=token.split('.');if(!payload||!signature||extra.length)return null;const expected=createHmac('sha256',secret).update(payload).digest();const actual=Buffer.from(signature,'base64url');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;const value=JSON.parse(Buffer.from(payload,'base64url').toString());if(value.formId!==formId||!Number.isInteger(value.version)||typeof value.issued!=='number'||now-value.issued<2000||now-value.issued>1800000)return null;return{nonce:value.nonce,version:value.version};}catch{return null;}
}
