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
    const email = body.email
    const password = body.password
    const firstName = (body.firstName || body.first_name || '').trim()
    const lastName = (body.lastName || body.last_name || '').trim()
    const organizationName = (body.organizationName || body.organization_name || '').trim()

    // Validation
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return error('A valid email address is required', 400, 'VALIDATION_ERROR')
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return error('Password must be at least 6 characters long', 400, 'VALIDATION_ERROR')
    }
    if (!firstName) {
      return error('First name is required', 400, 'VALIDATION_ERROR')
    }
    if (!lastName) {
      return error('Last name is required', 400, 'VALIDATION_ERROR')
    }

    if (!SUPABASE_URL) {
      // Demo mode: accept signup, set demo session cookie
      const res = NextResponse.json({
        data: {
          user: {
            ...DEMO_USER,
            firstName,
            lastName,
            email: email.trim().toLowerCase(),
            organizationName: organizationName || 'NexusCorp',
          },
          message: 'Account created (demo mode)',
        },
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

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
        },
      },
    })

    if (authError) {
      return error(authError.message, 400, 'AUTH_ERROR', authError)
    }

    if (!authData.user) {
      return error('Failed to create user account', 500, 'AUTH_ERROR')
    }

    const userId = authData.user.id
    const orgName = organizationName || `${firstName}'s Org`
    const orgSlug = orgName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

    // Create organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: orgName,
        slug: orgSlug,
        currency: 'USD',
        tax_rate: 0,
        invoice_prefix: 'INV',
        fiscal_year_start: '01-01',
      })
      .select()
      .single()

    if (orgError) {
      return error('Failed to create organization: ' + orgError.message, 500, 'ORG_ERROR', orgError)
    }

    // Create user profile
    await supabase.from('user_profiles').insert({
      id: userId,
      first_name: firstName,
      last_name: lastName,
      email: email.trim().toLowerCase(),
      is_active: true,
    })

    // Create organization member with owner role
    await supabase.from('organization_members').insert({
      user_id: userId,
      organization_id: org.id,
      role: 'owner',
      is_active: true,
      joined_at: new Date().toISOString(),
    })

    return success({
      user: {
        id: authData.user.id,
        email: authData.user.email,
        firstName,
        lastName,
      },
      session: authData.session,
      organization: { id: org.id, name: org.name, slug: org.slug },
    })
  } catch (e: any) {
    return error(e.message || 'Signup failed', 500, 'INTERNAL_ERROR')
  }
}