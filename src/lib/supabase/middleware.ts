import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getAuthenticatedUser } from './server'

const PUBLIC_ROUTES = [
  '/api/auth/',
  '/',
]

export async function authMiddleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  // Allow public routes
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route)) {
    return NextResponse.next()
  }
  
  // Allow static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.svg')
  ) {
    return NextResponse.next()
  }
  
  // API routes: return 401 instead of redirecting
  if (pathname.startsWith('/api/')) {
    const { user } = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json(
        { error: { message: 'Authentication required', code: 'AUTH_REQUIRED' } },
        { status: 401 }
      )
    }
    // Inject user info into headers for downstream API handlers
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-user-id', user.id)
    requestHeaders.set('x-org-id', user.organizationId || '')
    requestHeaders.set('x-user-role', user.role || 'employee')
    return NextResponse.next({
      request: { headers: requestHeaders },
    })
  }
  
  // Page routes: check auth and redirect to login
  const { user, cookies } = await getAuthenticatedUser(request)
  if (!user) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }
  
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-user-id', user.id)
  requestHeaders.set('x-org-id', user.organizationId || '')
  requestHeaders.set('x-user-role', user.role || 'employee')
  
  return NextResponse.next({
    request: { headers: requestHeaders },
  })
}

export function getUserFromRequest(request: NextRequest) {
  return {
    userId: request.headers.get('x-user-id') || '',
    orgId: request.headers.get('x-org-id') || '',
    role: request.headers.get('x-user-role') || 'employee',
  }
}