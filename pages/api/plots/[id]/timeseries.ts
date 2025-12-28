import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminDb, getAdminAuth } from '../../../../lib/firebaseAdmin'

export default async function handler(req: NextApiRequest, res: NextApiResponse){
  const db = getAdminDb()
  const auth = getAdminAuth()
  const { id } = req.query
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id required' })

  if (req.method === 'GET'){
    try{
      const idToken = (req.headers.authorization || '').replace('Bearer ','')
      if (!idToken) return res.status(401).json({ error: 'auth_required' })
      const decoded = await auth.verifyIdToken(idToken)
      const ownerUid = decoded.uid
      // Check plot ownership
      const plotDoc = await db.collection('plots').doc(id).get()
      if (!plotDoc.exists) return res.status(404).json({ error: 'not_found' })
      if (plotDoc.data()?.ownerUid !== ownerUid) return res.status(403).json({ error: 'forbidden' })

      const qs = await db.collection('plots').doc(id).collection('series').orderBy('date','asc').get()
      const items = qs.docs.map(d=> ({ id: d.id, ...(d.data() as any) }))
      return res.status(200).json({ items })
    } catch(e:any){
      console.error('timeseries GET', e?.message || e)
      return res.status(500).json({ error: 'internal' })
    }
  }

  if (req.method === 'POST'){
    try{
      const idToken = (req.headers.authorization || '').replace('Bearer ','')
      if (!idToken) return res.status(401).json({ error: 'auth_required' })
      const decoded = await auth.verifyIdToken(idToken)
      const ownerUid = decoded.uid

      const plotDoc = await db.collection('plots').doc(id).get()
      if (!plotDoc.exists) return res.status(404).json({ error: 'not_found' })
      if (plotDoc.data()?.ownerUid !== ownerUid) return res.status(403).json({ error: 'forbidden' })

      const { date, ndviStats } = req.body || {}
      if (!date || !ndviStats) return res.status(400).json({ error: 'date and ndviStats required' })
      const entry = { date, ndviStats }
      const ref = await db.collection('plots').doc(id).collection('series').add(entry)
      return res.status(201).json({ id: ref.id })
    } catch(e:any){
      console.error('timeseries POST', e?.message || e)
      return res.status(500).json({ error: 'internal' })
    }
  }

  return res.status(405).end()
} 