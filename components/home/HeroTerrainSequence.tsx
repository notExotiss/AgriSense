'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Loader2, TriangleAlert } from 'lucide-react'

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

type HeroApiResponse = {
  success: boolean
  cacheHit: boolean
  data?: HeroMapPayload
  warnings?: string[]
  message?: string
}

type HeroTerrainApiResponse = {
  success?: boolean
  degraded?: boolean
  data?: {
    demGrid?: number[]
    width?: number
    height?: number
    source?: string
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function mix(start: number, end: number, t: number) {
  return start + (end - start) * t
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
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const [data, setData] = useState<HeroMapPayload | null>(null)
  const [heightGrid, setHeightGrid] = useState<HeightGridState | null>(null)
  const [heightGridReady, setHeightGridReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [phaseLabel, setPhaseLabel] = useState<'initializing' | 'revealing' | 'docking' | 'interactive'>('initializing')
  const [cinematicActive, setCinematicActive] = useState(introMode === 'run')
  const phaseRef = useRef<'initializing' | 'revealing' | 'docking' | 'interactive'>('initializing')

  const legendStops = useMemo(() => data?.legend?.stops || [], [data?.legend?.stops])

  useEffect(() => {
    setCinematicActive(introMode === 'run')
    if (introMode === 'skip') {
      introCompletedRef.current = true
      setPhaseLabel('interactive')
      phaseRef.current = 'interactive'
    }
  }, [introMode])

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
    phaseRef.current = 'initializing'
    setPhaseLabel('initializing')
    if (introMode === 'run') {
      setCinematicActive(true)
      introCompletedRef.current = false
    }
  }, [data?.generatedAt, introMode])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setHeightGridReady(false)

    void (async () => {
      try {
        const response = await fetch('/api/home/hero-map')
        const payload = (await response.json().catch(() => ({}))) as HeroApiResponse
        if (!response.ok || !payload?.success || !payload?.data) {
          throw new Error(payload?.message || 'hero_map_unavailable')
        }
        if (!active) return

        let heroHeightGrid: HeightGridState | null = null
        try {
          const terrainResponse = await fetch('/api/terrain/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bbox: payload.data.bbox,
              resolution: 128,
              layer: 'ndvi',
              quality: 'high',
            }),
          })
          const terrainPayload = (await terrainResponse.json().catch(() => ({}))) as HeroTerrainApiResponse
          if (
            terrainResponse.ok &&
            terrainPayload?.success &&
            !terrainPayload?.degraded &&
            Array.isArray(terrainPayload?.data?.demGrid) &&
            Number(terrainPayload?.data?.width) > 1 &&
            Number(terrainPayload?.data?.height) > 1
          ) {
            const expected = Number(terrainPayload.data?.width) * Number(terrainPayload.data?.height)
            const values = new Float32Array(expected)
            for (let i = 0; i < expected; i++) {
              const value = Number(terrainPayload.data?.demGrid?.[i])
              values[i] = Number.isFinite(value) ? value : 0
            }
            heroHeightGrid = {
              values,
              width: Number(terrainPayload.data?.width),
              height: Number(terrainPayload.data?.height),
              source: String(terrainPayload.data?.source || 'terrain'),
            }
          }
        } catch {
          heroHeightGrid = null
        }

        if (!active) return
        setHeightGrid(heroHeightGrid)
        setHeightGridReady(true)
        setData(payload.data)
      } catch (err: any) {
        if (!active) return
        setError(String(err?.message || 'hero_map_unavailable'))
        setHeightGridReady(true)
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current || !data || !heightGridReady) return
    if (sceneBootstrappedRef.current) return
    if (cinematicActive && portalHost && !cinematicRef.current) return
    sceneBootstrappedRef.current = true

    const container = containerRef.current
    const overlay = overlayRef.current
    const cinematicShell = cinematicRef.current

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xdfe4e8)

    const widthPx = container.clientWidth || 900
    const heightPx = container.clientHeight || 520
    const camera = new THREE.PerspectiveCamera(37, widthPx / heightPx, 0.1, 2200)
    camera.position.set(-24, 88, 150)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0

    const applyRenderSize = (width: number, height: number) => {
      const safeW = Math.max(1, Math.floor(width))
      const safeH = Math.max(1, Math.floor(height))
      renderer.setSize(safeW, safeH, false)
      camera.aspect = safeW / safeH
      camera.updateProjectionMatrix()
    }

    if (cinematicShell && cinematicActive) {
      cinematicShell.innerHTML = ''
      const introWidth = Math.min(window.innerWidth * 0.74, 980)
      const introHeight = Math.min(window.innerHeight * 0.62, 620)
      cinematicShell.style.left = `${Math.round((window.innerWidth - introWidth) / 2)}px`
      cinematicShell.style.top = `${Math.round((window.innerHeight - introHeight) / 2)}px`
      cinematicShell.style.width = `${Math.round(introWidth)}px`
      cinematicShell.style.height = `${Math.round(introHeight)}px`
      cinematicShell.style.borderRadius = '28px'
      cinematicShell.style.opacity = '1'
      cinematicShell.style.boxShadow = '0 28px 90px rgba(0,0,0,0.12)'
      cinematicShell.appendChild(renderer.domElement)
      applyRenderSize(introWidth, introHeight)
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

    const sourceValues = heightGrid
      ? smoothGrid(heightGrid.values, heightGrid.width, heightGrid.height, 1)
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
    const terraceSteps = heightGrid ? 84 : 68
    for (let i = 0; i < resampledHeight.length; i++) {
      const base = clamp((resampledHeight[i] - rawRange.min) / rawDelta, 0, 1)
      const shaped = Math.pow(base, 1.08)
      const terraced = Math.round(shaped * terraceSteps) / terraceSteps
      normalizedHeight[i] = mix(shaped, terraced, 0.74)
    }

    const planeWidth = 162
    const planeHeight = planeWidth * aspect
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, sampleWidth - 1, sampleHeight - 1)
    const positions = geometry.attributes.position as THREE.BufferAttribute
    const elevationScale = heightGrid ? 62 : 40
    for (let i = 0; i < normalizedHeight.length; i++) {
      positions.setZ(i, normalizedHeight[i] * elevationScale)
    }
    positions.needsUpdate = true
    geometry.computeVertexNormals()

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enabled = false
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI / 2.06
    controls.minDistance = 56
    controls.maxDistance = 260
    controls.target.set(0, 18, 0)

    let outlineTexture: THREE.Texture | null = null
    let topoTexture: THREE.Texture | null = null
    let active = true
    let animationId = 0
    const disposables: Array<() => void> = []
    let lineMaterial: THREE.LineBasicMaterial | null = null
    let edgeMaterial: THREE.ShaderMaterial | null = null
    let contourMaterial: THREE.ShaderMaterial | null = null
    let baseMaterial: THREE.MeshStandardMaterial | null = null
    const terrainGroup = new THREE.Group()
    terrainGroup.rotation.x = -0.06
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
          color: new THREE.Color(0xf2f5f7),
          metalness: 0.02,
          roughness: 0.84,
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
            uDensity: { value: 58 },
            uThickness: { value: 0.048 },
            uOpacity: { value: 0.72 },
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
            void main() {
              float f = fract(vHeight * uDensity);
              float d = min(f, 1.0 - f);
              float aa = fwidth(vHeight * uDensity) * 0.9;
              float line = 1.0 - smoothstep(uThickness, uThickness + aa, d);
              gl_FragColor = vec4(vec3(0.16, 0.18, 0.21), line * uOpacity);
            }
          `,
          transparent: true,
          depthWrite: false,
        })

        const contourMesh = new THREE.Mesh(geometry, contourMaterial)
        contourMesh.rotation.x = -Math.PI / 2
        contourMesh.position.y = 0.22
        terrainGroup.add(contourMesh)

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

        const holdMs = 460
        const revealMs = 1800
        const dockMs = 1500
        const start = performance.now()

        const setPhase = (phase: 'initializing' | 'revealing' | 'docking' | 'interactive') => {
          if (phaseRef.current === phase) return
          phaseRef.current = phase
          setPhaseLabel(phase)
        }

        const animate = (now: number) => {
          if (!active) return
          const elapsed = now - start
          let reveal = 0.001
          let dockProgress = 0

          if (elapsed <= holdMs) {
            setPhase('initializing')
          } else if (elapsed <= holdMs + revealMs) {
            setPhase('revealing')
            reveal = clamp((elapsed - holdMs) / revealMs, 0, 1)
          } else if (elapsed <= holdMs + revealMs + dockMs) {
            setPhase('docking')
            reveal = 1
            dockProgress = clamp((elapsed - holdMs - revealMs) / dockMs, 0, 1)
          } else {
            setPhase('interactive')
            reveal = 1
            dockProgress = 1
            controls.enabled = true
          }

          if (edgeMaterial) edgeMaterial.uniforms.uReveal.value = reveal

          const easeDock = 1 - Math.pow(1 - dockProgress, 3)
          camera.position.set(
            mix(-24, 8, easeDock),
            mix(88, 116, easeDock),
            mix(150, 206, easeDock)
          )
          controls.target.set(0, mix(18, 8, easeDock), 0)
          terrainGroup.scale.setScalar(mix(2.3, 1, easeDock))
          terrainGroup.position.y = mix(2.6, -1.2, easeDock)
          terrainGroup.rotation.y = now * 0.00007 + mix(0.22, 0, easeDock)

          if (cinematicShell && cinematicActive && !dockedToPanel) {
            const targetRect = container.getBoundingClientRect()
            const introWidth = Math.min(window.innerWidth * 0.74, 980)
            const introHeight = Math.min(window.innerHeight * 0.62, 620)
            const introLeft = Math.round((window.innerWidth - introWidth) / 2)
            const introTop = Math.round((window.innerHeight - introHeight) / 2)
            const left = mix(introLeft, targetRect.left, easeDock)
            const top = mix(introTop, targetRect.top, easeDock)
            const width = mix(introWidth, targetRect.width, easeDock)
            const height = mix(introHeight, targetRect.height, easeDock)
            cinematicShell.style.left = `${left}px`
            cinematicShell.style.top = `${top}px`
            cinematicShell.style.width = `${width}px`
            cinematicShell.style.height = `${height}px`
            cinematicShell.style.borderRadius = `${Math.round(mix(0, 22, easeDock))}px`
            cinematicShell.style.boxShadow = `0 ${Math.round(mix(0, 28, easeDock))}px ${Math.round(mix(0, 70, easeDock))}px rgba(0,0,0,${mix(0, 0.24, easeDock).toFixed(3)})`
            applyRenderSize(width, height)
          }

          if (phaseRef.current === 'interactive' && cinematicShell && cinematicActive && !dockedToPanel) {
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
              if (!introCompletedRef.current) {
                introCompletedRef.current = true
                onIntroComplete?.()
              }
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
      if (cinematicShell && cinematicActive && !dockedToPanel) {
        const rect = cinematicShell.getBoundingClientRect()
        applyRenderSize(rect.width, rect.height)
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
      renderer.dispose()
      disposables.forEach((dispose) => dispose())
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement)
      if (cinematicShell && renderer.domElement.parentNode === cinematicShell) cinematicShell.removeChild(renderer.domElement)
      sceneBootstrappedRef.current = false
    }
  }, [data, heightGrid, heightGridReady, portalHost, cinematicActive, onIntroComplete])

  if (loading) {
    return (
      <div className="flex h-[26rem] items-center justify-center rounded-2xl border border-border bg-card/70">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading NDVI terrain sequence
        </div>
      </div>
    )
  }

  if (error || !data) {
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
          ref={cinematicRef}
          className="pointer-events-none fixed inset-0 z-[80] overflow-hidden bg-[#dfe4e8]"
        />,
        portalHost
      )}
      <div
        ref={containerRef}
        className={`h-[28rem] w-full overflow-hidden rounded-2xl border border-cyan-700/30 bg-[#dfe4e8] transition-opacity duration-500 ${
          cinematicActive ? 'opacity-20' : 'opacity-100'
        }`}
      />
      {!cinematicActive && (
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
    </div>
  )
}
