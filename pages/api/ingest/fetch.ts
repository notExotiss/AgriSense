import type { NextApiRequest, NextApiResponse } from 'next';

async function signIfPlanetary(url: string): Promise<string> {
  try {
    const r = await fetch(`https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=${encodeURIComponent(url)}`);
    if (!r.ok) return url;
    const js = await r.json();
    return (js?.href as string) || (js?.signedHref as string) || url;
  } catch (err) {
    console.warn('signIfPlanetary failed, using original url', err);
    return url;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    let { bbox, date } = req.body || {};

    // Validate bbox
    if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
      return res.status(400).json({ error: 'bbox_required', message: 'Bounding box [minx,miny,maxx,maxy] is required' });
    }

    console.log('Processing lightweight ingest for bbox:', bbox);

    // Perform STAC search using Planetary Computer (free)
    console.log('Performing STAC search for bbox:', bbox);
    const stacRes = await fetch("https://planetarycomputer.microsoft.com/api/stac/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bbox,
        datetime: date,
        collections: ["sentinel-2-l2a"],
        limit: 1,
        sortby: [{ field: "eo:cloud_cover", direction: "asc" }]
      })
    });

    if (!stacRes.ok) {
      console.error('STAC search failed:', stacRes.status, stacRes.statusText);
      throw new Error("STAC search failed");
    }
    
    const stacJson = await stacRes.json();
    const best = stacJson.features?.[0];
    if (!best) throw new Error("No imagery found in STAC search");

    console.log('Found imagery:', best.id);

    // Sign the asset URLs for client-side processing
    const b04Url = await signIfPlanetary(best.assets.B04.href);
    const b08Url = await signIfPlanetary(best.assets.B08.href);

    // Return imagery URLs for client-side processing
    const response = {
      ndviStats: null, // Will be calculated client-side
      width: null,
      height: null,
      pixels: null,
      ndviPng: null, // Will be generated client-side
      bbox,
      imagery: {
        id: best.id,
        date: best.properties?.datetime,
        cloudCover: best.properties?.['eo:cloud_cover'],
        platform: best.properties?.platform
      },
      assets: {
        b04: b04Url,
        b08: b08Url
      },
      message: "Imagery URLs provided for client-side processing"
    };

    console.log('Returning imagery URLs for client-side processing');
    return res.status(200).json(response);

  } catch (e: any) {
    console.error('ingest/fetch error', e?.message || e, { stack: e?.stack });
    return res.status(500).json({ error: 'ingest_failed', message: String(e?.message || e) });
  }
}