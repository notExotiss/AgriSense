import type { NextApiRequest, NextApiResponse } from 'next'
import { clearMemoryCache } from '../../../lib/server/cache'
import { getAdminDb } from '../../../lib/firebaseAdmin'

async function clearCollection(collectionName: string, batchSize = 250) {
  const db = getAdminDb()
  let deleted = 0

  for (;;) {
    const snapshot = await db.collection(collectionName).limit(batchSize).get()
    if (snapshot.empty) break
    const batch = db.batch()
    snapshot.docs.forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
    deleted += snapshot.size
    if (snapshot.size < batchSize) break
  }

  return deleted
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Cache clear route is disabled in production.',
    })
  }

  const memoryCleared = clearMemoryCache()
  let firestoreCleared = 0
  let firestoreStatus: 'cleared' | 'skipped' = 'skipped'
  let warning: string | null = null

  try {
    firestoreCleared = await clearCollection('timeseries_cache')
    firestoreStatus = 'cleared'
  } catch (error: any) {
    warning = String(error?.message || error || 'Firestore cache clear failed')
  }

  return res.status(200).json({
    success: true,
    memoryCleared,
    firestoreStatus,
    firestoreCleared,
    warning,
  })
}

