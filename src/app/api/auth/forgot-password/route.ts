import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { success, error } from '@/lib/api-response'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email } = body

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return error('A valid email address is required', 400, 'VALIDATION_ERROR')
    }

    const supabase = await createSupabaseServerClient(request)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || ''}/reset-password`,
    })

    if (resetError) {
      return error(resetError.message, 400, 'AUTH_ERROR', resetError)
    }

    // Always return success to avoid email enumeration
    return success({ message: 'If an account with this email exists, a password reset link has been sent.' })
  } catch (e: any) {
    return error(e.message || 'An unexpected error occurred while sending reset email', 500, 'INTERNAL_ERROR')
  }
}
