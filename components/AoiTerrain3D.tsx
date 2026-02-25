'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Loader2, Mountain } from 'lucide-react'
import { type LayerMetric, clamp, legendGradientCss, lerp } from '../lib/visual/topography'
import { renderMetricCanvas } from '../lib/visual/metric-render'

type TerrainQuality = 'high' | 'balanced' | 'light'

type MetricGridData = {
  values: number[]
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
  isSimulated: boolean
}

type TerrainApiPayload = {
  success?: boolean
  degraded?: boolean
  reason?: string
  warnings?: string[]
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
): { texture: THREE.CanvasTexture; range: { min: number; max: number } } {
  if (!metricGrid) throw new Error('metric_grid_missing')
  const rendered = renderMetricCanvas({
    metric,
    grid: {
      values: metricGrid.values,
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
  return {
    texture,
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

export default function AoiTerrain3D({
  open,
  bbox,
  texturePng,
  metricGrid,
  layer,
  selectedCell,
  quality = 'high',
}: {
  open: boolean
  bbox?: [number, number, number, number]
  texturePng?: string | null
  metricGrid?: MetricGridData | null
  layer: LayerMetric
  selectedCell?: string | null
  quality?: TerrainQuality
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

    const order = quality === 'high' ? [128, 96, 64] : quality === 'balanced' ? [96, 64] : [64]

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
              resolution,
              layer,
              quality,
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

          setTerrain(data as TerrainPayload)
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
  }, [open, layer, bbox?.join(','), quality])

  useEffect(() => {
    if (!open || !mountRef.current || !terrain) return
    if (!Array.isArray(terrain.demGrid) || terrain.demGrid.length === 0 || terrain.width < 2 || terrain.height < 2) return

    const container = mountRef.current
    const scene = new THREE.Scene()

    const widthPx = container.clientWidth || 1000
    const heightPx = container.clientHeight || 420

    const camera = new THREE.PerspectiveCamera(50, widthPx / heightPx, 0.1, 1400)
    camera.position.set(0, 90, 148)

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
    controls.maxPolarAngle = Math.PI / 2.03
    controls.minDistance = 30
    controls.maxDistance = 260
    controls.target.set(0, 6, 0)

    scene.add(new THREE.AmbientLight(0xffffff, isDarkTheme ? 0.74 : 0.66))
    const keyLight = new THREE.DirectionalLight(0xf4fbff, isDarkTheme ? 1.12 : 1.04)
    keyLight.position.set(130, 142, 60)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(isDarkTheme ? 0x90b4ff : 0xa2bbd8, isDarkTheme ? 0.5 : 0.42)
    fillLight.position.set(-120, 84, -120)
    scene.add(fillLight)

    const smoothingPasses = quality === 'high' ? 4 : quality === 'balanced' ? 2 : 1
    const smoothed = smoothDemGrid(terrain.demGrid, terrain.width, terrain.height, smoothingPasses)
    const normalization = normalize(Array.from(smoothed))

    const elevationScale = quality === 'high' ? 42 : quality === 'balanced' ? 36 : 31
    const scaledHeight = new Float32Array(smoothed.length)
    const terraceSteps = quality === 'high' ? 80 : quality === 'balanced' ? 64 : 52
    for (let i = 0; i < smoothed.length; i++) {
      const normalized = clamp(normalization.apply(smoothed[i]), 0, 1)
      const shaped = Math.pow(normalized, 1.08)
      const terraced = Math.round(shaped * terraceSteps) / terraceSteps
      scaledHeight[i] = lerp(shaped, terraced, 0.68) * elevationScale
    }

    const planeWidth = 120
    const planeHeight = 120
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

    const skirtBaseY = -1.35
    const sampleHeightOnMesh = (u: number, v: number) => sampleHeight(scaledHeight, terrain.width, terrain.height, u, v)
    const skirtMaterial = new THREE.MeshStandardMaterial({
      color: isDarkTheme ? 0x58728e : 0x8ca3b7,
      roughness: 0.92,
      metalness: 0.01,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.96,
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
      color: isDarkTheme ? 0x36506a : 0xa5b8c8,
      roughness: 0.94,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.94,
    })
    const bottomMesh = new THREE.Mesh(bottomGeo, bottomMat)
    bottomMesh.rotation.x = -Math.PI / 2
    bottomMesh.position.y = skirtBaseY
    scene.add(bottomMesh)

    const contourMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uMaxHeight: { value: elevationScale },
        uDensity: { value: quality === 'high' ? 38 : quality === 'balanced' ? 32 : 26 },
        uThickness: { value: 0.034 },
        uOpacity: { value: isDarkTheme ? 0.42 : 0.35 },
        uLineColor: { value: new THREE.Color(isDarkTheme ? 0x1f3349 : 0x4f677f) },
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
    contourMesh.position.y = 0.26
    scene.add(contourMesh)

    const disposables: Array<() => void> = []

    let cancelled = false
    let metricTexture: THREE.CanvasTexture | null = null
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
        metricTexture.anisotropy = Math.max(2, Math.min(maxAnisotropy, 16))
        colorOverlayMaterial.map = metricTexture
        colorOverlayMaterial.needsUpdate = true
        skirtMaterial.map = metricTexture
        skirtMaterial.needsUpdate = true
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

    const buildCellLoop = (
      u0: number,
      u1: number,
      v0: number,
      v1: number,
      options?: {
        color?: number
        opacity?: number
        lift?: number
        lineWidth?: number
      }
    ) => {
      const points = [
        toWorld(u0, v0, options?.lift ?? 0.18),
        toWorld(u1, v0, options?.lift ?? 0.18),
        toWorld(u1, v1, options?.lift ?? 0.18),
        toWorld(u0, v1, options?.lift ?? 0.18),
      ]
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

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        buildCellLoop(col / 3, (col + 1) / 3, row / 3, (row + 1) / 3, {
          color: isDarkTheme ? 0xc1ddff : 0x275072,
          opacity: isDarkTheme ? 0.74 : 0.62,
          lift: 0.26,
        })
      }
    }

    if (selected) {
      const u0 = selected.col / 3
      const u1 = (selected.col + 1) / 3
      const v0 = selected.row / 3
      const v1 = (selected.row + 1) / 3

      const corners = [
        { u: u0, v: v0 },
        { u: u1, v: v0 },
        { u: u1, v: v1 },
        { u: u0, v: v1 },
      ]
      const fillGeo = new THREE.BufferGeometry().setFromPoints([
        toWorld(u0, v0, 0.2),
        toWorld(u1, v0, 0.2),
        toWorld(u1, v1, 0.2),
        toWorld(u0, v1, 0.2),
      ])
      fillGeo.setIndex([0, 1, 2, 0, 2, 3])
      fillGeo.computeVertexNormals()
      const fillMat = new THREE.MeshBasicMaterial({
        color: 0x4dd8ff,
        transparent: true,
        opacity: 0.21,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const fillMesh = new THREE.Mesh(fillGeo, fillMat)
      scene.add(fillMesh)
      disposables.push(() => {
        fillGeo.dispose()
        fillMat.dispose()
      })

      buildCellLoop(u0, u1, v0, v1, {
        color: 0x8ff4ff,
        opacity: 1,
        lift: 0.38,
      })

      buildCellLoop(u0, u1, v0, v1, {
        color: 0xfff28c,
        opacity: 0.86,
        lift: 0.48,
      })

      for (const corner of corners) {
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
        const centerU = (u0 + u1) / 2
        const centerV = (v0 + v1) / 2
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
      disposables.forEach((dispose) => dispose())
      renderer.dispose()
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [open, terrain, metricGrid, selectedCell, layer, quality, selectedLabel, isDarkTheme, hasMetricGrid])

  if (!open) return null

  return (
    <div className="rounded-2xl border border-border bg-card p-3 text-foreground">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Mountain className="h-4 w-4 text-sky-300" />
          3D Terrain Viewer
        </p>
        <p className="text-xs text-muted-foreground">
          Metric: {layerLabel(layer)} | {terrain?.source || 'loading terrain'}
        </p>
      </div>
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
          ? `High-fidelity topographic surface using ${layerLabel(layer)} color mapping from ${hasMetricGrid ? 'quantitative grid data' : 'neutral fallback shading'}. Selected plot point: ${selectedLabel || 'none'}${meshMeta ? ` | mesh ${meshMeta.resolution}px${meshMeta.smoothed ? ', smoothed' : ''}` : ''}.`
          : 'Terrain will appear when providers return valid DEM coverage for this AOI.'}
      </p>
    </div>
  )
}
