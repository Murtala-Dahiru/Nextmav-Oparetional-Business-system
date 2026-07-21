import { NextRequest } from 'next/server'
import { success, error } from '@/lib/api-response'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, first_name, last_name, organization_name } = body

    // Validation
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return error('A valid email address is required', 400, 'VALIDATION_ERROR')
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return error('Password must be at least 8 characters long', 400, 'VALIDATION_ERROR')
    }
    if (!first_name || typeof first_name !== 'string' || first_name.trim().length === 0) {
      return error('First name is required', 400, 'VALIDATION_ERROR')
    }
    if (!last_name || typeof last_name !== 'string' || last_name.trim().length === 0) {
      return error('Last name is required', 400, 'VALIDATION_ERROR')
    }

    if (!SUPABASE_URL) {
      // Demo mode: accept signup but return mock data
      return success({
        user: {
          id: 'demo-new-user',
          email: email.trim().toLowerCase(),
          first_name: first_name.trim(),
          last_name: last_name.trim(),
        },
        message: 'Account created (demo mode)',
      })
    }

    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient(request)

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          first_name: first_name.trim(),
          last_name: last_name.trim(),
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
    const orgName = organization_name?.trim() || `${first_name}'s Org`
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
      first_name: first_name.trim(),
      last_name: last_name.trim(),
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
        first_name: first_name.trim(),
        last_name: last_name.trim(),
      },
      session: authData.session,
      organization: { id: org.id, name: org.name, slug: org.slug },
    })
  } catch (e: any) {
    return error(e.message || 'Signup failed', 500, 'INTERNAL_ERROR')
  }
}