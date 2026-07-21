import { NextRequest } from 'next/server'
import { success, error } from '@/lib/api-response'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email } = body

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return error('A valid email address is required', 400, 'VALIDATION_ERROR')
    }

    if (!SUPABASE_URL) {
      // Always return success to avoid email enumeration
      return success({ message: 'If an account with this email exists, a password reset link has been sent.' })
    }

    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient(request)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || ''}/reset-password`,
    })

    if (resetError) {
      return error(resetError.message, 400, 'AUTH_ERROR', resetError)
    }

    return success({ message: 'If an account with this email exists, a password reset link has been sent.' })
  } catch (e: any) {
    return error(e.message || 'Failed to send reset email', 500, 'INTERNAL_ERROR')
  }
}