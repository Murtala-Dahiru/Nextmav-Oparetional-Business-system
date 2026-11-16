import {NextRequest} from 'next/server';
import {createHmac} from 'node:crypto';
import {z} from 'zod';
import {supabaseAdmin} from '@/lib/supabase/server';
import {clientAddress} from '@/lib/rate-limit';
import {success,error,serverError} from '@/lib/api-response';
import {captureSubmissionSchema} from '@/lib/crm/capture';
import {issueCaptureChallenge,verifyCaptureChallenge} from '@/lib/crm/capture-challenge';
export const runtime='nodejs';
export async function GET(req:NextRequest){
 const id=req.nextUrl.searchParams.get('form');if(!z.uuid().safeParse(id).success)return error('Form not found',404);
 try{const secret=process.env.CRM_CAPTURE_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!secret)return error('Lead capture is not configured.',503);const r=await supabaseAdmin().rpc('crm_public_capture_form',{p_form:id});if(r.error)return error('Lead capture is temporarily unavailable.',503);if(!r.data)return error('Form not found',404);const response=success({...r.data,challenge:issueCaptureChallenge(secret,id!,r.data.version)});response.headers.set('Cache-Control','no-store');return response;}catch(e){return serverError(e,'Lead capture is unavailable.');}
}
export async function POST(req:NextRequest){
 if(!req.headers.get('content-type')?.startsWith('application/json'))return error('JSON is required',415);
 const origin=req.headers.get('origin');if(origin&&origin!==req.nextUrl.origin)return error('Use the hosted capture form.',403);
 if(Number(req.headers.get('content-length')??0)>24000)return error('Submission is too large',413);
 let raw:unknown;try{
  const reader=req.body?.getReader();if(!reader)return error('Missing submission',422);
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>24000){await reader.cancel();return error('Submission is too large',413);}chunks.push(part.value);}
  raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }catch{return error('Invalid submission',422);}
 const parsed=captureSubmissionSchema.safeParse(raw);if(!parsed.success)return error('Complete the required fields and consent.',422);
 const p=parsed.data;if(p.website)return success({accepted:true});
 const secret=process.env.CRM_CAPTURE_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!secret)return error('Lead capture is not configured.',503);
 const challenge=verifyCaptureChallenge(secret,p.challenge,p.formId);if(!challenge)return error('The form session expired or was submitted too quickly. Reload the form and try again.',422);
 try{const addressHash=createHmac('sha256',secret).update(clientAddress(req)??'unknown-address').digest('hex');const r=await supabaseAdmin().rpc('crm_submit_capture',{p_form:p.formId,p_version:challenge.version,p_request:challenge.nonce,p_values:p.values,p_consent:true,p_address_hash:addressHash});if(r.error)return error('Your enquiry could not be saved. Please try again.',503);if(r.data==='limited')return error('Too many enquiries. Please try again later.',429);if(r.data==='unavailable')return error('This form is no longer accepting enquiries.',404);if(r.data==='changed')return error('This form has changed. Reload it before submitting.',409);if(r.data!=='accepted')return error('Check the form fields and contact details.',422);return success({accepted:true});}catch(e){return serverError(e,'Your enquiry could not be saved.');}
}
