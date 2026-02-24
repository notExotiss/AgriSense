import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

function hasRequiredFirebaseConfig(config: Record<string, string | undefined>) {
  return Object.values(config).every((value) => typeof value === 'string' && value.length > 0)
}

const firebaseClientConfigured = hasRequiredFirebaseConfig(firebaseConfig)
const canUseClientFirebase = typeof window !== 'undefined' && firebaseClientConfigured

export function getFirebaseApp(): FirebaseApp | null {
  if (!canUseClientFirebase) return null
  return getApps().length ? getApp() : initializeApp(firebaseConfig as any)
}

let cachedAuth: Auth | null = null

export function getFirebaseAuth(): Auth | null {
  if (!canUseClientFirebase) return null
  if (cachedAuth) return cachedAuth
  const app = getFirebaseApp()
  if (!app) return null
  cachedAuth = getAuth(app)
  return cachedAuth
}

export const app = getFirebaseApp()
export const auth = getFirebaseAuth()
export const isFirebaseClientConfigured = firebaseClientConfigured
