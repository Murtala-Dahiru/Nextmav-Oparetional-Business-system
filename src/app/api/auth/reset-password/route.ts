import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { success, error } from '@/lib/api-response'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { password, token } = body

    if (!password || typeof password !== 'string' || password.length < 8) {
      return error('New password must be at least 8 characters long', 400, 'VALIDATION_ERROR')
    }

    const supabase = await createSupabaseServerClient(request)

    if (token) {
      // Verify the token and update password using admin API approach
      // Exchange the token for a session first
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: 'recovery',
      })

      if (verifyError || !verifyData.user) {
        return error('Invalid or expired reset token', 400, 'INVALID_TOKEN', verifyError)
      }

      // Now update the password with the active session
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      })

      if (updateError) {
        return error(updateError.message, 400, 'UPDATE_ERROR', updateError)
      }
    } else {
      // No token provided — try updating with current session (user is already logged in)
      const { data: { user }, error: sessionError } = await supabase.auth.getUser()

      if (sessionError || !user) {
        return error('No active session found. Please provide a valid reset token.', 401, 'UNAUTHORIZED')
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password,
      })

      if (updateError) {
        return error(updateError.message, 400, 'UPDATE_ERROR', updateError)
      }
    }

    return success({ message: 'Password updated successfully' })
  } catch (e: any) {
    return error(e.message || 'An unexpected error occurred while resetting password', 500, 'INTERNAL_ERROR')
  }
}
