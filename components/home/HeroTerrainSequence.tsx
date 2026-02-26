'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TriangleAlert } from 'lucide-react'
import { TOPO_PALETTES, sampleTopographyPalette } from '../../lib/visual/topography'

type HeroLegendStop = {
  value: number
  color: [number, number, number]
}

type HeroMapPayload = {
  outlinePng: string
  topoPng: string
  legend: {
    metric: 'ndvi'
    min: number
    max: number
    unit: 'NDVI'
    stops: HeroLegendStop[]
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

type HoverState = {
  ndvi: number
  x: number
  y: number
}

type HeightGridState = {
  values: Float32Array
  width: number
  height: number
  source: string
}

type IntroMode = 'run' | 'skip'

type HeroTerrainSequenceProps = {
  introMode?: IntroMode
  onIntroComplete?: () => void
}

const INTRO_HOLD_MS = 400
const INTRO_REVEAL_MS = 1700
const INTRO_DOCK_MS = 1300

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function mix(start: number, end: number, t: number) {
  return start + (end - start) * t
}

function encodeFloatGridBase64(values: Float32Array) {
  const bytes = new Uint8Array(values.buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk)
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j])
    }
  }
  return window.btoa(binary)
}

function canvasToBase64Png(canvas: HTMLCanvasElement) {
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}

function fract(value: number) {
  return value - Math.floor(value)
}

function hash2(ix: number, iy: number) {
  return fract(Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123)
}

function valueNoise2D(u: number, v: number, frequency: number) {
  const x = u * frequency
  const y = v * frequency
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = x0 + 1
  const y1 = y0 + 1
  const tx = x - x0
  const ty = y - y0
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const n00 = hash2(x0, y0)
  const n10 = hash2(x1, y0)
  const n01 = hash2(x0, y1)
  const n11 = hash2(x1, y1)
  const nx0 = mix(n00, n10, sx)
  const nx1 = mix(n01, n11, sx)
  return mix(nx0, nx1, sy)
}

function createInstantHeroPayload(): HeroMapPayload {
  const width = 224
  const height = 156
  const values = new Float32Array(width * height)

  for (let y = 0; y < height; y++) {
    const v = y / Math.max(1, height - 1)
    for (let x = 0; x < width; x++) {
      const u = x / Math.max(1, width - 1)
      const nx = u * 2 - 1
      const ny = v * 2 - 1

      const n1 = valueNoise2D(u, v, 2.1)
      const n2 = valueNoise2D(u + 0.07, v - 0.03, 4.4)
      const n3 = valueNoise2D(u - 0.04, v + 0.05, 8.8)

      const broadRidge = Math.abs(Math.sin((u * 2.2 - v * 1.45) * Math.PI)) * 0.16
      const basin = Math.exp(-(nx * nx * 0.78 + ny * ny * 1.22)) * 0.12
      const northHill = Math.exp(-((u - 0.34) * (u - 0.34) * 18 + (v - 0.28) * (v - 0.28) * 14)) * 0.19
      const eastHill = Math.exp(-((u - 0.74) * (u - 0.74) * 16 + (v - 0.52) * (v - 0.52) * 10)) * 0.17
      const river = Math.exp(-Math.pow((u - 0.54) * 0.95 + (v - 0.44) * 1.55, 2) / 0.013) * 0.22

      const terrain = 0.54 * n1 + 0.28 * n2 + 0.18 * n3 + broadRidge + basin + northHill + eastHill - river
      values[y * width + x] = clamp(terrain - 0.24, -0.24, 0.78)
    }
  }

  const smoothedValues = smoothGrid(values, width, height, 3)
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < smoothedValues.length; i++) {
    const value = smoothedValues[i]
    if (value < min) min = value
    if (value > max) max = value
  }

  const range = Math.max(1e-6, max - min)
  const normalized = new Float32Array(smoothedValues.length)
  for (let i = 0; i < smoothedValues.length; i++) {
    normalized[i] = clamp((smoothedValues[i] - min) / range, 0, 1)
  }

  const get = (x: number, y: number) => {
    const sx = clamp(x, 0, width - 1)
    const sy = clamp(y, 0, height - 1)
    return normalized[sy * width + sx]
  }

  const outlineCanvas = document.createElement('canvas')
  outlineCanvas.width = width
  outlineCanvas.height = height
  const outlineCtx = outlineCanvas.getContext('2d')
  if (!outlineCtx) throw new Error('instant_outline_context_failed')
  const outlineImg = outlineCtx.createImageData(width, height)
  const outlinePx = outlineImg.data

  const topoCanvas = document.createElement('canvas')
  topoCanvas.width = width
  topoCanvas.height = height
  const topoCtx = topoCanvas.getContext('2d')
  if (!topoCtx) throw new Error('instant_topo_context_failed')
  const topoImg = topoCtx.createImageData(width, height)
  const topoPx = topoImg.data

  const contourLevels = 18
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const out = idx * 4
      const value = normalized[idx]
      const sx = get(x + 1, y) - get(x - 1, y)
      const sy = get(x, y + 1) - get(x, y - 1)
      const shade = clamp(0.82 - sx * 0.46 - sy * 0.38, 0.34, 1.14)
      const contourDistance = Math.abs(value * contourLevels - Math.round(value * contourLevels))
      const contour = contourDistance < 0.022

      const gray = Math.round(clamp(145 * shade + 34, 0, 255))
      if (contour) {
        const alpha = contourDistance < 0.009 ? 0.34 : 0.18
        outlinePx[out] = Math.round(gray * (1 - alpha * 0.4))
        outlinePx[out + 1] = Math.round(gray * (1 - alpha * 0.26))
        outlinePx[out + 2] = Math.round(gray * (1 - alpha * 0.12) + 90 * alpha)
      } else {
        outlinePx[out] = gray
        outlinePx[out + 1] = gray
        outlinePx[out + 2] = gray
      }
      outlinePx[out + 3] = 255

      const [rBase, gBase, bBase] = sampleTopographyPalette('ndvi', value)
      let r = Math.round(clamp(rBase * shade, 0, 255))
      let g = Math.round(clamp(gBase * shade, 0, 255))
      let b = Math.round(clamp(bBase * shade, 0, 255))
      if (contour) {
        const alpha = contourDistance < 0.009 ? 0.26 : 0.14
        r = Math.round((1 - alpha) * r + alpha * 10)
        g = Math.round((1 - alpha) * g + alpha * 22)
        b = Math.round((1 - alpha) * b + alpha * 46)
      }
      topoPx[out] = r
      topoPx[out + 1] = g
      topoPx[out + 2] = b
      topoPx[out + 3] = 255
    }
  }

  outlineCtx.putImageData(outlineImg, 0, 0)
  topoCtx.putImageData(topoImg, 0, 0)

  return {
    outlinePng: canvasToBase64Png(outlineCanvas),
    topoPng: canvasToBase64Png(topoCanvas),
    legend: {
      metric: 'ndvi',
      min,
      max,
      unit: 'NDVI',
      stops: TOPO_PALETTES.ndvi.map((stop) => ({
        value: min + (max - min) * stop.stop,
        color: stop.color,
      })),
    },
    bbox: [-74.49, 40.45, -74.33, 40.59],
    source: 'agrisense-instant-premade',
    generatedAt: new Date().toISOString(),
    metricGrid: {
      encoded: encodeFloatGridBase64(smoothedValues),
      width,
      height,
    },
    imagery: {
      id: 'instant-premade',
      date: null,
      cloudCover: null,
      platform: 'local',
    },
  }
}

