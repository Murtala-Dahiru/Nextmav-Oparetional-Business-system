import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function createSupabaseServerClient(request: NextRequest) {
  const cookieStore = await cookies()
  
  const token = cookieStore.get('sb-access-token')
  const refreshToken = cookieStore.get('sb-refresh-token')
  
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          const cookies: Record<string, string> = {}
          if (token) cookies['sb-access-token'] = token.value
          if (refreshToken) cookies['sb-refresh-token'] = refreshToken.value
          return cookies
        },
        setAll(cookiesToSet) {
          try {
            for (const [key, value] of Object.entries(cookiesToSet)) {
              if (value) cookieStore.set(key, value, {
                path: '/',
                maxAge: key === 'sb-access-token' ? 3600 : 60 * 60 * 24 * 365,
                httpOnly: true,
                sameSite: 'lax' as const,
                secure: process.env.NODE_ENV === 'production',
              })
            }
          } catch {}
        },
        remove(names) {
          try {
            for (const name of names) {
              cookieStore.delete(name)
            }
          } catch {}
        },
      },
    },
  )
}

export async function getAuthenticatedUser(request: NextRequest) {
  const { supabase, cookies } = await createSupabaseServerClient(request)
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { user: null, supabase, cookies }
  }
  
  // Get user's active org
  const { data: orgMember } = await supabase
    .from('organization_members')
    .select('organization_id, role, organization:organizations(name, slug)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .is('organization_id', 'not.is', null)
    .single()
  
  return {
    user: {
      ...user,
      organizationId: orgMember?.organization_id || null,
      organizationSlug: orgMember?.organization?.slug || null,
      organizationName: orgMember?.organization?.name || null,
      role: orgMember?.role || 'employee',
    },
    supabase,
    cookies,
  }
}