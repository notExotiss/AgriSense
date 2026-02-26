'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Loader2, Mountain } from 'lucide-react'
import type { CellFootprint, GeoJsonPolygon } from '../lib/types/api'
import { type LayerMetric, clamp, legendGradientCss, lerp, sampleTopographyPalette } from '../lib/visual/topography'
import { renderMetricCanvas } from '../lib/visual/metric-render'
import { buildScaledHeightGrid } from '../lib/terrain/mesh-builder'
import { createContourShaderMaterial } from '../lib/terrain/shaders'

type MetricGridData = {
  values: number[]
  validMask?: number[]
  width: number
  height: number
  min: number
  max: number
  source: string
  units: string
  isSimulated: boolean
}

type TerrainPayload = {
  demGrid: number[]
  width: number
  height: number
  bbox: [number, number, number, number]
  source: string
  demSource?: string
  demDataset?: string
  modelType?: 'DTM' | 'DSM'
  verticalDatum?: string
  isSimulated: boolean
  sourceResolutionMeters?: number
  effectiveResolutionMeters?: number
  precisionClass?: 'high' | 'medium' | 'low'
  voidFillRatio?: number
  zStats?: {
    zMin: number
    zMax: number
    zP05: number
    zP95: number
  }
  providerResolutionMeters?: number
  pixelSizeMeters?: number
  coverage?: number
}

type TerrainApiPayload = {
  success?: boolean
  degraded?: boolean
  reason?: string
  warnings?: string[]
  source?: string
  demSource?: string
  demDataset?: string
  modelType?: 'DTM' | 'DSM'
  verticalDatum?: string
  sourceResolutionMeters?: number
  effectiveResolutionMeters?: number
  precisionClass?: 'high' | 'medium' | 'low'
  voidFillRatio?: number
  zStats?: {
    zMin: number
    zMax: number
    zP05: number
    zP95: number
  }
  data?: TerrainPayload
  meshMeta?: {
    smoothed?: boolean
    resolution?: number
  }
}

function parseCell(cellId: string | null | undefined) {
  if (!cellId || !cellId.includes('-')) return null
  const [rowText, colText] = cellId.split('-')
  const row = Number(rowText)
  const col = Number(colText)
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null
  return { row, col }
}

function labelForCell(cellId: string | null | undefined) {
  const parsed = parseCell(cellId)
  if (!parsed) return null
  return `P${parsed.row * 3 + parsed.col + 1}`
}

function normalize(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value))
  const min = finite.length ? Math.min(...finite) : 0
  const max = finite.length ? Math.max(...finite) : 1
  const range = Math.max(1e-6, max - min)
  return {
    min,
    max,
    range,
    apply: (value: number) => (value - min) / range,
  }
}

function smoothDemGrid(values: number[], width: number, height: number, passes: number) {
  const size = width * height
  const base = new Float32Array(size)
  for (let index = 0; index < size; index++) {
    const value = Number(values[index])
    base[index] = Number.isFinite(value) ? value : 0
  }

  if (passes <= 0 || width < 3 || height < 3) return base

  const { min, max } = normalize(Array.from(base))
  const preserveDelta = Math.max(0.5, (max - min) * 0.18)

  let current = base
  for (let pass = 0; pass < passes; pass++) {
    const horizontal = new Float32Array(size)
    const vertical = new Float32Array(size)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        const left = current[y * width + Math.max(0, x - 1)]
        const center = current[idx]
        const right = current[y * width + Math.min(width - 1, x + 1)]
        horizontal[idx] = left * 0.2 + center * 0.6 + right * 0.2
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        const up = horizontal[Math.max(0, y - 1) * width + x]
        const center = horizontal[idx]
        const down = horizontal[Math.min(height - 1, y + 1) * width + x]
        const candidate = up * 0.2 + center * 0.6 + down * 0.2
        const original = base[idx]
        vertical[idx] = clamp(candidate, original - preserveDelta, original + preserveDelta)
      }
    }

    current = vertical
  }

  return current
}

