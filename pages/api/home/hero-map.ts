import type { NextApiRequest, NextApiResponse } from 'next'
import { PNG } from 'pngjs'
import { buildHeroTextures } from '../../../lib/home/hero-render'
import { runIngestPipeline } from '../../../lib/satellite/service'
import { makeCacheKey, readMemoryCache, writeMemoryCache } from '../../../lib/server/cache'

const HERO_CACHE_TTL_MS = 1000 * 60 * 30
const HERO_BBOX: [number, number, number, number] = [-74.49, 40.45, -74.33, 40.59]
const HERO_SIZE = 1024

type HeroMapApiResponse = {
  success: boolean
  cacheHit: boolean
  data?: {
    outlinePng: string
    topoPng: string
    legend: {
      metric: 'ndvi'
      min: number
      max: number
      unit: 'NDVI'
      stops: Array<{ value: number; color: [number, number, number] }>
    }
    bbox: [number, number, number, number]
    source: string
    generatedAt: string
    metricGrid: {
      encoded: string
      width: number
      height: number
    }
    imagery: {
      id: string
      date: string | null
      cloudCover: number | null
      platform: string | null
    }
  }
  warnings: string[]
  message?: string
}

function decodeMetricGrid(encoded: string, width: number, height: number) {
  const bytes = Buffer.from(encoded, 'base64')
  const expected = width * height
  const floats = new Float32Array(bytes.buffer, bytes.byteOffset, Math.min(expected, Math.floor(bytes.byteLength / 4)))
  const values = new Array(expected).fill(0)
  for (let i = 0; i < expected; i++) {
    const value = Number(floats[i] ?? 0)
    values[i] = Number.isFinite(value) ? value : 0
  }
  return values
}

function deriveValuesFromPreview(previewPng: string) {
  const buffer = Buffer.from(previewPng, 'base64')
  const png = PNG.sync.read(buffer)
  const values: number[] = new Array(png.width * png.height)
  for (let i = 0; i < values.length; i++) {
    const idx = i * 4
    const r = png.data[idx]
    const g = png.data[idx + 1]
    const b = png.data[idx + 2]
    const luminance = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255
    values[i] = luminance * 2 - 1
  }
  return {
    values,
    width: png.width,
    height: png.height,
    min: -1,
    max: 1,
  }
}

function encodeFloatGrid(values: number[]) {
  const array = new Float32Array(values.length)
  for (let i = 0; i < values.length; i++) {
    const value = Number(values[i])
    array[i] = Number.isFinite(value) ? value : 0
  }
  return Buffer.from(array.buffer).toString('base64')
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HeroMapApiResponse>
) {
  if (req.method !== 'GET') return res.status(405).end()

  const cacheKey = makeCacheKey(['home-hero-map-v1', ...HERO_BBOX, HERO_SIZE])
  const cached = readMemoryCache<HeroMapApiResponse>(cacheKey)
  if (cached?.data) {
    return res.status(200).json({
      ...cached,
      cacheHit: true,
      warnings: [...cached.warnings, 'Served from memory cache.'],
    })
  }

  try {
    const { result } = await runIngestPipeline({
      bbox: HERO_BBOX,
      targetSize: HERO_SIZE,
      policy: 'balanced',
    })

    const metricGrid = result?.ndvi?.metricGrid
    const payload =
      metricGrid?.encoded && metricGrid.width > 0 && metricGrid.height > 0
        ? {
            values: decodeMetricGrid(metricGrid.encoded, metricGrid.width, metricGrid.height),
            width: metricGrid.width,
            height: metricGrid.height,
            min: metricGrid.min,
            max: metricGrid.max,
          }
        : deriveValuesFromPreview(result.ndvi.previewPng)

    const rendered = buildHeroTextures(payload)
    const encodedGrid = encodeFloatGrid(payload.values)
    const response: HeroMapApiResponse = {
      success: true,
      cacheHit: false,
      data: {
        outlinePng: rendered.outlinePng,
        topoPng: rendered.topoPng,
        legend: rendered.legend,
        bbox: result.bbox,
        source: result.provider,
        generatedAt: new Date().toISOString(),
        metricGrid: {
          encoded: encodedGrid,
          width: payload.width,
          height: payload.height,
        },
        imagery: result.imagery,
      },
      warnings: metricGrid?.encoded
        ? []
        : ['Metric grid unavailable; using preview-derived NDVI approximation.'],
    }

    writeMemoryCache(cacheKey, response, HERO_CACHE_TTL_MS)
    return res.status(200).json(response)
  } catch (error: any) {
    return res.status(200).json({
      success: false,
      cacheHit: false,
      warnings: ['Hero map unavailable for this run.'],
      message: String(error?.message || 'hero_map_generation_failed'),
    })
  }
}
