import type { NextApiRequest, NextApiResponse } from 'next'
import { fromArrayBuffer } from 'geotiff'

const TOKEN_URL_CLASSIC = 'https://services.sentinel-hub.com/oauth/token'
const PROCESS_URL_CLASSIC = 'https://services.sentinel-hub.com/api/v1/process'

const TOKEN_URL_CDSE = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
const PROCESS_URL_CDSE = 'https://sh.dataspace.copernicus.eu/api/v1/process'

async function getTokenClassic(){
  const id = process.env.SENTINEL_HUB_CLIENT_ID
  const secret = process.env.SENTINEL_HUB_CLIENT_SECRET
  if (!id || !secret) return null
  const r = await fetch(TOKEN_URL_CLASSIC, { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type:'client_credentials', client_id:id, client_secret:secret }) })
  if (!r.ok) return null
  const js = await r.json()
  return js.access_token as string
}

async function getTokenCdse(){
  const id = process.env.SENTINEL_HUB_CLIENT_ID
  const secret = process.env.SENTINEL_HUB_CLIENT_SECRET
  if (!id || !secret) return null
  const r = await fetch(TOKEN_URL_CDSE, { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type:'client_credentials', client_id:id, client_secret:secret }) })
  if (!r.ok) return null
  const js = await r.json()
  return js.access_token as string
}

const evalscriptNDVI = `//VERSION=3
function setup(){
  return {
    input: [{ bands:["B04","B08"], units: "REFLECTANCE" }],
    output: { bands: 1, sampleType: "FLOAT32" }
  }
}
function evaluatePixel(s){
  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04)
  if (!isFinite(ndvi)) ndvi = 0
  return [ndvi]
}`

const evalscriptColorPNG = `//VERSION=3
function setup(){
  return { input:[{ bands:["B04","B08"], units: "REFLECTANCE" }], output: { bands: 3 } }
}
function evaluatePixel(s){
  let v = (s.B08 - s.B04) / (s.B08 + s.B04)
  if (!isFinite(v)) v = 0
  let r,g,b
  if (v < 0){ r=128; g=0; b=38 }
  else if (v < 0.2){ r=255; g=255; b=178 }
  else if (v < 0.4){ r=127; g=201; b=127 }
  else { r=27; g=120; b=55 }
  return [r/255, g/255, b/255]
}`

export default async function handler(req: NextApiRequest, res: NextApiResponse){
  if (req.method !== 'POST') return res.status(405).end()
  try{
    const { bbox, date, size } = req.body || {}
    if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) return res.status(400).json({ error: 'bbox required [minx,miny,maxx,maxy]' })
    const [minx,miny,maxx,maxy] = bbox.map(Number)
    const range = String(date || '').includes('/') ? String(date) : `${date || '2024-07-01'}/${date || '2024-07-10'}`
    const fromIso = `${range.split('/')[0]}T00:00:00Z`
    const toIso = `${range.split('/')[1]}T23:59:59Z`

    let token = await getTokenClassic()
    let processUrl = PROCESS_URL_CLASSIC
    if (!token){
      token = await getTokenCdse()
      processUrl = PROCESS_URL_CDSE
    }
    if (!token) return res.status(400).json({ error: 'sentinel_hub_not_configured' })

    const baseInput = {
      bounds: { bbox: [minx,miny,maxx,maxy], properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } },
      data: [{ type:'S2L2A', dataFilter:{ timeRange:{ from: fromIso, to: toIso }, mosaickingOrder: 'leastCC' } }]
    }

    const tiffReq = await fetch(processUrl, {
      method:'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        input: baseInput,
        evalscript: evalscriptNDVI,
        output: { responses:[{ identifier:'default', format:{ type:'image/tiff' } }], width: size?.width || 1024, height: size?.height || 1024 }
      })
    })
    if (!tiffReq.ok){
      const text = await tiffReq.text()
      return res.status(502).json({ error:'process_failed', detail:text })
    }
    const tiffBuf = await tiffReq.arrayBuffer()
    const tiff = await fromArrayBuffer(tiffBuf)
    const image = await tiff.getImage()
    const rasters: any = await image.readRasters({ interleave:true })
    const ndvi = rasters as Float32Array
    let min = 1, max = -1, sum = 0
    for (let i=0;i<ndvi.length;i++){ const v = ndvi[i]; if (v<min) min=v; if (v>max) max=v; sum += v }
    const mean = sum / Math.max(1, ndvi.length)

    const pngReq = await fetch(processUrl, {
      method:'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        input: baseInput,
        evalscript: evalscriptColorPNG,
        output: { responses:[{ identifier:'default', format:{ type:'image/png' } }], width: size?.width || 1024, height: size?.height || 1024 }
      })
    })
    if (!pngReq.ok){
      const text = await pngReq.text()
      return res.status(502).json({ error:'png_failed', detail:text, ndviStats: { min, max, mean } })
    }
    const pngBuf = await pngReq.arrayBuffer()
    const ndviPng = Buffer.from(pngBuf).toString('base64')

    return res.status(200).json({ ndviStats: { min, max, mean }, ndviPng, bbox: [minx,miny,maxx,maxy] })
  } catch(e:any){
    console.error('sentinel-hub/fetch', e?.message || e)
    return res.status(500).json({ error:'internal' })
  }
} 