import type { NextApiRequest, NextApiResponse } from 'next'

const STAC_ENDPOINT = 'https://planetarycomputer.microsoft.com/api/stac/v1'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { bbox, date } = req.body || {}
    if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
      return res.status(400).json({ error: 'bbox required as [minx,miny,maxx,maxy]' })
    }
    if (!date || typeof date !== 'string') {
      return res.status(400).json({ error: 'date required as ISO range, e.g. 2024-07-01/2024-07-10' })
    }

    const body = {
      bbox,
      datetime: date,
      collections: ['sentinel-2-l2a'],
      limit: 10
    }

    const r = await fetch(`${STAC_ENDPOINT}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!r.ok) {
      const text = await r.text()
      return res.status(502).json({ error: 'stac_failed', detail: text })
    }

    const js = await r.json()
    const items = (js?.features || []).map((it: any) => {
      const assets = it.assets || {}
      return {
        id: it.id,
        date: it.properties?.datetime,
        cloud: it.properties?.['eo:cloud_cover'],
        b04: assets['B04']?.href || assets['B4']?.href || null,
        b08: assets['B08']?.href || assets['B8']?.href || null,
        bbox: it.bbox || null,
      }
    }).filter((x: any) => x.b04 && x.b08)

    return res.status(200).json({ items })
  } catch (e: any) {
    console.error('stac-search error', e?.message || e)
    return res.status(500).json({ error: 'internal' })
  }
} 