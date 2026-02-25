import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const GATE_COOKIE = 'agrisense_workspace_gate'

export function middleware(request: NextRequest) {
  const gate = request.cookies.get(GATE_COOKIE)?.value === '1'
  if (gate) return NextResponse.next()

  const redirectUrl = request.nextUrl.clone()
  const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`
  redirectUrl.pathname = '/'
  redirectUrl.searchParams.set('next', nextPath)
  return NextResponse.redirect(redirectUrl)
}

export const config = {
  matcher: ['/dashboard/:path*', '/plots/:path*', '/account/:path*', '/ingest/:path*'],
}
