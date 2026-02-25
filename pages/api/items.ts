import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminDb, getAdminAuth } from '../../lib/firebaseAdmin'
import { decodePolygonGeometry, deriveBboxFromPolygon, serializePolygonGeometry } from '../../lib/server/geometry'
import type { GridCellSummary } from '../../lib/types/api'

function toString(value: unknown) {
  return String(value || '')
}

function isAdminConfigError(error: any) {
  const code = toString(error?.code)
  return code === 'firebase_admin_misconfigured' || toString(error?.name) === 'FirebaseAdminConfigError'
}

function sanitizeGrid3x3(value: any): GridCellSummary[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, 9)
    .map((cell: any, index) => {
      const row = Number(cell?.row)
      const col = Number(cell?.col)
      const id = `${Number.isFinite(row) ? row : Math.floor(index / 3)}-${Number.isFinite(col) ? col : index % 3}`
      const mean = Number(cell?.mean)
      const min = Number(cell?.min)
      const max = Number(cell?.max)
      const validPixelRatio = Number(cell?.validPixelRatio)
      const stressLevelRaw = String(cell?.stressLevel || '').toLowerCase()
      const stressLevel =
        stressLevelRaw === 'high' || stressLevelRaw === 'moderate' || stressLevelRaw === 'low'
          ? stressLevelRaw
          : 'unknown'
      return {
        cellId: String(cell?.cellId || id),
        row: Number.isFinite(row) ? row : Math.floor(index / 3),
        col: Number.isFinite(col) ? col : index % 3,
        mean: Number.isFinite(mean) ? mean : 0,
        min: Number.isFinite(min) ? min : 0,
        max: Number.isFinite(max) ? max : 0,
        validPixelRatio: Number.isFinite(validPixelRatio) ? validPixelRatio : 0,
        stressLevel,
      } as GridCellSummary
    })
}

function sanitizeForFirestore(value: any): any {
  if (value === undefined) return undefined
  if (value === null) return null

  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()

  if (Array.isArray(value)) {
    const mapped = value
      .map((item) => sanitizeForFirestore(item))
      .filter((item) => item !== undefined)
    return mapped
  }

  if (typeof value === 'object') {
    const output: Record<string, any> = {}
    for (const [key, raw] of Object.entries(value)) {
      const sanitized = sanitizeForFirestore(raw)
      if (sanitized !== undefined) output[key] = sanitized
    }
    return output
  }

  return undefined
}

function compactInferenceSnapshot(raw: any) {
  if (!raw || typeof raw !== 'object') return null
  const recommendations = Array.isArray(raw.recommendations) ? raw.recommendations.slice(0, 3) : []
  return sanitizeForFirestore({
    engine: raw.engine || null,
    objective: raw.objective || null,
    confidence: raw.confidence ?? null,
    dataQuality: raw.dataQuality || null,
    forecast: raw.forecast || null,
    anomaly: raw.anomaly || null,
    summary: raw.summary || null,
    recommendations,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.slice(0, 12) : [],
    timestamp: new Date().toISOString(),
  })
}

function approximateSizeBytes(value: any) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function isPayloadTooLarge(error: any) {
  const message = toString(error?.message).toLowerCase()
  return (
    message.includes('maximum document size') ||
    message.includes('too large') ||
    message.includes('exceeds the limit') ||
    message.includes('request entity too large')
  )
}

function isInvalidFirestorePayload(error: any) {
  const message = toString(error?.message).toLowerCase()
  return (
    message.includes('cannot use "undefined" as a firestore value') ||
    message.includes('contains undefined') ||
    message.includes('invalid firestore value')
  )
}

function isInvalidGeometryError(error: any) {
  const message = toString(error?.message).toLowerCase()
  return message.includes('invalid_geometry')
}

