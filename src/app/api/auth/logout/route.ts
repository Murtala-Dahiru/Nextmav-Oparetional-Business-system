import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { success, error } from '@/lib/api-response'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient(request)

    // Sign out from Supabase
    const { error: signOutError } = await supabase.auth.signOut()

    if (signOutError) {
      return error(signOutError.message, 400, 'AUTH_ERROR', signOutError)
    }

    // Clear cookies
    const cookieStore = await cookies()
    try {
      cookieStore.delete('sb-access-token')
      cookieStore.delete('sb-refresh-token')
    } catch {
      // Cookie deletion can fail in certain contexts (e.g., middleware)
    }

    return success({ message: 'Logged out successfully' })
  } catch (e: any) {
    return error(e.message || 'An unexpected error occurred during logout', 500, 'INTERNAL_ERROR')
  }
}