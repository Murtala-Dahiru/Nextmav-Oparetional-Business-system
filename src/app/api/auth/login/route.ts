import { NextRequest, NextResponse } from 'next/server'
import { success, error } from '@/lib/api-response'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = body

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return error('A valid email address is required', 400, 'VALIDATION_ERROR')
    }
    if (!password || typeof password !== 'string' || password.length === 0) {
      return error('Password is required', 400, 'VALIDATION_ERROR')
    }

    if (!SUPABASE_URL) {
      // Demo mode: accept any credentials, set a demo session cookie
      const res = NextResponse.json({
        data: { user: DEMO_USER, message: 'Logged in (demo mode)' },
      })
      res.cookies.set('nexuscorp-demo-session', 'true', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      })
      return res
    }

    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient(request)

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

    const { data: orgMember } = await supabase
      .from('organization_members')
      .select('organization_id, role, organization:organizations(name, slug)')
      .eq('user_id', authData.user.id)
      .eq('is_active', true)
      .single()

    return success({
      user: {
        id: authData.user.id,
        email: authData.user.email,
        firstName: authData.user.user_metadata?.first_name || '',
        lastName: authData.user.user_metadata?.last_name || '',
        avatarUrl: authData.user.user_metadata?.avatar_url || null,
        orgId: orgMember?.organization_id || null,
        orgName: (orgMember?.organization as any)?.name || null,
        role: orgMember?.role || 'employee',
        isActive: true,
      },
    })
  } catch (e: any) {
    return error(e.message || 'Login failed', 500, 'INTERNAL_ERROR')
  }
}