function createMetricTexture(
  metricGrid: MetricGridData | null | undefined,
  metric: LayerMetric,
  width: number,
  height: number
): { texture: THREE.CanvasTexture; opaqueTexture: THREE.CanvasTexture; range: { min: number; max: number } } {
  if (!metricGrid) throw new Error('metric_grid_missing')
  const rendered = renderMetricCanvas({
    metric,
    grid: {
      values: metricGrid.values,
      validMask: metricGrid.validMask,
      width: metricGrid.width,
      height: metricGrid.height,
      min: metricGrid.min,
      max: metricGrid.max,
    },
    outputWidth: width,
    outputHeight: height,
    contours: false,
  })

  const texture = new THREE.CanvasTexture(rendered.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true

  const opaqueCanvas = document.createElement('canvas')
  opaqueCanvas.width = rendered.canvas.width
  opaqueCanvas.height = rendered.canvas.height
  const opaqueCtx = opaqueCanvas.getContext('2d')
  if (!opaqueCtx) throw new Error('opaque_metric_canvas_failed')
  opaqueCtx.drawImage(rendered.canvas, 0, 0)
  const imageData = opaqueCtx.getImageData(0, 0, opaqueCanvas.width, opaqueCanvas.height)
  const data = imageData.data
  const fallback = sampleTopographyPalette(metric, 0.5)
  for (let y = 0; y < opaqueCanvas.height; y++) {
    let lastR = fallback[0]
    let lastG = fallback[1]
    let lastB = fallback[2]
    for (let x = 0; x < opaqueCanvas.width; x++) {
      const idx = (y * opaqueCanvas.width + x) * 4
      const alpha = data[idx + 3]
      if (alpha > 0) {
        lastR = data[idx]
        lastG = data[idx + 1]
        lastB = data[idx + 2]
        data[idx + 3] = 255
        continue
      }
      data[idx] = lastR
      data[idx + 1] = lastG
      data[idx + 2] = lastB
      data[idx + 3] = 255
    }
  }
  opaqueCtx.putImageData(imageData, 0, 0)

  const opaqueTexture = new THREE.CanvasTexture(opaqueCanvas)
  opaqueTexture.colorSpace = THREE.SRGBColorSpace
  opaqueTexture.wrapS = THREE.ClampToEdgeWrapping
  opaqueTexture.wrapT = THREE.ClampToEdgeWrapping
  opaqueTexture.needsUpdate = true

  return {
    texture,
    opaqueTexture,
    range: rendered.range,
  }
}

function sampleHeight(
  scaledHeight: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number
) {
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

  const top = lerp(scaledHeight[idx00], scaledHeight[idx10], tx)
  const bottom = lerp(scaledHeight[idx01], scaledHeight[idx11], tx)
  return lerp(top, bottom, ty)
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
  const outset = 2.6

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
    const topY = sampleHeightFn(u, v) + 0.04
    let bottomX = x
    let bottomZ = z
    if (edge === 'north') bottomZ -= outset
    if (edge === 'south') bottomZ += outset
    if (edge === 'west') bottomX -= outset
    if (edge === 'east') bottomX += outset
    vertices.push(x, topY, z)
    vertices.push(bottomX, baseY, bottomZ)
    uvs.push(u, v)
    uvs.push(u, v)
  }

  for (let i = 0; i < segments; i++) {
    const offset = i * 2
    indices.push(offset, offset + 1, offset + 2)
    indices.push(offset + 1, offset + 3, offset + 2)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createDotSprite(color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, 64, 64)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(32, 32, 11, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.96)'
  ctx.lineWidth = 4
  ctx.stroke()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(1.6, 1.6, 1)
  return { sprite, texture, material }
}

function createTextSprite(label: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 80
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(6, 11, 24, 0.82)'
  ctx.fillRect(8, 12, 240, 56)
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.95)'
  ctx.lineWidth = 3
  ctx.strokeRect(8, 12, 240, 56)
  ctx.fillStyle = '#e2f5ff'
  ctx.font = '600 34px "IBM Plex Sans", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(14, 4.4, 1)
  return { sprite, texture, material }
}

