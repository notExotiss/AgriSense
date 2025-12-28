import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminDb, getAdminAuth } from '../../../lib/firebaseAdmin'

export default async function handler(req: NextApiRequest, res: NextApiResponse){
  if (req.method !== 'DELETE') return res.status(405).end()
  const db = getAdminDb()
  const auth = getAdminAuth()
  try{
    const { id } = req.query
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id required' })
    const idToken = (req.headers.authorization || '').replace('Bearer ','')
    if (!idToken) return res.status(401).json({ error: 'auth_required' })
    const decoded = await auth.verifyIdToken(idToken)
    const uid = decoded.uid
    const docRef = db.collection('plots').doc(id)
    const doc = await docRef.get()
    if (!doc.exists) return res.status(404).json({ error: 'not_found' })
    if (doc.data()?.ownerUid !== uid) return res.status(403).json({ error: 'forbidden' })
    await docRef.delete()
    return res.status(204).end()
  } catch(e:any){
    console.error('plot delete', e?.message || e)
    return res.status(500).json({ error: 'internal' })
  }
} 