import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { success, error } from '@/lib/api-response'
import type { UserRole } from '@/lib/supabase/types'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token, password, first_name, last_name } = body

    if (!token || typeof token !== 'string') {
      return error('Invitation token is required', 400, 'VALIDATION_ERROR')
    }

    const supabase = await createSupabaseServerClient(request)

    // 1. Look up the invitation by token
    const { data: invitation, error: inviteError } = await supabase
      .from('invitations')
      .select(`
        id,
        email,
        role,
        token,
        organization_id,
        invited_by,
        expires_at,
        accepted_at,
        organization:organizations(id, name, slug)
      `)
      .eq('token', token)
      .single()

    if (inviteError || !invitation) {
      return error('Invalid invitation token', 404, 'NOT_FOUND')
    }

    // Check if already accepted
    if (invitation.accepted_at) {
      return error('This invitation has already been accepted', 410, 'ALREADY_ACCEPTED')
    }

    // Check expiry
    if (new Date(invitation.expires_at) < new Date()) {
      return error('This invitation has expired', 410, 'EXPIRED')
    }

    // 2. Check if a user with this email already exists
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('id, email')
      .eq('email', invitation.email)
      .single()

    let userId: string
    let session: any = null
    let authUser: any = null

    if (existingProfile) {
      // User exists — sign them in to get a session
      userId = existingProfile.id

      if (!password) {
        return error('Password is required to accept the invitation', 400, 'VALIDATION_ERROR')
      }

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: invitation.email,
        password,
      })

      if (signInError) {
        return error('Invalid password. Please provide the correct password for this account.', 401, 'AUTH_ERROR', signInError)
      }

      session = signInData.session
      authUser = signInData.user
    } else {
      // New user — sign them up
      if (!password || typeof password !== 'string' || password.length < 8) {
        return error('Password must be at least 8 characters long', 400, 'VALIDATION_ERROR')
      }

      if (!first_name || typeof first_name !== 'string' || first_name.trim().length === 0) {
        return error('First name is required', 400, 'VALIDATION_ERROR')
      }

      if (!last_name || typeof last_name !== 'string' || last_name.trim().length === 0) {
        return error('Last name is required', 400, 'VALIDATION_ERROR')
      }

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: invitation.email,
        password,
        options: {
          data: {
            first_name: first_name.trim(),
            last_name: last_name.trim(),
          },
        },
      })

      if (signUpError) {
        return error(signUpError.message, 400, 'AUTH_ERROR', signUpError)
      }

      if (!signUpData.user) {
        return error('Failed to create user account', 500, 'AUTH_ERROR')
      }

      userId = signUpData.user.id

      // Create user profile
      const { error: profileError } = await supabase
        .from('user_profiles')
        .insert({
          id: userId,
          first_name: first_name.trim(),
          last_name: last_name.trim(),
          email: invitation.email,
          is_active: true,
        })

      if (profileError) {
        return error('Failed to create user profile: ' + profileError.message, 500, 'PROFILE_ERROR', profileError)
      }

      session = signUpData.session
      authUser = signUpData.user
    }

    // 3. Add user to the organization
    const { error: memberError } = await supabase
      .from('organization_members')
      .insert({
        user_id: userId,
        organization_id: invitation.organization_id,
        role: invitation.role as UserRole,
        is_active: true,
        invited_by: invitation.invited_by,
        invited_at: invitation.created_at,
        joined_at: new Date().toISOString(),
      })

    if (memberError) {
      // Check for duplicate membership
      const memberMsg = memberError.message.toLowerCase()
      if (memberMsg.includes('duplicate') || memberMsg.includes('unique')) {
        // User is already a member — just mark invitation as accepted
      } else {
        return error('Failed to add member to organization: ' + memberError.message, 500, 'MEMBER_ERROR', memberError)
      }
    }

    // 4. Mark invitation as accepted
    await supabase
      .from('invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invitation.id)

    return success({
      user: {
        id: authUser.id,
        email: authUser.email,
        first_name: existingProfile ? undefined : first_name?.trim(),
        last_name: existingProfile ? undefined : last_name?.trim(),
      },
      session,
      organization: {
        id: invitation.organization!.id,
        name: invitation.organization!.name,
        slug: invitation.organization!.slug,
      },
    })
  } catch (e: any) {
    return error(e.message || 'An unexpected error occurred while accepting invitation', 500, 'INTERNAL_ERROR')
  }
}