function observeRange(values: ArrayLike<number>) {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < values.length; i++) {
    const value = Number(values[i])
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-6) {
    return { min: 0, max: 1 }
  }
  return { min, max }
}

function decodeGrid(encoded: string, width: number, height: number) {
  const bytes = window.atob(encoded)
  const raw = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) raw[i] = bytes.charCodeAt(i)
  const expected = width * height
  const floatArray = new Float32Array(raw.buffer, raw.byteOffset, Math.min(expected, Math.floor(raw.byteLength / 4)))
  const values = new Float32Array(expected)
  for (let i = 0; i < expected; i++) {
    const value = Number(floatArray[i] ?? 0)
    values[i] = Number.isFinite(value) ? value : 0
  }
  return values
}

function smoothGrid(values: Float32Array, width: number, height: number, passes = 2) {
  if (passes <= 0 || width < 3 || height < 3) return values
  let current = values
  for (let pass = 0; pass < passes; pass++) {
    const next = new Float32Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        const left = current[y * width + Math.max(0, x - 1)]
        const right = current[y * width + Math.min(width - 1, x + 1)]
        const up = current[Math.max(0, y - 1) * width + x]
        const down = current[Math.min(height - 1, y + 1) * width + x]
        next[idx] = (left + right + up + down + current[idx] * 2) / 6
      }
    }
    current = next
  }
  return current
}

