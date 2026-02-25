# AgriSense (Next.js + Firebase)

AgriSense is a field-operations web app that combines AOI satellite analysis, reliability metadata, first-party ML recommendations, scenario simulation, and plot persistence.

## Quick start

1. `npm install`
2. Create `.env.local` with Firebase web config and server admin credentials.
3. Run `npm run dev`

## Important scripts

- `npm run dev`  
  Runs a startup guard on port `3000`, guarded `.next` cleanup, then `next dev -p 3000`.

- `npm run dev:doctor`  
  Prints port/process diagnostics for local Next.js sessions.

- `npm run clean:next -- --force`  
  Manual forced cleanup for `.next` and `functions/.next`.

- `npm run build`  
  Production build + copy `.next` into `functions/.next`.

## Environment variables (`.env.local`)

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GEMINI_API_KEY=
# Optional:
# GEMINI_MODEL=gemini-1.5-flash
# GEMINI_FALLBACK_MODELS=gemini-1.5-flash,gemini-1.5-flash-8b
# If GEMINI_API_KEY is not set, server falls back to NEXT_PUBLIC_GEMINI_API_KEY.
```

## Local recovery (when routes randomly show 404/500)

Symptoms:
- `/` or `/dashboard` returning `404`
- `/api/gemini` or `/api/terrain/fetch` returning `500`
- dev server unexpectedly running on `3001` while browser points at `3000`

Recovery:
1. Run `npm run dev:doctor` and identify the stale process on port `3000`.
2. Stop that PID.
3. Start a single dev server with `npm run dev`.

Avoid starting multiple local Next.js sessions for the same repo at once.

## Deployment notes

Target deployment is Vercel (and local Next.js dev).  
`npm run build` keeps compatibility with the `functions/.next` copy flow already in this repo.
