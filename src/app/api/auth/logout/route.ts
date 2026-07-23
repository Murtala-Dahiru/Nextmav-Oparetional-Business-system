import { NextRequest, NextResponse } from 'next/server'
import { success, error } from '@/lib/api-response'

export async function POST(request: NextRequest) {
  try {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

    if (!SUPABASE_URL) {
      // Demo mode: clear demo session cookie
      const res = NextResponse.json({
        data: { message: 'Logged out successfully' },
      })
      res.cookies.set('nexuscorp-demo-session', '', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 0, // Delete immediately
      })
      return res
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