export default async function handler(req: NextApiRequest, res: NextApiResponse){
  if (req.method === 'POST'){
    try{
      const db = getAdminDb()
      const auth = getAdminAuth()
      let idToken = (req.headers.authorization || '').replace('Bearer ','')
      if (!idToken && typeof req.body?.idToken === 'string') idToken = req.body.idToken
      if (!idToken) return res.status(401).json({ error: 'auth_required' })
      const decoded = await auth.verifyIdToken(idToken)
      const ownerUid = decoded.uid
      const { name, description, geojson, ndviStats, previewPng, locationName, inferenceSnapshot, sourceQuality, grid3x3 } = req.body || {}
      const createdAt = new Date().toISOString()
      const safeName = String(name || locationName || '').trim()
      if (!safeName) return res.status(400).json({ error: 'validation_failed', message: 'Plot name is required.' })

      const serializedGeometry = geojson ? serializePolygonGeometry(geojson) : null

      const safePreviewPng = typeof previewPng === 'string' ? previewPng : null
      const previewTooLarge = Boolean(safePreviewPng && safePreviewPng.length > 700_000)
      const compactInference = compactInferenceSnapshot(inferenceSnapshot)
      const safeGrid3x3 = sanitizeGrid3x3(grid3x3)
      const compactSourceQuality = sanitizeForFirestore({
        ingestProvider: sourceQuality?.ingestProvider || null,
        fallbackUsed: Boolean(sourceQuality?.fallbackUsed),
        warnings: Array.isArray(sourceQuality?.warnings) ? sourceQuality.warnings.slice(0, 20) : [],
        providersTried: Array.isArray(sourceQuality?.providersTried)
          ? sourceQuality.providersTried.slice(0, 20).map((provider: any) => ({
              provider: provider?.provider || 'unknown',
              ok: Boolean(provider?.ok),
              reason: provider?.reason ? String(provider.reason).slice(0, 240) : null,
            }))
          : [],
      })

      const doc: any = { 
        name: safeName, 
        locationName: String(locationName || name || '').slice(0, 180) || null, 
        description: String(description || '').slice(0, 5000), 
        geojsonText: serializedGeometry?.geojsonText || null,
        geojson: null,
        bbox: serializedGeometry?.bbox || null,
        centroid: serializedGeometry?.centroid || null,
        ringsFlat: serializedGeometry?.ringsFlat || null,
        grid3x3: safeGrid3x3,
        ndviStats: sanitizeForFirestore(ndviStats || null), 
        previewPng: previewTooLarge ? null : safePreviewPng, 
        inferenceSnapshot: compactInference,
        sourceQuality: compactSourceQuality,
        previewDropped: previewTooLarge,
        ownerUid,
        createdAt 
      }

      const sanitizedDoc = sanitizeForFirestore(doc)
      const payloadBytes = approximateSizeBytes(sanitizedDoc)
      if (payloadBytes > 900_000) {
        return res.status(413).json({
          error: 'plot_payload_too_large',
          message: 'Plot payload is too large to store. Reduce optional data and retry.',
        })
      }

      const ref = await db.collection('plots').add(sanitizedDoc)
      return res.status(201).json({ id: ref.id, previewDropped: previewTooLarge })
    } catch (e:any){
      console.error('items POST error:', e?.message || e, e?.stack)
      if (isAdminConfigError(e)) {
        return res.status(503).json({
          error: 'firebase_admin_misconfigured',
          message: 'Server Firebase Admin credentials are not configured correctly.',
          hint: e?.hint || 'Set FIREBASE_SERVICE_ACCOUNT_JSON with a valid private key and escaped newlines.',
        })
      }
      if (String(e?.message || '').toLowerCase().includes('token') || String(e?.code || '').includes('auth')) {
        return res.status(401).json({ error: 'invalid_auth', message: 'Invalid or expired authentication token.' })
      }
      if (isInvalidGeometryError(e)) {
        return res.status(400).json({
          error: 'invalid_geometry',
          message: 'Geometry must be a valid closed polygon with finite coordinates.',
        })
      }
      if (isPayloadTooLarge(e)) {
        return res.status(413).json({ error: 'plot_payload_too_large', message: 'Plot payload exceeded storage limits.' })
      }
      if (isInvalidFirestorePayload(e)) {
        return res.status(400).json({ error: 'invalid_payload', message: 'Plot payload includes unsupported values.' })
      }
      return res.status(500).json({ error: 'save_failed', message: e?.message || 'Unknown error' })
    }
  }

  if (req.method === 'GET'){
    try{
      const db = getAdminDb()
      const auth = getAdminAuth()
      const idToken = (req.headers.authorization || '').replace('Bearer ','')
      if (!idToken) return res.status(401).json({ error: 'auth_required' })
      const decoded = await auth.verifyIdToken(idToken)
      const ownerUid = decoded.uid
      const snap = await db.collection('plots').where('ownerUid','==', ownerUid).limit(200).get()
      const items = snap.docs
        .map((d) => {
          const raw = d.data() as any
          const geojson = decodePolygonGeometry(raw?.geojson) || decodePolygonGeometry(raw?.geojsonText)
          const bbox =
            Array.isArray(raw?.bbox) && raw.bbox.length === 4
              ? raw.bbox
              : deriveBboxFromPolygon(geojson)
          return {
            id: d.id,
            ...raw,
            geojson: geojson || null,
            bbox: bbox || null,
          }
        })
        .sort((a: any, b: any) => {
          const left = typeof a?.createdAt === 'string' ? a.createdAt : ''
          const right = typeof b?.createdAt === 'string' ? b.createdAt : ''
          return right.localeCompare(left)
        })
        .slice(0, 100)
      return res.status(200).json({ items })
    } catch (e:any){
      console.error('items GET', e?.message || e)
      if (isAdminConfigError(e)) {
        return res.status(503).json({
          error: 'firebase_admin_misconfigured',
          message: 'Server Firebase Admin credentials are not configured correctly.',
          hint: e?.hint || 'Set FIREBASE_SERVICE_ACCOUNT_JSON with a valid private key and escaped newlines.',
        })
      }
      if (String(e?.message || '').toLowerCase().includes('token') || String(e?.code || '').includes('auth')) {
        return res.status(401).json({ error: 'invalid_auth' })
      }
      return res.status(500).json({ error: 'items_fetch_failed', message: e?.message || 'Unknown error' })
    }
  }

  return res.status(405).end()
} 
