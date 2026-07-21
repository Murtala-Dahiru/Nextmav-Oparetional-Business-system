import { NextRequest } from 'next/server'
import { success, error } from '@/lib/api-response'

export async function POST(request: NextRequest) {
  try {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

    if (!SUPABASE_URL) {
      return success({ message: 'Logged out successfully' })
    }

    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient(request)
    const { error: signOutError } = await supabase.auth.signOut()

    if (signOutError) {
      return error(signOutError.message, 400, 'AUTH_ERROR', signOutError)
    }

    return success({ message: 'Logged out successfully' })
  } catch (e: any) {
    return error(e.message || 'Logout failed', 500, 'INTERNAL_ERROR')
  }
}