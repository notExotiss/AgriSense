# FreshTag (Next.js + Gemini + Firebase)

Quick start:

1. npm install
2. Create `.env.local` with Firebase web config, Gemini key, and FIREBASE_SERVICE_ACCOUNT_JSON.
3. npm run dev

Important env vars (.env.local):

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
NEXT_PUBLIC_GEMINI_API_KEY=
```

Deploy to Firebase Hosting + Functions (SSR):
- Ensure `firebase.json` rewrites to `nextjsServer` and functions runtime is set.
- Build: `npm run build`
- Deploy: `firebase deploy --only "functions,hosting"` 