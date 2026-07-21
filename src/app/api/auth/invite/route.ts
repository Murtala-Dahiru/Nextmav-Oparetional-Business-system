import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { success, error } from '@/lib/api-response'
import type { UserRole } from '@/lib/supabase/types'

const VALID_INVITE_ROLES: UserRole[] = [
  'admin', 'manager', 'sales', 'hr', 'finance', 'marketing', 'support', 'employee',
]

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, organization_id, role } = body

    // Validation
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return error('A valid email address is required', 400, 'VALIDATION_ERROR')
    }

    if (!organization_id || typeof organization_id !== 'string') {
      return error('Organization ID is required', 400, 'VALIDATION_ERROR')
    }

    if (!role || typeof role !== 'string' || !VALID_INVITE_ROLES.includes(role as UserRole)) {
      return error(`Invalid role. Must be one of: ${VALID_INVITE_ROLES.join(', ')}`, 400, 'VALIDATION_ERROR')
    }

    const supabase = await createSupabaseServerClient(request)

    // Verify the requesting user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return error('Authentication required', 401, 'UNAUTHORIZED')
    }

    // Verify the user has permission to invite to this organization
    const { data: membership, error: memberCheckError } = await supabase
      .from('organization_members')
      .select('id, role')
      .eq('user_id', user.id)
      .eq('organization_id', organization_id)
      .eq('is_active', true)
      .single()

    if (memberCheckError || !membership) {
      return error('You do not have access to this organization', 403, 'FORBIDDEN')
    }

    // Only owners and admins can invite
    if (!['owner', 'admin'].includes(membership.role)) {
      return error('Only owners and admins can send invitations', 403, 'FORBIDDEN')
    }

    // Check if the email is already a member of this organization
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .single()

    if (existingProfile) {
      const { data: existingMember } = await supabase
        .from('organization_members')
        .select('id')
        .eq('user_id', existingProfile.id)
        .eq('organization_id', organization_id)
        .eq('is_active', true)
        .single()

      if (existingMember) {
        return error('This user is already a member of the organization', 409, 'ALREADY_MEMBER')
      }
    }

    // Create invitation record
    const token = crypto.randomUUID()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7) // 7 days expiry

    const { data: invitation, error: inviteError } = await supabase
      .from('invitations')
      .insert({
        organization_id,
        email: email.trim().toLowerCase(),
        role: role as UserRole,
        token,
        invited_by: user.id,
        expires_at: expiresAt.toISOString(),
      })
      .select(`
        id,
        email,
        role,
        token,
        expires_at,
        created_at,
        organization:organizations(name, slug),
        inviter:user_profiles(first_name, last_name)
      `)
      .single()

    if (inviteError) {
      return error('Failed to create invitation: ' + inviteError.message, 500, 'INVITE_ERROR', inviteError)
    }

    // Send invite email via Supabase
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
      await supabase.auth.admin.inviteUserByEmail(email.trim().toLowerCase(), {
        redirectTo: `${appUrl}/accept-invite?token=${token}`,
      })
    } catch {
      // Email sending failure is non-critical — the invitation record exists
      // and can be shared manually if needed
    }

    return success({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expires_at: invitation.expires_at,
      created_at: invitation.created_at,
      organization: invitation.organization,
      inviter: invitation.inviter,
    })
  } catch (e: any) {
    return error(e.message || 'An unexpected error occurred while creating invitation', 500, 'INTERNAL_ERROR')
  }
}
