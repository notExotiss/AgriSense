import admin from 'firebase-admin'

class FirebaseAdminConfigError extends Error {
  code: string
  hint: string

  constructor(message: string, hint: string) {
    super(message)
    this.name = 'FirebaseAdminConfigError'
    this.code = 'firebase_admin_misconfigured'
    this.hint = hint
  }
}

let initState: 'idle' | 'ready' | 'failed' = 'idle'
let initError: Error | null = null

function normalizeServiceAccount(raw: string) {
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new FirebaseAdminConfigError(
      'FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.',
      'Use a single-line JSON string from your Firebase service account key.'
    )
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new FirebaseAdminConfigError(
      'FIREBASE_SERVICE_ACCOUNT_JSON is missing or invalid.',
      'Set FIREBASE_SERVICE_ACCOUNT_JSON to the full service account JSON.'
    )
  }

  const privateKeyRaw = String(parsed.private_key || '')
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n').trim()
  const hasValidPem = privateKey.startsWith('-----BEGIN PRIVATE KEY-----') && privateKey.endsWith('-----END PRIVATE KEY-----')
  if (!hasValidPem) {
    throw new FirebaseAdminConfigError(
      'Firebase private key is not in valid PEM format.',
      'Ensure private_key contains BEGIN/END markers and escaped newlines (\\\\n) in .env.'
    )
  }

  return {
    ...parsed,
    private_key: privateKey,
  }
}

function asConfigError(error: any) {
  if (error instanceof FirebaseAdminConfigError) return error
  const message = String(error?.message || error || 'Unknown Firebase Admin error')
  const lower = message.toLowerCase()
  if (lower.includes('pem') || lower.includes('private key') || lower.includes('credential')) {
    return new FirebaseAdminConfigError(
      message,
      'Rotate and re-add FIREBASE_SERVICE_ACCOUNT_JSON. Ensure private_key newline escaping is correct.'
    )
  }
  return error instanceof Error ? error : new Error(message)
}

function ensureInit() {
  if (initState === 'ready') return
  if (initState === 'failed' && initError) throw initError

  try {
    if (!admin.apps.length) {
      const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      if (rawServiceAccount) {
        const serviceAccount = normalizeServiceAccount(rawServiceAccount)
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: serviceAccount.project_id || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        })
      } else {
        admin.initializeApp()
      }
    }
    initState = 'ready'
    initError = null
  } catch (error: any) {
    initState = 'failed'
    initError = asConfigError(error)
    throw initError
  }
}

export function getAdminDb() {
  ensureInit()
  return admin.firestore()
}

export function getAdminAuth() {
  ensureInit()
  return admin.auth()
}
