import {supabaseAdmin} from '@/lib/supabase/server';
import {signSettingsSchema} from './model';
// Called only after the caller has authorized organization-scoped creation.
// ON CONFLICT DO NOTHING preserves administrator choices, including a concurrent update.
export async function initializeSignSettings(organizationId:string){
 const db=supabaseAdmin();
 const inserted=await db.from('sign_settings').upsert({organization_id:organizationId,data:signSettingsSchema.parse({})},{onConflict:'organization_id',ignoreDuplicates:true});
 if(inserted.error)throw Error('Signing preferences could not be initialized');
 const result=await db.from('sign_settings').select('data').eq('organization_id',organizationId).single();
 if(result.error)throw Error('Signing preferences are unavailable');
 return signSettingsSchema.parse(result.data.data);
}
