import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

export async function createSupabaseServerClient(request?: NextRequest) {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            // Write every cookie unconditionally. `@supabase/ssr` signals cookie
            // removal by emitting an empty value with `maxAge: 0`, so guarding on
            // a truthy value here would silently break sign-out.
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options as CookieOptions)
            }
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    },
  )
}

export async function getAuthenticatedUser(request?: NextRequest) {
  const supabase = await createSupabaseServerClient(request)
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, supabase }
  }

  // Get user's active org
  const { data: orgMember } = await supabase
    .from('organization_members')
    .select('organization_id, role, organization:organizations(name, slug)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .not('organization_id', 'is', null)
    .single()

  return {
    user: {
      ...user,
      organizationId: orgMember?.organization_id || null,
      organizationSlug: (orgMember as any)?.organization?.slug || null,
      organizationName: (orgMember as any)?.organization?.name || null,
      role: orgMember?.role || 'employee',
    },
    supabase,
  }
}