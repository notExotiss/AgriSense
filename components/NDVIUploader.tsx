import React, { useState } from 'react'
import { fromArrayBuffer } from 'geotiff'

export default function NDVIUploader({ onNDVIReady }: { onNDVIReady: (args:{ ndvi: Float32Array, width:number, height:number, stats: { min:number, max:number, mean:number } }) => void }){
  const [status, setStatus] = useState('idle')

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>){
    const f = e.target.files?.[0]
    if (!f) return
    setStatus('reading')
    const buf = await f.arrayBuffer()
    await process(buf)
  }

  async function process(arrayBuffer: ArrayBuffer){
    setStatus('parsing')
    const tiff = await fromArrayBuffer(arrayBuffer)
    const image = await tiff.getImage()
    const width = image.getWidth()
    const height = image.getHeight()
    const rasters: any = await image.readRasters({ interleave: false })
    const red = rasters[3] || rasters[0]
    const nir = rasters[7] || rasters[1]
    const ndvi = new Float32Array(red.length)
    let min = 1, max = -1, sum = 0
    for (let i=0;i<red.length;i++){
      const r = red[i]
      const n = nir[i]
      const den = n + r
      const v = den === 0 ? 0 : (n - r) / den
      ndvi[i] = v
      if (v < min) min = v
      if (v > max) max = v
      sum += v
    }
    const mean = sum / ndvi.length
    setStatus('done')
    onNDVIReady({ ndvi, width, height, stats: { min, max, mean } })
  }

  return (
    <div className="space-y-2">
      <input type="file" accept=".tif,.tiff" onChange={handleFile} />
      <div className="text-xs text-muted-foreground">Status: {status}</div>
    </div>
  )
} 