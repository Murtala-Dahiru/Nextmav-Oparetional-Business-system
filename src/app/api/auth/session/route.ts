import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { success, error } from '@/lib/api-response'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient(request)

    // Get current session user from Supabase
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return success({ user: null })
    }

    // Get user's active organization membership
    const { data: orgMember } = await supabase
      .from('organization_members')
      .select('organization_id, role, organization:organizations(name, slug)')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .is('organization_id', 'not.is', null)
      .single()

    return success({
      user: {
        id: user.id,
        email: user.email,
        aud: user.aud,
        role: user.role,
        created_at: user.created_at,
        orgId: orgMember?.organization_id || null,
        orgName: (orgMember?.organization as any)?.name || null,
        orgSlug: (orgMember?.organization as any)?.slug || null,
        role_name: orgMember?.role || 'employee',
      },
    })
  } catch (e: any) {
    return error(e.message || 'An unexpected error occurred while fetching session', 500, 'INTERNAL_ERROR')
  }
}