import { NextRequest } from 'next/server'
import { success, error } from '@/lib/api-response'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token, password, first_name, last_name } = body

    if (!token || typeof token !== 'string') {
      return error('Invitation token is required', 400, 'VALIDATION_ERROR')
    }

    if (!SUPABASE_URL) {
      return success({
        message: 'Invitation accepted (demo mode)',
        organization: { id: 'demo-org-001', name: 'NexusCorp', slug: 'nexuscorp' },
      })
    }

    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient(request)

    const { data: invitation, error: inviteError } = await supabase
      .from('invitations')
      .select('id, email, role, token, organization_id, invited_by, expires_at, accepted_at, created_at, organization:organizations(id, name, slug)')
      .eq('token', token)
      .single()

    if (inviteError || !invitation) {
      return error('Invalid invitation token', 404, 'NOT_FOUND')
    }
    if (invitation.accepted_at) {
      return error('This invitation has already been accepted', 410, 'ALREADY_ACCEPTED')
    }
    if (new Date(invitation.expires_at) < new Date()) {
      return error('This invitation has expired', 410, 'EXPIRED')
    }

    // Check if user exists
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('id, email')
      .eq('email', invitation.email)
      .single()

    let userId: string
    let authUser: any = null

    if (existingProfile) {
      userId = existingProfile.id
      if (password) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: invitation.email, password,
        })
        if (signInError) return error('Invalid password', 401, 'AUTH_ERROR', signInError)
        authUser = signInData.user
      }
    } else {
      if (!password || password.length < 8) return error('Password must be at least 8 characters', 400, 'VALIDATION_ERROR')
      if (!first_name?.trim()) return error('First name is required', 400, 'VALIDATION_ERROR')
      if (!last_name?.trim()) return error('Last name is required', 400, 'VALIDATION_ERROR')

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: invitation.email, password,
        options: { data: { first_name: first_name.trim(), last_name: last_name.trim() } },
      })
      if (signUpError) return error(signUpError.message, 400, 'AUTH_ERROR', signUpError)
      if (!signUpData.user) return error('Failed to create account', 500, 'AUTH_ERROR')

      userId = signUpData.user.id
      authUser = signUpData.user

      await supabase.from('user_profiles').insert({
        id: userId, first_name: first_name.trim(), last_name: last_name.trim(),
        email: invitation.email, is_active: true,
      })
    }

    // Add to org
    // A PostgrestFilterBuilder is thenable but not a Promise, so it has no
    // `.catch`. Await it and inspect the returned error instead; a duplicate
    // membership row is expected and safe to ignore.
    const { error: memberError } = await supabase.from('organization_members').insert({
      user_id: userId, organization_id: invitation.organization_id,
      role: invitation.role, is_active: true,
      invited_by: invitation.invited_by, invited_at: invitation.created_at,
      joined_at: new Date().toISOString(),
    })
    if (memberError && memberError.code !== '23505') {
      return error('Failed to add you to the organization', 500, 'INTERNAL_ERROR', memberError)
    }

    // Mark accepted
    await supabase.from('invitations').update({ accepted_at: new Date().toISOString() }).eq('id', invitation.id)

    return success({
      user: { id: authUser?.id || userId, email: invitation.email },
      organization: (invitation.organization as any),
    })
  } catch (e: any) {
    return error(e.message || 'Failed to accept invitation', 500, 'INTERNAL_ERROR')
  }
}