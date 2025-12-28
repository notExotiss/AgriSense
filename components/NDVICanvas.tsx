import React, { useEffect, useRef } from 'react'

function colorFor(v:number){
  if (v <= -0.2) return [128,0,38,255]
  if (v <= 0.0) return [189,0,38,255]
  if (v <= 0.2) return [255,255,178,255]
  if (v <= 0.4) return [127,201,127,255]
  return [27,120,55,255]
}

export default function NDVICanvas({ ndvi, width, height }: { ndvi: Float32Array, width:number, height:number }){
  const ref = useRef<HTMLCanvasElement|null>(null)
  useEffect(()=>{
    if (!ref.current) return
    const canvas = ref.current
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(width, height)
    for (let i=0;i<ndvi.length;i++){
      const c = colorFor(ndvi[i])
      const p = i*4
      img.data[p]=c[0]; img.data[p+1]=c[1]; img.data[p+2]=c[2]; img.data[p+3]=c[3]
    }
    ctx.putImageData(img, 0, 0)
  }, [ndvi, width, height])
  return <canvas ref={ref} className="w-full h-auto border rounded"/>
} 