import type { Auth, User } from 'firebase/auth'
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth'

function isRedirectFallbackError(code: string) {
  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/operation-not-supported-in-this-environment'
  )
}

export async function signInWithGoogle(auth: Auth): Promise<User | null> {
  if (auth.currentUser) return auth.currentUser

  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })

  await setPersistence(auth, browserLocalPersistence).catch(() => {
    // Ignore unsupported persistence edge cases.
  })

  try {
    const credential = await signInWithPopup(auth, provider)
    return credential.user
  } catch (error: any) {
    const code = String(error?.code || '')
    if (isRedirectFallbackError(code)) {
      await signInWithRedirect(auth, provider)
      return null
    }
    throw error
  }
}

export function mapGoogleSignInError(error: unknown) {
  const code = String((error as any)?.code || '')
  if (code === 'auth/unauthorized-domain') {
    return 'Google sign-in failed: add this app domain to Firebase Auth Authorized domains.'
  }
  if (code === 'auth/configuration-not-found') {
    return 'Google sign-in failed: enable Google provider in Firebase Auth.'
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Google sign-in failed: Google provider is disabled in Firebase Auth.'
  }
  if (code === 'auth/network-request-failed') {
    return 'Google sign-in failed due to a network error. Try again.'
  }
  return (error as any)?.message || 'Google sign-in failed.'
}
