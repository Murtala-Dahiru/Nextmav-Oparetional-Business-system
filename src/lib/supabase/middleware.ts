import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ROUTES = [
  '/api/auth/',
  '/',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/terms',
  '/privacy',
  '/cookies',
  '/pricing',
  '/features',
  '/about',
  '/contact',
]

export async function authMiddleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public routes
  if (PUBLIC_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'))) {
    return NextResponse.next()
  }

  // Allow static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.woff') ||
    pathname.endsWith('.woff2')
  ) {
    return NextResponse.next()
  }

  // For now, allow all routes through since we use SQLite/Prisma as primary DB
  // Auth middleware will be fully enforced once Supabase is connected
  return NextResponse.next()
}

export function getUserFromRequest(request: NextRequest) {
  return {
    userId: request.headers.get('x-user-id') || '',
    orgId: request.headers.get('x-org-id') || '',
    role: request.headers.get('x-user-role') || 'employee',
  }
}