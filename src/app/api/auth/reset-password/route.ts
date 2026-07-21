import { NextRequest } from 'next/server'
import { success, error } from '@/lib/api-response'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { password, token } = body

    if (!password || typeof password !== 'string' || password.length < 8) {
      return error('New password must be at least 8 characters long', 400, 'VALIDATION_ERROR')
    }

    if (!SUPABASE_URL) {
      return success({ message: 'Password updated successfully (demo mode)' })
    }

    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient(request)

    if (token) {
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: 'recovery',
      })

      if (verifyError || !verifyData.user) {
        return error('Invalid or expired reset token', 400, 'INVALID_TOKEN', verifyError)
      }

      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        return error(updateError.message, 400, 'UPDATE_ERROR', updateError)
      }
    } else {
      const { data: { user }, error: sessionError } = await supabase.auth.getUser()
      if (sessionError || !user) {
        return error('No active session found', 401, 'UNAUTHORIZED')
      }
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        return error(updateError.message, 400, 'UPDATE_ERROR', updateError)
      }
    }

    return success({ message: 'Password updated successfully' })
  } catch (e: any) {
    return error(e.message || 'Failed to reset password', 500, 'INTERNAL_ERROR')
  }
}