function sampleGrid(values: ArrayLike<number>, width: number, height: number, u: number, v: number) {
  const x = clamp(u, 0, 1) * (width - 1)
  const y = clamp(v, 0, 1) * (height - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const idx00 = y0 * width + x0
  const idx10 = y0 * width + x1
  const idx01 = y1 * width + x0
  const idx11 = y1 * width + x1
  const top = mix(values[idx00], values[idx10], tx)
  const bottom = mix(values[idx01], values[idx11], tx)
  return mix(top, bottom, ty)
}

function resampleGrid(values: ArrayLike<number>, width: number, height: number, targetWidth: number, targetHeight: number) {
  const out = new Float32Array(targetWidth * targetHeight)
  for (let y = 0; y < targetHeight; y++) {
    const v = y / Math.max(1, targetHeight - 1)
    for (let x = 0; x < targetWidth; x++) {
      const u = x / Math.max(1, targetWidth - 1)
      out[y * targetWidth + x] = sampleGrid(values, width, height, u, v)
    }
  }
  return out
}

function stageRect() {
  const stageAspect = 16 / 10
  const maxWidth = Math.min(window.innerWidth * 0.84, 1120)
  const maxHeight = Math.min(window.innerHeight * 0.78, 700)
  let width = maxWidth
  let height = width / stageAspect
  if (height > maxHeight) {
    height = maxHeight
    width = height * stageAspect
  }
  return {
    left: Math.round((window.innerWidth - width) / 2),
    top: Math.round((window.innerHeight - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  }
}

function createSceneBackdropTexture(darkTheme: boolean) {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 640
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const base = ctx.createLinearGradient(0, 0, 0, canvas.height)
  if (darkTheme) {
    base.addColorStop(0, '#0b223f')
    base.addColorStop(0.58, '#071933')
    base.addColorStop(1, '#041126')
  } else {
    base.addColorStop(0, '#d7e9fb')
    base.addColorStop(0.58, '#e7f1fa')
    base.addColorStop(1, '#d4e2ef')
  }
  ctx.fillStyle = base
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const glow = ctx.createRadialGradient(
    canvas.width * 0.22,
    canvas.height * 0.12,
    20,
    canvas.width * 0.22,
    canvas.height * 0.12,
    canvas.width * 0.82
  )
  if (darkTheme) {
    glow.addColorStop(0, 'rgba(56,189,248,0.20)')
    glow.addColorStop(1, 'rgba(56,189,248,0)')
  } else {
    glow.addColorStop(0, 'rgba(59,130,246,0.16)')
    glow.addColorStop(1, 'rgba(59,130,246,0)')
  }
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  return texture
}

function createEdgeSkirtGeometry(
  edge: 'north' | 'south' | 'east' | 'west',
  segments: number,
  sampleHeightFn: (u: number, v: number) => number,
  planeWidth: number,
  planeHeight: number,
  baseY: number
) {
  const vertices: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const outset = 2.8

  for (let i = 0; i <= segments; i++) {
    const t = i / Math.max(1, segments)
    let u = t
    let v = t
    if (edge === 'north') {
      u = t
      v = 0
    } else if (edge === 'south') {
      u = t
      v = 1
    } else if (edge === 'west') {
      u = 0
      v = t
    } else {
      u = 1
      v = t
    }
    const x = -planeWidth / 2 + u * planeWidth
    const z = -planeHeight / 2 + v * planeHeight
    const y = sampleHeightFn(u, v)
    let bottomX = x
    let bottomZ = z
    if (edge === 'north') bottomZ -= outset
    if (edge === 'south') bottomZ += outset
    if (edge === 'west') bottomX -= outset
    if (edge === 'east') bottomX += outset
    vertices.push(x, y, z)
    vertices.push(bottomX, baseY, bottomZ)
    uvs.push(u, v)
    uvs.push(u, v)
  }

  for (let i = 0; i < segments; i++) {
    const s = i * 2
    indices.push(s, s + 1, s + 2)
    indices.push(s + 1, s + 3, s + 2)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

async function loadTextureFromBase64(renderer: THREE.WebGLRenderer, base64: string) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('hero_texture_load_failed'))
    img.src = `data:image/png;base64,${base64}`
  })

  const texture = new THREE.Texture(image)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
  texture.anisotropy = Math.max(2, Math.min(maxAnisotropy, 16))
  return texture
}

export default function HeroTerrainSequence({ introMode = 'run', onIntroComplete }: HeroTerrainSequenceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const cinematicRef = useRef<HTMLDivElement | null>(null)
  const introCompletedRef = useRef(false)
  const sceneBootstrappedRef = useRef(false)
  const callbackFiredRef = useRef(false)
  const onIntroCompleteRef = useRef(onIntroComplete)
  const initialModeRef = useRef<IntroMode>(introMode)
  const introEnabled = initialModeRef.current === 'run'
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const [data, setData] = useState<HeroMapPayload | null>(null)
  const [heightGrid, setHeightGrid] = useState<HeightGridState | null>(null)
  const [heightGridReady, setHeightGridReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [phaseLabel, setPhaseLabel] = useState<'initializing' | 'revealing' | 'docking' | 'interactive'>(
    introEnabled ? 'initializing' : 'interactive'
  )
  const [cinematicActive, setCinematicActive] = useState(introEnabled)
  const phaseRef = useRef<'initializing' | 'revealing' | 'docking' | 'interactive'>('initializing')

  const legendStops = useMemo(() => data?.legend?.stops || [], [data?.legend?.stops])

  useEffect(() => {
    onIntroCompleteRef.current = onIntroComplete
  }, [onIntroComplete])

  const emitIntroComplete = () => {
    if (callbackFiredRef.current) return
    callbackFiredRef.current = true
    onIntroCompleteRef.current?.()
  }

  useEffect(() => {
    if (typeof document === 'undefined') return
    const host = document.createElement('div')
    host.setAttribute('data-hero-cinematic-root', 'true')
    document.body.appendChild(host)
    setPortalHost(host)
    return () => {
      if (host.parentNode) host.parentNode.removeChild(host)
    }
  }, [])

  useEffect(() => {
    if (!introEnabled) {
      introCompletedRef.current = true
      phaseRef.current = 'interactive'
      setPhaseLabel('interactive')
      setCinematicActive(false)
    }
  }, [introEnabled])

  useEffect(() => {
    let active = true
    setError(null)
    setHeightGridReady(false)

    try {
      const payload = createInstantHeroPayload()
      const premadeHeightGrid = smoothGrid(
        decodeGrid(payload.metricGrid.encoded, payload.metricGrid.width, payload.metricGrid.height),
        payload.metricGrid.width,
        payload.metricGrid.height,
        2
      )
      if (!active) return
      setData(payload)
      setHeightGrid({
        values: premadeHeightGrid,
        width: payload.metricGrid.width,
        height: payload.metricGrid.height,
        source: payload.source,
      })
      setHeightGridReady(true)
    } catch (err: any) {
      if (!active) return
      setError(String(err?.message || 'hero_map_unavailable'))
      setHeightGridReady(true)
      if (introEnabled) {
        setCinematicActive(false)
        emitIntroComplete()
      }
    }

    return () => {
      active = false
    }
  }, [introEnabled])

  useEffect(() => {
    if (!containerRef.current || !data || !heightGridReady) return
    if (sceneBootstrappedRef.current) return
    if (cinematicActive && portalHost && !cinematicRef.current) return
    sceneBootstrappedRef.current = true

    const container = containerRef.current
    const overlay = overlayRef.current
    const cinematicShell = cinematicRef.current
    const cinematicRunning = Boolean(cinematicShell && cinematicActive && introEnabled)

    const scene = new THREE.Scene()
    const darkTheme = document.documentElement.classList.contains('dark')
    const backdropTexture = createSceneBackdropTexture(darkTheme)
    if (backdropTexture) {
      scene.background = backdropTexture
    }

    const widthPx = container.clientWidth || 900
    const heightPx = container.clientHeight || 520
    const camera = new THREE.PerspectiveCamera(36, widthPx / heightPx, 0.1, 2200)
    camera.position.set(-18, 92, 168)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'

    const applyRenderSize = (width: number, height: number) => {
      const safeW = Math.max(1, Math.floor(width))
      const safeH = Math.max(1, Math.floor(height))
      renderer.setSize(safeW, safeH, false)
      camera.aspect = safeW / safeH
      camera.updateProjectionMatrix()
    }

    if (cinematicRunning && cinematicShell) {
      cinematicShell.innerHTML = ''
      const intro = stageRect()
      cinematicShell.style.left = `${intro.left}px`
      cinematicShell.style.top = `${intro.top}px`
      cinematicShell.style.width = `${Math.round(intro.width)}px`
      cinematicShell.style.height = `${Math.round(intro.height)}px`
      cinematicShell.style.borderRadius = '28px'
      cinematicShell.style.opacity = '1'
      cinematicShell.style.boxShadow = '0 24px 78px rgba(2,8,23,0.22)'
      cinematicShell.appendChild(renderer.domElement)
      applyRenderSize(intro.width, intro.height)
    } else {
      container.innerHTML = ''
      container.appendChild(renderer.domElement)
      applyRenderSize(widthPx, heightPx)
    }

    scene.add(new THREE.AmbientLight(0xffffff, 0.86))
    const key = new THREE.DirectionalLight(0xffffff, 1.08)
    key.position.set(95, 120, 58)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xeff3f6, 0.55)
    fill.position.set(-95, 90, -80)
    scene.add(fill)

    const ndviGrid = smoothGrid(
      decodeGrid(data.metricGrid.encoded, data.metricGrid.width, data.metricGrid.height),
      data.metricGrid.width,
      data.metricGrid.height,
      2
    )

    const isPremadeTerrain = Boolean(heightGrid && /instant-premade/i.test(heightGrid.source))
    const sourceValues = heightGrid
      ? smoothGrid(heightGrid.values, heightGrid.width, heightGrid.height, isPremadeTerrain ? 4 : 2)
      : ndviGrid
    const sourceWidth = heightGrid ? heightGrid.width : data.metricGrid.width
    const sourceHeight = heightGrid ? heightGrid.height : data.metricGrid.height

    const lonSpan = Math.max(1e-6, Math.abs(data.bbox[2] - data.bbox[0]))
    const latSpan = Math.max(1e-6, Math.abs(data.bbox[3] - data.bbox[1]))
    const aspect = clamp(latSpan / lonSpan, 0.62, 1.65)

    const sampleWidth = 220
    const sampleHeight = clamp(Math.round(sampleWidth * aspect), 130, 300)
    const resampledHeight = resampleGrid(sourceValues, sourceWidth, sourceHeight, sampleWidth, sampleHeight)
    const rawRange = observeRange(resampledHeight)
    const rawDelta = Math.max(1e-6, rawRange.max - rawRange.min)

    const normalizedHeight = new Float32Array(resampledHeight.length)
    const terraceSteps = isPremadeTerrain ? 128 : heightGrid ? 84 : 68
    const terraceMix = isPremadeTerrain ? 0.9 : 0.74
    for (let i = 0; i < resampledHeight.length; i++) {
      const base = clamp((resampledHeight[i] - rawRange.min) / rawDelta, 0, 1)
      const shaped = Math.pow(base, isPremadeTerrain ? 1.22 : 1.08)
      const terraced = Math.round(shaped * terraceSteps) / terraceSteps
      normalizedHeight[i] = mix(shaped, terraced, terraceMix)
    }

    const planeWidth = 162
    const planeHeight = planeWidth * aspect
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, sampleWidth - 1, sampleHeight - 1)
    const positions = geometry.attributes.position as THREE.BufferAttribute
    const elevationScale = isPremadeTerrain ? 30 : heightGrid ? 56 : 42
    const baseY = isPremadeTerrain ? -2.25 : -1.8
    for (let i = 0; i < normalizedHeight.length; i++) {
      positions.setZ(i, normalizedHeight[i] * elevationScale)
    }
    positions.needsUpdate = true
    geometry.computeVertexNormals()

    const sampleHeightOnMesh = (u: number, v: number) => {
      const x = clamp(u, 0, 1) * (sampleWidth - 1)
      const y = clamp(v, 0, 1) * (sampleHeight - 1)
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const x1 = Math.min(sampleWidth - 1, x0 + 1)
      const y1 = Math.min(sampleHeight - 1, y0 + 1)
      const tx = x - x0
      const ty = y - y0
      const idx00 = y0 * sampleWidth + x0
      const idx10 = y0 * sampleWidth + x1
      const idx01 = y1 * sampleWidth + x0
      const idx11 = y1 * sampleWidth + x1
      const top = mix(normalizedHeight[idx00], normalizedHeight[idx10], tx)
      const bottom = mix(normalizedHeight[idx01], normalizedHeight[idx11], tx)
      return mix(top, bottom, ty) * elevationScale
    }

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enabled = false
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI / 2.06
    controls.minDistance = 56
    controls.maxDistance = 260
    controls.target.set(0, 16, 0)

    const cameraTrack = {
      introPos: new THREE.Vector3(-18, 92, 168),
      finalPos: new THREE.Vector3(7, 114, 196),
      introTarget: new THREE.Vector3(0, 12, 0),
      finalTarget: new THREE.Vector3(0, 8, 0),
      introScale: 1.36,
      finalScale: 1,
      introOffsetY: 0.55,
      finalOffsetY: -0.8,
    }

    let outlineTexture: THREE.Texture | null = null
    let topoTexture: THREE.Texture | null = null
    let active = true
    let animationId = 0
    let lineMaterial: THREE.LineBasicMaterial | null = null
    let edgeMaterial: THREE.ShaderMaterial | null = null
    let contourMaterial: THREE.ShaderMaterial | null = null
    let cutawayMaterial: THREE.Material | null = null
    let baseMaterial: THREE.MeshStandardMaterial | null = null
    const skirtMeshes: THREE.Mesh[] = []
    let bottomMesh: THREE.Mesh | null = null
    const terrainGroup = new THREE.Group()
    terrainGroup.rotation.x = -0.055
    scene.add(terrainGroup)

    let dockedToPanel = !cinematicShell
    let cinematicDismissed = false

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2(0, 0)
    let terrainMesh: THREE.Mesh | null = null

    const onPointerMove = (event: PointerEvent) => {
      if (!terrainMesh) return
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObject(terrainMesh, false)[0]
      if (!hit || !hit.uv) {
        setHover(null)
        return
      }
      const ndvi = sampleGrid(
        ndviGrid,
        data.metricGrid.width,
        data.metricGrid.height,
        hit.uv.x,
        1 - hit.uv.y
      )
      setHover({
        ndvi,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      })
    }

    const onPointerLeave = () => setHover(null)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerleave', onPointerLeave)

    void (async () => {
      try {
        outlineTexture = await loadTextureFromBase64(renderer, data.outlinePng)
        topoTexture = await loadTextureFromBase64(renderer, data.topoPng)
        if (!active) return

        baseMaterial = new THREE.MeshStandardMaterial({
          map: outlineTexture,
          color: new THREE.Color(isPremadeTerrain ? 0xecf0ea : 0xf2f5f7),
          metalness: 0.02,
          roughness: isPremadeTerrain ? 0.9 : 0.84,
          side: THREE.DoubleSide,
        })
        terrainMesh = new THREE.Mesh(geometry, baseMaterial)
        terrainMesh.rotation.x = -Math.PI / 2
        terrainGroup.add(terrainMesh)

        edgeMaterial = new THREE.ShaderMaterial({
          uniforms: {
            uTopoTex: { value: topoTexture },
            uReveal: { value: 0.001 },
          },
          vertexShader: `
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform sampler2D uTopoTex;
            uniform float uReveal;
            varying vec2 vUv;
            void main() {
              if (vUv.x > uReveal + 0.018) discard;
              float edge = smoothstep(uReveal + 0.02, uReveal - 0.02, vUv.x);
              vec4 topo = texture2D(uTopoTex, vUv);
              gl_FragColor = vec4(topo.rgb, edge);
            }
          `,
          transparent: true,
          depthWrite: false,
        })

        const overlayMesh = new THREE.Mesh(geometry, edgeMaterial)
        overlayMesh.rotation.x = -Math.PI / 2
        overlayMesh.position.y = 0.16
        terrainGroup.add(overlayMesh)

        contourMaterial = new THREE.ShaderMaterial({
          uniforms: {
            uMaxHeight: { value: elevationScale },
            uDensity: { value: isPremadeTerrain ? 56 : 42 },
            uThickness: { value: isPremadeTerrain ? 0.058 : 0.044 },
            uOpacity: { value: isPremadeTerrain ? 0.56 : 0.46 },
            uLineColor: { value: new THREE.Color(isPremadeTerrain ? 0x1e3241 : 0x36495b) },
          },
          vertexShader: `
            varying float vHeight;
            uniform float uMaxHeight;
            void main() {
              vHeight = max(0.0, position.z / max(uMaxHeight, 0.001));
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            varying float vHeight;
            uniform float uDensity;
            uniform float uThickness;
            uniform float uOpacity;
            uniform vec3 uLineColor;
            void main() {
              float f = fract(vHeight * uDensity);
              float d = min(f, 1.0 - f);
              float aa = fwidth(vHeight * uDensity) * 0.9;
              float line = 1.0 - smoothstep(uThickness, uThickness + aa, d);
              gl_FragColor = vec4(uLineColor, line * uOpacity);
            }
          `,
          transparent: true,
          depthWrite: false,
        })

        const contourMesh = new THREE.Mesh(geometry, contourMaterial)
        contourMesh.rotation.x = -Math.PI / 2
        contourMesh.position.y = 0.22
        terrainGroup.add(contourMesh)

        if (!isPremadeTerrain) {
          const wire = new THREE.WireframeGeometry(geometry)
          lineMaterial = new THREE.LineBasicMaterial({
            color: 0x1a2028,
            transparent: true,
            opacity: 0.12,
          })
          const line = new THREE.LineSegments(wire, lineMaterial)
          line.rotation.x = -Math.PI / 2
          line.position.y = 0.1
          terrainGroup.add(line)
        }

        cutawayMaterial = new THREE.ShaderMaterial({
          uniforms: {
            uOutlineTex: { value: outlineTexture },
            uTopoTex: { value: topoTexture },
            uReveal: { value: 0.001 },
            uShade: { value: isPremadeTerrain ? 0.94 : 0.88 },
          },
          vertexShader: `
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform sampler2D uOutlineTex;
            uniform sampler2D uTopoTex;
            uniform float uReveal;
            uniform float uShade;
            varying vec2 vUv;
            void main() {
              float blend = smoothstep(uReveal - 0.02, uReveal + 0.02, vUv.x);
              vec3 outlineCol = texture2D(uOutlineTex, vUv).rgb;
              vec3 topoCol = texture2D(uTopoTex, vUv).rgb;
              vec3 color = mix(outlineCol, topoCol, blend) * uShade;
              gl_FragColor = vec4(color, 1.0);
            }
          `,
          side: THREE.DoubleSide,
        })
        for (const edge of ['north', 'south', 'west', 'east'] as const) {
          const segments = edge === 'north' || edge === 'south' ? sampleWidth - 1 : sampleHeight - 1
          const skirtGeometry = createEdgeSkirtGeometry(edge, segments, sampleHeightOnMesh, planeWidth, planeHeight, baseY)
          const skirt = new THREE.Mesh(skirtGeometry, cutawayMaterial)
          terrainGroup.add(skirt)
          skirtMeshes.push(skirt)
        }

        const bottomGeo = new THREE.PlaneGeometry(planeWidth, planeHeight)
        bottomMesh = new THREE.Mesh(bottomGeo, cutawayMaterial)
        bottomMesh.rotation.x = -Math.PI / 2
        bottomMesh.position.y = baseY
        terrainGroup.add(bottomMesh)

        const bounds = new THREE.Box3().setFromObject(terrainGroup)
        const center = bounds.getCenter(new THREE.Vector3())
        const size = bounds.getSize(new THREE.Vector3())
        const radius = Math.max(24, Math.max(size.x, size.y, size.z) * 0.55)

        cameraTrack.introTarget.copy(center).add(new THREE.Vector3(0, size.y * 0.08, 0))
        cameraTrack.finalTarget.copy(center).add(new THREE.Vector3(0, size.y * 0.05, 0))
        cameraTrack.introPos.copy(cameraTrack.introTarget).add(new THREE.Vector3(-radius * 0.34, radius * 1.04, radius * 1.52))
        cameraTrack.finalPos.copy(cameraTrack.finalTarget).add(new THREE.Vector3(radius * 0.18, radius * 1.14, radius * 1.7))
        cameraTrack.introScale = 1.24
        cameraTrack.finalScale = 1
        cameraTrack.introOffsetY = 0.22
        cameraTrack.finalOffsetY = 0

        controls.minDistance = Math.max(42, radius * 0.82)
        controls.maxDistance = Math.max(220, radius * 3.9)
        controls.target.copy(cameraTrack.introTarget)
        camera.position.copy(cameraTrack.introPos)

        const start = performance.now()

        const setPhase = (phase: 'initializing' | 'revealing' | 'docking' | 'interactive') => {
          if (phaseRef.current === phase) return
          phaseRef.current = phase
          setPhaseLabel(phase)
        }

        const animate = (now: number) => {
          if (!active) return
          const elapsed = now - start
          let reveal = 1
          let dockProgress = 1

          if (cinematicRunning) {
            reveal = 0.001
            dockProgress = 0
            if (elapsed <= INTRO_HOLD_MS) {
              setPhase('initializing')
            } else if (elapsed <= INTRO_HOLD_MS + INTRO_REVEAL_MS) {
              setPhase('revealing')
              reveal = clamp((elapsed - INTRO_HOLD_MS) / INTRO_REVEAL_MS, 0, 1)
            } else if (elapsed <= INTRO_HOLD_MS + INTRO_REVEAL_MS + INTRO_DOCK_MS) {
              setPhase('docking')
              reveal = 1
              dockProgress = clamp((elapsed - INTRO_HOLD_MS - INTRO_REVEAL_MS) / INTRO_DOCK_MS, 0, 1)
            } else {
              setPhase('interactive')
              reveal = 1
              dockProgress = 1
              controls.enabled = true
            }
          } else {
            setPhase('interactive')
            reveal = 1
            dockProgress = 1
            controls.enabled = true
          }

          if (edgeMaterial) edgeMaterial.uniforms.uReveal.value = reveal
          if (cutawayMaterial instanceof THREE.ShaderMaterial) {
            cutawayMaterial.uniforms.uReveal.value = reveal
          }

          const easeDock = 1 - Math.pow(1 - dockProgress, 3)
          camera.position.set(
            mix(cameraTrack.introPos.x, cameraTrack.finalPos.x, easeDock),
            mix(cameraTrack.introPos.y, cameraTrack.finalPos.y, easeDock),
            mix(cameraTrack.introPos.z, cameraTrack.finalPos.z, easeDock)
          )
          controls.target.set(
            mix(cameraTrack.introTarget.x, cameraTrack.finalTarget.x, easeDock),
            mix(cameraTrack.introTarget.y, cameraTrack.finalTarget.y, easeDock),
            mix(cameraTrack.introTarget.z, cameraTrack.finalTarget.z, easeDock)
          )
          terrainGroup.scale.setScalar(mix(cameraTrack.introScale, cameraTrack.finalScale, easeDock))
          terrainGroup.position.y = mix(cameraTrack.introOffsetY, cameraTrack.finalOffsetY, easeDock)
          terrainGroup.rotation.y = now * mix(0.00008, 0.000045, easeDock) + mix(0.22, 0, easeDock)

          if (cinematicShell && cinematicRunning && !dockedToPanel) {
            const targetRect = container.getBoundingClientRect()
            const intro = stageRect()
            const left = mix(intro.left, targetRect.left, easeDock)
            const top = mix(intro.top, targetRect.top, easeDock)
            const width = mix(intro.width, targetRect.width, easeDock)
            const height = mix(intro.height, targetRect.height, easeDock)
            cinematicShell.style.left = `${left}px`
            cinematicShell.style.top = `${top}px`
            cinematicShell.style.width = `${width}px`
            cinematicShell.style.height = `${height}px`
            cinematicShell.style.borderRadius = `${Math.round(mix(28, 20, easeDock))}px`
            cinematicShell.style.boxShadow = `0 ${Math.round(mix(24, 18, easeDock))}px ${Math.round(mix(78, 56, easeDock))}px rgba(2,8,23,${mix(0.22, 0.18, easeDock).toFixed(3)})`
            applyRenderSize(width, height)
          }

          if (phaseRef.current === 'interactive' && cinematicShell && cinematicRunning && !dockedToPanel) {
            dockedToPanel = true
            container.innerHTML = ''
            container.appendChild(renderer.domElement)
            applyRenderSize(container.clientWidth || 900, container.clientHeight || 520)
            if (!cinematicDismissed) {
              cinematicDismissed = true
              setCinematicActive(false)
              if (overlay) {
                overlay.style.opacity = '0'
              }
              if (!introCompletedRef.current) introCompletedRef.current = true
              emitIntroComplete()
            }
          }

          controls.update()
          renderer.render(scene, camera)
          animationId = requestAnimationFrame(animate)
        }
        animationId = requestAnimationFrame(animate)
      } catch (err: any) {
        if (!active) return
        setError(String(err?.message || 'hero_render_failed'))
      }
    })()

    const onResize = () => {
      if (cinematicShell && cinematicRunning && !dockedToPanel) {
        const intro = stageRect()
        cinematicShell.style.left = `${intro.left}px`
        cinematicShell.style.top = `${intro.top}px`
        cinematicShell.style.width = `${intro.width}px`
        cinematicShell.style.height = `${intro.height}px`
        applyRenderSize(intro.width, intro.height)
      } else {
        applyRenderSize(container.clientWidth || 900, container.clientHeight || 520)
      }
    }
    window.addEventListener('resize', onResize)

    return () => {
      active = false
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', onResize)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      controls.dispose()
      geometry.dispose()
      baseMaterial?.dispose()
      edgeMaterial?.dispose()
      contourMaterial?.dispose()
      lineMaterial?.dispose()
      outlineTexture?.dispose()
      topoTexture?.dispose()
      skirtMeshes.forEach((mesh) => {
        mesh.geometry.dispose()
      })
      if (bottomMesh) {
        bottomMesh.geometry.dispose()
      }
      cutawayMaterial?.dispose()
      backdropTexture?.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement)
      if (cinematicShell && renderer.domElement.parentNode === cinematicShell) cinematicShell.removeChild(renderer.domElement)
      sceneBootstrappedRef.current = false
    }
  }, [data, heightGrid, heightGridReady, portalHost, introEnabled])

  if (error) {
    return (
      <div className="flex h-[26rem] items-center justify-center rounded-2xl border border-amber-300 bg-amber-50/70 px-4 text-center dark:border-amber-700 dark:bg-amber-950/30">
        <div className="space-y-2">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-100">
            <TriangleAlert className="h-4 w-4" />
            Hero map currently unavailable
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-200">{error || 'Please retry in a moment.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      {cinematicActive && portalHost && createPortal(
        <div
          ref={overlayRef}
          className="pointer-events-none fixed inset-0 z-[80] bg-[hsl(var(--background))] transition-opacity duration-300"
        />,
        portalHost
      )}
      {cinematicActive && portalHost && createPortal(
        <div
          ref={cinematicRef}
          className="pointer-events-none fixed z-[81] overflow-hidden rounded-[28px] border border-border bg-[hsl(var(--background))]"
        />,
        portalHost
      )}
      <div
        ref={containerRef}
        className={`h-[28rem] w-full overflow-hidden rounded-2xl border border-cyan-700/20 bg-[hsl(var(--background))] transition-opacity duration-500 ${
          cinematicActive ? 'opacity-0' : 'opacity-100'
        }`}
      />
      {!cinematicActive && data && (
        <>
          <div className="absolute left-3 top-3 rounded-full border border-cyan-400/30 bg-[#081226]/80 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-cyan-100">
            {phaseLabel === 'interactive' ? 'Interactive' : phaseLabel}
          </div>
          <div className="absolute right-3 top-3 rounded-full border border-cyan-400/30 bg-[#081226]/80 px-3 py-1 text-[11px] text-cyan-100">
            {data.legend.metric.toUpperCase()} | {heightGrid?.source || data.source}
          </div>
        </>
      )}
      {hover && !cinematicActive && (
        <div
          className="pointer-events-none absolute z-20 rounded-md border border-cyan-400/50 bg-[#081226]/90 px-2 py-1 text-[11px] text-cyan-100"
          style={{
            left: Math.min(hover.x + 14, (containerRef.current?.clientWidth || 0) - 120),
            top: Math.max(8, hover.y - 26),
          }}
        >
          NDVI {hover.ndvi.toFixed(3)}
        </div>
      )}
      {data && (
        <div className="mt-3 rounded-xl border border-border bg-card/70 p-3">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <span>NDVI Legend</span>
            <span>{data.legend.unit}</span>
          </div>
          <div className="mt-2 h-3 w-full overflow-hidden rounded-sm border border-black/15">
            <div
              className="h-full w-full"
              style={{
                background: `linear-gradient(90deg, ${legendStops
                  .map((stop) => `rgb(${stop.color[0]}, ${stop.color[1]}, ${stop.color[2]})`)
                  .join(', ')})`,
              }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{data.legend.min.toFixed(3)}</span>
            <span>{data.legend.max.toFixed(3)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
