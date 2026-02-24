import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminDb, getAdminAuth } from '../../lib/firebaseAdmin'

export default async function handler(req: NextApiRequest, res: NextApiResponse){
  const db = getAdminDb()
  const auth = getAdminAuth()

  if (req.method === 'POST'){
    try{
      let idToken = (req.headers.authorization || '').replace('Bearer ','')
      if (!idToken && typeof req.body?.idToken === 'string') idToken = req.body.idToken
      if (!idToken) return res.status(401).json({ error: 'auth_required' })
      const decoded = await auth.verifyIdToken(idToken)
      const ownerUid = decoded.uid
      const { name, description, geojson, ndviStats, previewPng, locationName } = req.body || {}
      const createdAt = new Date().toISOString()

      const doc: any = { 
        name: name || locationName || 'Unnamed plot', 
        locationName: locationName || name || null, 
        description: description || '', 
        geojson: geojson || null, 
        ndviStats: ndviStats || null, 
        previewPng: previewPng || null, 
        ownerUid,
        createdAt 
      }

      const ref = await db.collection('plots').add(doc)
      return res.status(201).json({ id: ref.id })
    } catch (e:any){
      console.error('items POST error:', e?.message || e, e?.stack)
      if (String(e?.message || '').toLowerCase().includes('token') || String(e?.code || '').includes('auth')) {
        return res.status(401).json({ error: 'invalid_auth', message: 'Invalid or expired authentication token.' })
      }
      return res.status(500).json({ error: 'save_failed', message: e?.message || 'Unknown error' })
    }
  }

  if (req.method === 'GET'){
    try{
      const idToken = (req.headers.authorization || '').replace('Bearer ','')
      if (!idToken) return res.status(401).json({ error: 'auth_required' })
      const decoded = await auth.verifyIdToken(idToken)
      const ownerUid = decoded.uid
      const snap = await db.collection('plots').where('ownerUid','==', ownerUid).limit(200).get()
      const items = snap.docs
        .map(d=> ({ id: d.id, ...(d.data() as any) }))
        .sort((a: any, b: any) => {
          const left = typeof a?.createdAt === 'string' ? a.createdAt : ''
          const right = typeof b?.createdAt === 'string' ? b.createdAt : ''
          return right.localeCompare(left)
        })
        .slice(0, 100)
      return res.status(200).json({ items })
    } catch (e:any){
      console.error('items GET', e?.message || e)
      return res.status(401).json({ error: 'invalid_auth' })
    }
  }

  return res.status(405).end()
} 
