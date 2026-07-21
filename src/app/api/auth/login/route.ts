import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { success, error } from '@/lib/api-response'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = body

    // Validation
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return error('A valid email address is required', 400, 'VALIDATION_ERROR')
    }

    if (!password || typeof password !== 'string' || password.length === 0) {
      return error('Password is required', 400, 'VALIDATION_ERROR')
    }

    const supabase = await createSupabaseServerClient(request)

    // Sign in with email/password
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (authError) {
      return error(authError.message, 401, 'AUTH_ERROR', authError)
    }

    if (!authData.user || !authData.session) {
      return error('Failed to sign in', 401, 'AUTH_ERROR')
    }

    // Get user's active organization membership
    const { data: orgMember, error: memberError } = await supabase
      .from('organization_members')
      .select('organization_id, role, organization:organizations(name, slug)')
      .eq('user_id', authData.user.id)
      .eq('is_active', true)
      .is('organization_id', 'not.is', null)
      .single()

    // Set cookies
    const cookieStore = await cookies()
    cookieStore.set('sb-access-token', authData.session.access_token, {
      path: '/',
      maxAge: 3600, // 1 hour
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    })
    cookieStore.set('sb-refresh-token', authData.session.refresh_token, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    })

    const userResponse: Record<string, unknown> = {
      id: authData.user.id,
      email: authData.user.email,
      aud: authData.user.aud,
      role: authData.user.role,
      created_at: authData.user.created_at,
      orgId: orgMember?.organization_id || null,
      orgName: (orgMember?.organization as any)?.name || null,
      role_name: orgMember?.role || 'employee',
    }

    if (memberError) {
      // User exists but has no org membership — still return session
      return success({
        user: userResponse,
        session: authData.session,
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
      })
    }

    return success({
      user: userResponse,
      session: authData.session,
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
    })
  } catch (e: any) {
    return error(e.message || 'An unexpected error occurred during login', 500, 'INTERNAL_ERROR')
  }
}