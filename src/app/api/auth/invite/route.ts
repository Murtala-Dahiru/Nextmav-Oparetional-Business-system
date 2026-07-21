import { NextRequest } from 'next/server'
import { success, error } from '@/lib/api-response'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

const VALID_INVITE_ROLES = ['admin', 'manager', 'sales', 'hr', 'finance', 'marketing', 'support', 'employee']

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, organization_id, role } = body

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return error('A valid email address is required', 400, 'VALIDATION_ERROR')
    }
    if (!organization_id || typeof organization_id !== 'string') {
      return error('Organization ID is required', 400, 'VALIDATION_ERROR')
    }
    if (!role || !VALID_INVITE_ROLES.includes(role)) {
      return error(`Invalid role. Must be one of: ${VALID_INVITE_ROLES.join(', ')}`, 400, 'VALIDATION_ERROR')
    }

    if (!SUPABASE_URL) {
      return success({
        id: 'demo-invite-001',
        email: email.trim().toLowerCase(),
        role,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        message: 'Invitation created (demo mode)',
      })
    }

    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient(request)

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return error('Authentication required', 401, 'UNAUTHORIZED')
    }

    const { data: membership } = await supabase
      .from('organization_members')
      .select('id, role')
      .eq('user_id', user.id)
      .eq('organization_id', organization_id)
      .eq('is_active', true)
      .single()

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return error('Only owners and admins can send invitations', 403, 'FORBIDDEN')
    }

    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: invitation, error: inviteError } = await supabase
      .from('invitations')
      .insert({
        organization_id,
        email: email.trim().toLowerCase(),
        role,
        token,
        invited_by: user.id,
        expires_at: expiresAt,
      })
      .select('id, email, role, token, expires_at, created_at')
      .single()

    if (inviteError) {
      return error('Failed to create invitation: ' + inviteError.message, 500, 'INVITE_ERROR', inviteError)
    }

    return success(invitation)
  } catch (e: any) {
    return error(e.message || 'Failed to create invitation', 500, 'INTERNAL_ERROR')
  }
}