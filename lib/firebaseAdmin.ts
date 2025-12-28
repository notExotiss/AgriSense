import admin from 'firebase-admin'

let initialized = false

function ensureInit(){
  if (initialized) return
  if (!admin.apps.length){
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    if (sa){
      const serviceAccount = JSON.parse(sa)
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      })
    } else {
      admin.initializeApp()
    }
  }
  initialized = true
}

export function getAdminDb(){
  ensureInit()
  return admin.firestore()
}

export function getAdminAuth(){
  ensureInit()
  return admin.auth()
} 