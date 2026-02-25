import type { NextApiRequest, NextApiResponse } from 'next'

const GATE_COOKIE = 'agrisense_workspace_gate'

function safeNextPath(value: unknown) {
  const raw = String(value || '/dashboard').trim()
  if (!raw.startsWith('/')) return '/dashboard'
  if (raw.startsWith('//')) return '/dashboard'
  if (raw.startsWith('/api/')) return '/dashboard'
  return raw
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const next = safeNextPath(req.query.next)
  const secure = process.env.NODE_ENV === 'production' ? 'Secure; ' : ''
  res.setHeader(
    'Set-Cookie',
    `${GATE_COOKIE}=1; Path=/; ${secure}SameSite=Lax`
  )
  res.writeHead(307, { Location: next })
  res.end()
}
