import { NextRequest } from 'next/server'
import { success, error } from '@/lib/api-response'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

// Demo user returned when Supabase is not configured
const DEMO_USER = {
  id: 'demo-user-001',
  email: 'admin@nexuscorp.io',
  firstName: 'Alex',
  lastName: 'Morgan',
  avatarUrl: null,
  jobTitle: 'Platform Administrator',
  department: 'Engineering',
  organizationId: 'demo-org-001',
  organizationName: 'NexusCorp',
  organizationSlug: 'nexuscorp',
  role: 'super_admin',
  isActive: true,
}

export async function GET(request: NextRequest) {
  try {
    // If no Supabase configured, resolve the acting user from the session
    // cookie. The role comes from the database, never from the client.
    if (!SUPABASE_URL) {
      const { getActingUser } = await import('@/lib/auth-context')
      const { capabilitySummary } = await import('@/lib/permissions')

      const acting = await getActingUser()
      if (!acting) return success({ user: null })

      return success({
        user: {
          ...acting,
          // Mirror of server truth, so navigation and affordances match what
          // the API will actually allow. Rendering only — never an access
          // decision.
          capabilities: capabilitySummary(acting.role),
        },
      })
    }

    // Dynamic import to avoid crash when env vars are empty
    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient(request)

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return success({ user: null })
    }

    const { data: orgMember } = await supabase
      .from('organization_members')
      .select('organization_id, role, organization:organizations(name, slug)')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .not('organization_id', 'is', null)
      .single()

    return success({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.user_metadata?.first_name || '',
        lastName: user.user_metadata?.last_name || '',
        avatarUrl: user.user_metadata?.avatar_url || null,
        jobTitle: user.user_metadata?.job_title || null,
        department: user.user_metadata?.department || null,
        orgId: orgMember?.organization_id || null,
        orgName: (orgMember?.organization as any)?.name || null,
        orgSlug: (orgMember?.organization as any)?.slug || null,
        role: orgMember?.role || 'employee',
        isActive: true,
      },
    })
  } catch (e: any) {
    // If Supabase connection fails, fall back to checking demo cookie
    console.warn('Session check failed:', e.message)
    const hasDemoSession = request.cookies.get('nexuscorp-demo-session')?.value === 'true'
    if (hasDemoSession) {
      return success({ user: DEMO_USER })
    }
    return success({ user: null })
  }
}