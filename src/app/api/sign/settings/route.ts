import {NextResponse} from 'next/server';
import {signSettingsSchema} from '@/lib/sign/model';
import {authorize} from '@/lib/auth-context';
import {supabaseAdmin} from '@/lib/supabase/server';
import {mailConfigured,sameOrigin} from '@/lib/sign/server';
export async function GET(){const ctx=await authorize('crm','view');if(ctx instanceof Response)return ctx;const r=await ctx.supabase.from('sign_settings').select('data').eq('organization_id',ctx.org.organizationId).maybeSingle();if(r.error)return NextResponse.json({error:'Signing preferences are unavailable'},{status:503});return NextResponse.json({data:signSettingsSchema.parse(r.data?.data??{}),emailConfigured:mailConfigured(),scannerConfigured:!!process.env.SIGN_SCAN_URL});}
export async function POST(req:Request){const ctx=await authorize('crm','manage');if(ctx instanceof Response)return ctx;try{sameOrigin(req);const data=signSettingsSchema.parse(await req.json());const r=await supabaseAdmin().from('sign_settings').upsert({organization_id:ctx.org.organizationId,data});if(r.error)throw Error('Settings could not be saved');return NextResponse.json({data});}catch(e){return NextResponse.json({error:(e as Error).message},{status:422});}}
