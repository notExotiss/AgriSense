import type { NextApiRequest, NextApiResponse } from 'next'
import { runIngestPipeline, toIngestErrorPayload } from '../../../lib/satellite/service'

async function signIfPlanetary(url: string): Promise<string> {
  try {
    const response = await fetch(`https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=${encodeURIComponent(url)}`)
    if (!response.ok) return url
    const json = await response.json()
    return (json?.href as string) || (json?.signedHref as string) || url
  } catch {
    return url
  }
}

async function legacyIngest(req: NextApiRequest) {
  const { bbox, date } = req.body || {}
  const stacRes = await fetch('https://planetarycomputer.microsoft.com/api/stac/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bbox,
      datetime: date,
      collections: ['sentinel-2-l2a'],
      limit: 1,
      sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }],
    }),
  })

  if (!stacRes.ok) throw new Error(`legacy_stac_failed_${stacRes.status}`)
  const stacJson = await stacRes.json()
  const best = stacJson.features?.[0]
  if (!best) throw new Error('legacy_no_scene')
  const b04Url = await signIfPlanetary(best.assets?.B04?.href)
  const b08Url = await signIfPlanetary(best.assets?.B08?.href)

  return {
    success: true,
    data: {
      provider: 'planetary-computer-preview',
      fallbackUsed: false,
      imagery: {
        id: best.id,
        date: best.properties?.datetime || null,
        cloudCover: best.properties?.['eo:cloud_cover'] ?? null,
        platform: best.properties?.platform ?? null,
      },
      bbox,
      ndvi: {
        previewPng: null,
        width: null,
        height: null,
        stats: { min: 0, max: 0, mean: 0, p10: 0, p90: 0 },
        validPixelRatio: 0,
        grid3x3: [],
      },
      assets: {
        b04: b04Url,
        b08: b08Url,
      },
    },
    warnings: ['Legacy ingest mode enabled: run manual client-side NDVI processing.'],
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const useLegacyMode = process.env.USE_NEW_INGEST_PIPELINE === 'false'
    if (useLegacyMode) {
      const legacy = await legacyIngest(req)
      return res.status(200).json(legacy)
    }

    const { bbox, date, targetSize, policy } = req.body || {}
    const { result, warnings } = await runIngestPipeline({
      bbox,
      date,
      targetSize,
      policy,
    })

    return res.status(200).json({
      success: true,
      data: result,
      warnings,
    })
  } catch (error) {
    const payload = toIngestErrorPayload(error)
    const status = payload.error === 'bbox_required' ? 400 : payload.error === 'all_providers_failed' ? 502 : 500
    return res.status(status).json(payload)
  }
}