function layerLabel(layer: LayerMetric) {
  if (layer === 'soil') return 'Soil Moisture'
  if (layer === 'et') return 'Evapotranspiration'
  return 'NDVI'
}

function layerUnits(layer: LayerMetric, metricGrid?: MetricGridData | null) {
  if (metricGrid?.units) return metricGrid.units
  if (layer === 'soil') return 'm3/m3'
  if (layer === 'et') return 'mm/day'
  return 'NDVI'
}

function uvFromLonLat(bbox: [number, number, number, number], lon: number, lat: number) {
  const u = clamp((lon - bbox[0]) / Math.max(1e-9, bbox[2] - bbox[0]), 0, 1)
  const v = clamp((bbox[3] - lat) / Math.max(1e-9, bbox[3] - bbox[1]), 0, 1)
  return { u, v }
}

function footprintToUvPoints(
  footprint: CellFootprint | undefined | null,
  bbox: [number, number, number, number]
) {
  const ring = footprint?.polygon?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 4) return []
  const points: Array<{ u: number; v: number }> = []
  for (const coord of ring) {
    const lon = Number(coord?.[0])
    const lat = Number(coord?.[1])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    points.push(uvFromLonLat(bbox, lon, lat))
  }
  return points.length >= 4 ? points : []
}

export default function AoiTerrain3D({
  open,
  bbox,
  geometry,
  alignmentBbox,
  cellFootprints,
  texturePng,
  metricGrid,
  layer,
  selectedCell,
}: {
  open: boolean
  bbox?: [number, number, number, number]
  geometry?: GeoJsonPolygon | null
  alignmentBbox?: [number, number, number, number]
  cellFootprints?: CellFootprint[] | null
  texturePng?: string | null
  metricGrid?: MetricGridData | null
  layer: LayerMetric
  selectedCell?: string | null
}) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [terrain, setTerrain] = useState<TerrainPayload | null>(null)
  const [meshMeta, setMeshMeta] = useState<{ smoothed: boolean; resolution: number } | null>(null)
  const [metricRange, setMetricRange] = useState<{ min: number; max: number } | null>(null)
  const selected = useMemo(() => parseCell(selectedCell), [selectedCell])
  const selectedLabel = useMemo(() => labelForCell(selectedCell), [selectedCell])
  const hasMetricGrid = useMemo(
    () =>
      Boolean(
        metricGrid &&
        Array.isArray(metricGrid.values) &&
        metricGrid.width > 1 &&
        metricGrid.height > 1 &&
        metricGrid.values.length >= metricGrid.width * metricGrid.height
      ),
    [metricGrid]
  )
  void texturePng
  const [isDarkTheme, setIsDarkTheme] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const updateTheme = () => setIsDarkTheme(root.classList.contains('dark'))
    updateTheme()
    const observer = new MutationObserver(updateTheme)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!open || !bbox) return
    const controller = new AbortController()

    // Single stable fetch profile; avoid user-facing quality modes.
    const order = [224, 192, 160, 128]

    async function load() {
      setLoading(true)
      setError(null)
      setTerrain(null)
      try {
        let failureMessage = 'Terrain fetch failed'
        for (const resolution of order) {
          const response = await fetch('/api/terrain/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bbox,
              geometry: geometry || null,
              resolution,
              layer,
            }),
            signal: controller.signal,
          })
          const payload = (await response.json().catch(() => ({}))) as TerrainApiPayload
          if (!response.ok || !payload?.success) {
            failureMessage = String((payload as any)?.message || (payload as any)?.error || `Terrain fetch failed (${response.status})`)
            continue
          }

          const degraded = Boolean(payload?.degraded)
          const data = payload?.data
          const validGrid =
            data &&
            Array.isArray(data.demGrid) &&
            data.demGrid.length > 0 &&
            Number(data.width) > 1 &&
            Number(data.height) > 1

          if (degraded || !validGrid) {
            failureMessage =
              String(payload?.warnings?.[0] || payload?.reason || 'Terrain unavailable for the selected AOI.')
            continue
          }

          setTerrain({
            ...(data as TerrainPayload),
            demSource: data?.demSource || payload?.demSource || data?.source || payload?.source,
            demDataset: data?.demDataset || payload?.demDataset,
            modelType: data?.modelType || payload?.modelType,
            verticalDatum: data?.verticalDatum || payload?.verticalDatum,
            sourceResolutionMeters:
              data?.sourceResolutionMeters ?? payload?.sourceResolutionMeters ?? data?.providerResolutionMeters,
            effectiveResolutionMeters:
              data?.effectiveResolutionMeters ?? payload?.effectiveResolutionMeters ?? data?.pixelSizeMeters,
            precisionClass: data?.precisionClass || payload?.precisionClass,
            voidFillRatio: data?.voidFillRatio ?? payload?.voidFillRatio,
            zStats: data?.zStats || payload?.zStats,
          })
          setMeshMeta({
            smoothed: Boolean(payload?.meshMeta?.smoothed ?? true),
            resolution: Number(payload?.meshMeta?.resolution || resolution),
          })
          setError(null)
          return
        }

        setTerrain(null)
        setError(failureMessage)
      } catch (e: any) {
        if (controller.signal.aborted) return
        setTerrain(null)
        setError(String(e?.message || 'Terrain fetch failed'))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [open, layer, bbox?.join(','), JSON.stringify(geometry || null)])

  useEffect(() => {
    if (!open || !mountRef.current || !terrain) return
    if (!Array.isArray(terrain.demGrid) || terrain.demGrid.length === 0 || terrain.width < 2 || terrain.height < 2) return

    const container = mountRef.current
    const scene = new THREE.Scene()

    const widthPx = container.clientWidth || 1000
    const heightPx = container.clientHeight || 420

    const camera = new THREE.PerspectiveCamera(48, widthPx / heightPx, 0.1, 1400)
    camera.position.set(0, 84, 136)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(widthPx, heightPx)
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.02
    renderer.setClearColor(0x000000, 0)

    container.innerHTML = ''
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI / 2.45
    controls.minDistance = 24
    controls.maxDistance = 520
    controls.minPolarAngle = 0.22
    controls.target.set(0, 0, 0)

    scene.add(new THREE.AmbientLight(0xffffff, isDarkTheme ? 0.74 : 0.66))
    const keyLight = new THREE.DirectionalLight(0xf4fbff, isDarkTheme ? 1.12 : 1.04)
    keyLight.position.set(130, 142, 60)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(isDarkTheme ? 0x90b4ff : 0xa2bbd8, isDarkTheme ? 0.5 : 0.42)
    fillLight.position.set(-120, 84, -120)
    scene.add(fillLight)

    const smoothingPasses = 0
    const smoothed = smoothDemGrid(terrain.demGrid, terrain.width, terrain.height, smoothingPasses)
    const built = buildScaledHeightGrid({
      demGrid: Array.from(smoothed),
      width: terrain.width,
      height: terrain.height,
      bbox: terrain.bbox,
    })
    const planeWidth = built.planeWidth
    const planeHeight = built.planeHeight
    const scaledHeight = built.scaledHeight
    const elevationScale = built.elevationScale
    const reliefUnits = built.elevationScale
    const maxPlane = Math.max(planeWidth, planeHeight)
    const minPlane = Math.min(planeWidth, planeHeight)
    const targetY = clamp(elevationScale * 0.3, 2.4, 34)
    const cameraDistance = clamp(maxPlane * 0.92, 56, 300)
    const cameraHeight = clamp(Math.max(maxPlane * 0.46, targetY + elevationScale * 2.4), 38, 170)

    camera.position.set(0, cameraHeight, cameraDistance)
    controls.target.set(0, targetY, 0)
    controls.minDistance = clamp(minPlane * 0.5, 24, 160)
    controls.maxDistance = clamp(maxPlane * 3.2, 150, 620)
    controls.update()

    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, terrain.width - 1, terrain.height - 1)
    const position = geometry.attributes.position as THREE.BufferAttribute

    for (let i = 0; i < scaledHeight.length; i++) {
      position.setZ(i, scaledHeight[i])
    }
    position.needsUpdate = true
    geometry.computeVertexNormals()

    const baseMaterial = new THREE.MeshStandardMaterial({
      color: isDarkTheme ? 0x5f7187 : 0x93a0ae,
      metalness: 0.03,
      roughness: 0.9,
    })

    const terrainMesh = new THREE.Mesh(geometry, baseMaterial)
    terrainMesh.rotation.x = -Math.PI / 2
    scene.add(terrainMesh)

    const colorOverlayMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
    })
    const colorOverlayMesh = new THREE.Mesh(geometry, colorOverlayMaterial)
    colorOverlayMesh.rotation.x = -Math.PI / 2
    colorOverlayMesh.position.y = 0.18
    scene.add(colorOverlayMesh)

    const subtleFrame = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: isDarkTheme ? 0x99afc8 : 0x2a3e52,
        transparent: true,
        opacity: isDarkTheme ? 0.14 : 0.1,
      })
    )
    subtleFrame.rotation.x = -Math.PI / 2
    scene.add(subtleFrame)

    const skirtDepthFromRelief = (built.reliefMeters / Math.max(1e-6, built.metersPerUnit)) * 0.08
    const skirtBaseY = -clamp(skirtDepthFromRelief, 0.28, 1.2)
    const sampleHeightOnMesh = (u: number, v: number) => sampleHeight(scaledHeight, terrain.width, terrain.height, u, v)
    const skirtMaterial = new THREE.MeshStandardMaterial({
      color: isDarkTheme ? 0x58728e : 0x8ca3b7,
      roughness: 0.92,
      metalness: 0.01,
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1,
    })
    const skirtMeshes: THREE.Mesh[] = []
    for (const edge of ['north', 'south', 'west', 'east'] as const) {
      const segments = edge === 'north' || edge === 'south' ? terrain.width - 1 : terrain.height - 1
      const skirtGeometry = createEdgeSkirtGeometry(edge, segments, sampleHeightOnMesh, planeWidth, planeHeight, skirtBaseY)
      const skirtMesh = new THREE.Mesh(skirtGeometry, skirtMaterial)
      scene.add(skirtMesh)
      skirtMeshes.push(skirtMesh)
    }

    const bottomGeo = new THREE.PlaneGeometry(planeWidth, planeHeight)
    const bottomMat = new THREE.MeshStandardMaterial({
      color: isDarkTheme ? 0x476886 : 0x9db6ca,
      roughness: 0.94,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1,
    })
    const bottomMesh = new THREE.Mesh(bottomGeo, bottomMat)
    bottomMesh.rotation.x = -Math.PI / 2
    bottomMesh.position.y = skirtBaseY
    scene.add(bottomMesh)

    const contourMaterial = createContourShaderMaterial({
      maxHeight: elevationScale,
      reliefUnits,
      isDarkTheme,
      quality: 'balanced',
    })
    const contourMesh = new THREE.Mesh(geometry, contourMaterial)
    contourMesh.rotation.x = -Math.PI / 2
    contourMesh.position.y = 0.26
    scene.add(contourMesh)

    const disposables: Array<() => void> = []

    let cancelled = false
    let metricTexture: THREE.CanvasTexture | null = null
    let sideTexture: THREE.CanvasTexture | null = null
    if (!hasMetricGrid) {
      setMetricRange(null)
    }
    void (async () => {
      if (!hasMetricGrid) return
      try {
        const rendered = await createMetricTexture(metricGrid, layer, terrain.width, terrain.height)
        if (cancelled) {
          rendered.texture.dispose()
          return
        }
        const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
        metricTexture = rendered.texture
        sideTexture = rendered.opaqueTexture
        metricTexture.anisotropy = Math.max(2, Math.min(maxAnisotropy, 16))
        sideTexture.anisotropy = Math.max(2, Math.min(maxAnisotropy, 16))
        colorOverlayMaterial.map = metricTexture
        colorOverlayMaterial.needsUpdate = true
        skirtMaterial.map = sideTexture
        skirtMaterial.needsUpdate = true
        bottomMat.map = sideTexture
        bottomMat.needsUpdate = true
        setMetricRange(rendered.range)
      } catch {
        setMetricRange(null)
        // Leave neutral material if texture generation fails.
      }
    })()

    const toWorld = (u: number, v: number, lift = 0) => {
      const x = -planeWidth / 2 + u * planeWidth
      const z = -planeHeight / 2 + v * planeHeight
      const y = sampleHeight(scaledHeight, terrain.width, terrain.height, u, v) + lift
      return new THREE.Vector3(x, y, z)
    }

    const buildLoopFromUvPoints = (
      uvPoints: Array<{ u: number; v: number }>,
      options?: {
        color?: number
        opacity?: number
        lift?: number
        lineWidth?: number
      }
    ) => {
      if (!Array.isArray(uvPoints) || uvPoints.length < 3) return null
      const points = uvPoints.map((point) => toWorld(point.u, point.v, options?.lift ?? 0.18))
      const geo = new THREE.BufferGeometry().setFromPoints(points)
      const mat = new THREE.LineBasicMaterial({
        color: options?.color ?? (isDarkTheme ? 0xd6e5ff : 0x1f3a52),
        transparent: true,
        opacity: options?.opacity ?? (isDarkTheme ? 0.76 : 0.6),
        linewidth: options?.lineWidth ?? 1,
        depthTest: false,
        depthWrite: false,
      })
      const loop = new THREE.LineLoop(geo, mat)
      scene.add(loop)
      disposables.push(() => {
        geo.dispose()
        mat.dispose()
      })
      return loop
    }

    const alignment = alignmentBbox || terrain.bbox
    const footprintMap = new Map<string, Array<{ u: number; v: number }>>()
    if (Array.isArray(cellFootprints) && cellFootprints.length) {
      for (const footprint of cellFootprints) {
        const points = footprintToUvPoints(footprint, alignment)
        if (points.length >= 4) {
          footprintMap.set(footprint.cellId, points)
        }
      }
    }

    const fallbackCellPoints = (row: number, col: number) => [
      { u: col / 3, v: row / 3 },
      { u: (col + 1) / 3, v: row / 3 },
      { u: (col + 1) / 3, v: (row + 1) / 3 },
      { u: col / 3, v: (row + 1) / 3 },
    ]

    const cellUvMap = new Map<string, Array<{ u: number; v: number }>>()
    const useFootprintOnly = footprintMap.size > 0
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const cellId = `${row}-${col}`
        const footprint = footprintMap.get(cellId)
        if (useFootprintOnly) {
          if (footprint && footprint.length >= 3) {
            cellUvMap.set(cellId, footprint)
          }
          continue
        }
        cellUvMap.set(cellId, footprint || fallbackCellPoints(row, col))
      }
    }

    for (const uvPoints of Array.from(cellUvMap.values())) {
      buildLoopFromUvPoints(uvPoints, {
        color: isDarkTheme ? 0xc1ddff : 0x275072,
        opacity: isDarkTheme ? 0.74 : 0.62,
        lift: 0.26,
      })
    }

    if (selected) {
      const selectedCellId = `${selected.row}-${selected.col}`
      const selectedPoints = cellUvMap.get(selectedCellId)
      if (!selectedPoints || selectedPoints.length < 3) {
        // Skip non-exact selected highlight when only precise footprints are allowed.
      } else {

        buildLoopFromUvPoints(selectedPoints, {
          color: 0x8ff4ff,
          opacity: 1,
          lift: 0.38,
        })

        buildLoopFromUvPoints(selectedPoints, {
          color: 0xfff28c,
          opacity: 0.86,
          lift: 0.48,
        })

        const beaconPoints =
          selectedPoints.length > 8
            ? selectedPoints.filter((_, index) => index % Math.ceil(selectedPoints.length / 8) === 0)
            : selectedPoints

        for (const corner of beaconPoints) {
          const base = toWorld(corner.u, corner.v, 0.4)
          const top = base.clone()
          top.y += 2.8

          const shaftGeo = new THREE.CylinderGeometry(0.09, 0.09, 2.8, 10)
          const shaftMat = new THREE.MeshStandardMaterial({
            color: 0xa5f3fc,
            emissive: 0x0e7490,
            emissiveIntensity: 0.6,
            roughness: 0.35,
          })
          const shaft = new THREE.Mesh(shaftGeo, shaftMat)
          shaft.position.set(base.x, (base.y + top.y) / 2, base.z)
          scene.add(shaft)

          const dot = createDotSprite('#67e8f9')
          if (dot) {
            dot.sprite.position.set(top.x, top.y, top.z)
            scene.add(dot.sprite)
            disposables.push(() => {
              dot.texture.dispose()
              dot.material.dispose()
            })
          }

          disposables.push(() => {
            shaftGeo.dispose()
            shaftMat.dispose()
          })
        }

        if (selectedLabel) {
          const centerU =
            selectedPoints.reduce((acc, point) => acc + point.u, 0) / Math.max(1, selectedPoints.length)
          const centerV =
            selectedPoints.reduce((acc, point) => acc + point.v, 0) / Math.max(1, selectedPoints.length)
          const center = toWorld(centerU, centerV, 4.2)
          const text = createTextSprite(selectedLabel)
          if (text) {
            text.sprite.position.set(center.x, center.y, center.z)
            scene.add(text.sprite)
            disposables.push(() => {
              text.texture.dispose()
              text.material.dispose()
            })
          }
        }
      }
    }

    let active = true
    const animate = () => {
      if (!active) return
      controls.update()
      renderer.render(scene, camera)
      requestAnimationFrame(animate)
    }
    animate()

    const onResize = () => {
      const w = container.clientWidth || 1000
      const h = container.clientHeight || 420
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelled = true
      active = false
      window.removeEventListener('resize', onResize)
      controls.dispose()
      geometry.dispose()
      subtleFrame.geometry.dispose()
      ;(subtleFrame.material as THREE.Material).dispose()
      baseMaterial.dispose()
      colorOverlayMaterial.dispose()
      contourMaterial.dispose()
      skirtMeshes.forEach((mesh) => mesh.geometry.dispose())
      skirtMaterial.dispose()
      bottomGeo.dispose()
      bottomMat.dispose()
      metricTexture?.dispose()
      sideTexture?.dispose()
      disposables.forEach((dispose) => dispose())
      renderer.dispose()
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [
    open,
    terrain,
    metricGrid,
    selectedCell,
    layer,
    selectedLabel,
    isDarkTheme,
    hasMetricGrid,
    alignmentBbox?.join(','),
    JSON.stringify(cellFootprints || []),
  ])

  if (!open) return null

  return (
    <div className="rounded-2xl border border-border bg-card p-3 text-foreground">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Mountain className="h-4 w-4 text-sky-300" />
          3D Terrain Viewer
        </p>
        <div className="text-right text-xs text-muted-foreground">
          <p>Metric: {layerLabel(layer)} | {terrain?.demSource || terrain?.source || 'loading terrain'}</p>
          <p>
            {terrain?.modelType || 'n/a'} | {terrain?.demDataset || 'n/a'}
            {terrain?.effectiveResolutionMeters ? ` | ~${terrain.effectiveResolutionMeters.toFixed(1)}m/pixel` : ''}
          </p>
        </div>
      </div>
      {terrain?.precisionClass === 'low' && (
        <div className="mb-2 rounded-lg border border-amber-700/60 bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-300">
          Precision warning: DEM resolution is coarse for strict plot-level relief certainty in this AOI.
        </div>
      )}
      {loading && (
        <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading DEM for selected AOI
        </div>
      )}
      {error && (
        <div className="mb-2 rounded-lg border border-rose-700/60 bg-rose-500/10 px-2 py-1 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}
      {!hasMetricGrid && (
        <div className="mb-2 rounded-lg border border-amber-700/50 bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-300">
          Quantitative {layerLabel(layer)} grid is unavailable for this run, so numeric color overlay is disabled.
        </div>
      )}
      <div
        ref={mountRef}
        className={`h-[24rem] w-full overflow-hidden rounded-xl border border-border/70 ${
          isDarkTheme
            ? 'bg-[radial-gradient(120%_100%_at_20%_0%,rgba(22,101,139,0.35)_0%,rgba(6,24,44,0.92)_52%,rgba(4,13,27,0.98)_100%)]'
            : 'bg-[radial-gradient(120%_100%_at_15%_0%,rgba(186,230,253,0.9)_0%,rgba(224,242,254,0.76)_45%,rgba(214,226,236,0.94)_100%)]'
        }`}
      />
      <div className="mt-2 rounded-lg border border-border/80 bg-muted/35 p-2">
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {layerLabel(layer)} scale {hasMetricGrid ? (metricGrid?.isSimulated ? '(simulated)' : '(measured)') : '(unavailable)'}
        </p>
        <div
          className="mt-1 h-3 w-full rounded"
          style={{ backgroundImage: legendGradientCss(layer) }}
        />
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{hasMetricGrid ? (metricRange?.min ?? metricGrid?.min ?? 0).toFixed(3) : 'N/A'}</span>
          <span>{layerUnits(layer, metricGrid)}</span>
          <span>{hasMetricGrid ? (metricRange?.max ?? metricGrid?.max ?? 1).toFixed(3) : 'N/A'}</span>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {terrain
          ? `Topographic surface uses ${terrain.modelType || 'DTM'} elevation from ${terrain.demSource || terrain.source}${terrain.demDataset ? ` (${terrain.demDataset})` : ''} with ${layerLabel(layer)} color mapping from ${hasMetricGrid ? 'quantitative grid data' : 'neutral fallback shading'}. Selected plot point: ${selectedLabel || 'none'}${meshMeta ? ` | mesh ${meshMeta.resolution}px${meshMeta.smoothed ? ', smoothed' : ''}` : ''}${terrain.sourceResolutionMeters ? ` | source ~${terrain.sourceResolutionMeters.toFixed(1)}m` : ''}${terrain.effectiveResolutionMeters ? ` | effective ~${terrain.effectiveResolutionMeters.toFixed(1)}m` : ''}${terrain.verticalDatum ? ` | datum ${terrain.verticalDatum}` : ''}${typeof terrain.coverage === 'number' ? ` | AOI cover ${(terrain.coverage * 100).toFixed(1)}%` : ''}${typeof terrain.voidFillRatio === 'number' ? ` | void fill ${(terrain.voidFillRatio * 100).toFixed(1)}%` : ''}.`
          : 'Terrain will appear when providers return valid DEM coverage for this AOI.'}
      </p>
    </div>
  )
}
