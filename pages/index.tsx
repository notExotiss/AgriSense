import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import { motion, useScroll, useTransform } from 'framer-motion'
import { ArrowRight, Clock3, Workflow, ScanSearch, Layers3, Sparkles } from 'lucide-react'
import NavBar from '../components/NavBar'
import { Button } from '../components/ui/button'

const HeroTerrainSequence = dynamic(() => import('../components/home/HeroTerrainSequence'), {
  ssr: false,
})

function resolveNextPath(nextParam: unknown) {
  if (typeof nextParam !== 'string') return '/dashboard'
  if (!nextParam.startsWith('/')) return '/dashboard'
  if (nextParam.startsWith('//')) return '/dashboard'
  if (nextParam.startsWith('/api/')) return '/dashboard'
  return nextParam
}

const revealProps = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.22 as const },
}

const INTRO_SESSION_KEY = 'agrisense_home_intro_seen_v2'
const INTRO_RUNNING_KEY = 'agrisense_home_intro_running_v2'

type TickerLine = { id: string; text: string }

const tickerSeed: TickerLine[] = [
  { id: 'seed-1', text: '06:02 | New AOI imagery processed with low cloud cover' },
  { id: 'seed-2', text: '06:05 | Plot P5 added to today\'s watchlist' },
  { id: 'seed-3', text: '06:08 | Assistant suggested a targeted irrigation check' },
  { id: 'seed-4', text: '06:12 | Next automatic review set for 06:00 tomorrow' },
]

export default function Home() {
  const router = useRouter()
  const nextPath = useMemo(() => resolveNextPath(router.query.next), [router.query.next])
  const enterHref = useMemo(() => `/api/session/enter?next=${encodeURIComponent(nextPath)}`, [nextPath])

  const { scrollY } = useScroll()
  const heroTextY = useTransform(scrollY, [0, 720], [0, -130])
  const heroVisualY = useTransform(scrollY, [0, 720], [0, -160])
  const orbAY = useTransform(scrollY, [0, 1800], [0, -210])
  const orbBY = useTransform(scrollY, [0, 1800], [0, -150])
  const editorialY = useTransform(scrollY, [180, 1600], [0, -74])
  const railY = useTransform(scrollY, [220, 1800], [0, -96])

  const [clock, setClock] = useState('--:--:-- UTC')
  const [ticker, setTicker] = useState<TickerLine[]>(tickerSeed)
  const [introMode, setIntroMode] = useState<'checking' | 'run' | 'skip'>('checking')
  const [introDone, setIntroDone] = useState(false)
  const tickerCounterRef = useRef(0)
  const introCompletedRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const seen = window.sessionStorage.getItem(INTRO_SESSION_KEY) === '1'
    const running = window.sessionStorage.getItem(INTRO_RUNNING_KEY) === '1'
    if (seen) {
      window.sessionStorage.removeItem(INTRO_RUNNING_KEY)
      introCompletedRef.current = true
      setIntroMode('skip')
      setIntroDone(true)
      return
    }
    introCompletedRef.current = false
    if (!running) {
      window.sessionStorage.setItem(INTRO_RUNNING_KEY, '1')
    }
    setIntroMode('run')
    setIntroDone(false)
  }, [])

  useEffect(() => {
    const updateClock = () => {
      const now = new Date()
      const value = now.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
      setClock(`${value} UTC`)
    }

    updateClock()
    const clockTimer = window.setInterval(updateClock, 1000)

    const logMessages = [
      '06:14 | Scenario complete: water use -9%, risk unchanged',
      '06:16 | Map, grid, and terrain selection synced for this AOI',
      '06:19 | Provider diagnostics returned healthy on the primary path',
      '06:22 | Plots P2 and P8 moved to the scouting queue',
      '06:25 | Forecast confidence refreshed after weather update',
      '06:27 | Alert thresholds applied to this AOI profile',
    ]

    const tickerTimer = window.setInterval(() => {
      const next = logMessages[Math.floor(Math.random() * logMessages.length)]
      tickerCounterRef.current += 1
      setTicker((prev) => [{ id: `tick-${tickerCounterRef.current}`, text: next }, ...prev].slice(0, 6))
    }, 2900)

    return () => {
      window.clearInterval(clockTimer)
      window.clearInterval(tickerTimer)
    }
  }, [])

  const handleIntroComplete = useCallback(() => {
    if (introCompletedRef.current) return
    introCompletedRef.current = true
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(INTRO_SESSION_KEY, '1')
      window.sessionStorage.removeItem(INTRO_RUNNING_KEY)
    }
    setIntroMode('skip')
    setIntroDone(true)
  }, [])

  const introReady = introMode !== 'checking'
  const showShell = introReady && introDone

  if (!introReady) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background">
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="home-orb home-orb-a" />
          <div className="home-orb home-orb-b" />
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <motion.div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
        <motion.div className="home-orb home-orb-a" style={{ y: orbAY }} />
        <motion.div className="home-orb home-orb-b" style={{ y: orbBY }} />
      </motion.div>

      <div className={`transition-opacity duration-500 ${showShell ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <NavBar />
      </div>

      <main
        className={`app-shell relative pb-20 pt-10 transition-opacity duration-500 ${
          showShell ? 'opacity-100' : 'opacity-0 pointer-events-none select-none'
        }`}
      >
        <section className="relative grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <motion.article className="ops-panel rounded-[2.15rem] p-8 md:p-10" style={{ y: heroTextY }}>
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/80 px-3 py-1 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
              <Workflow className="h-3.5 w-3.5" />
              Satellite + Field Operations
            </p>
            <h1 className="mt-4 text-4xl font-bold leading-tight text-foreground md:text-5xl">
              Satellite intelligence for healthier crops and smarter irrigation.
            </h1>
            <p className="mt-4 max-w-xl text-base text-muted-foreground">
              AgriSense combines NDVI, soil moisture, evapotranspiration, and weather into one clear field view, so you can
              spot stress early and act by zone instead of guessing.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href={enterHref}>
                <Button size="lg" className="gap-2">
                  Enter Workspace
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/plots">
                <Button size="lg" variant="outline">
                  View Saved Plots
                </Button>
              </Link>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <div className="metric-tile">
                <p className="metric-label">Current focus</p>
                <p className="metric-value">Early stress detection</p>
              </div>
              <div className="metric-tile">
                <p className="metric-label">Review cycle</p>
                <p className="metric-value">Daily satellite refresh</p>
              </div>
              <div className="metric-tile">
                <p className="metric-label">Ops clock</p>
                <p className="metric-value">{clock}</p>
              </div>
            </div>
          </motion.article>

          <motion.article style={{ y: heroVisualY }} className="hero-monitor rounded-[2.15rem] p-4 md:p-5">
            <HeroTerrainSequence introMode={introMode === 'run' ? 'run' : 'skip'} onIntroComplete={handleIntroComplete} />
          </motion.article>
        </section>

        <motion.section
          {...revealProps}
          transition={{ duration: 0.42, ease: 'easeOut' }}
          className="mt-5 rounded-[1.6rem] border border-border/90 bg-card/85 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">Live Field Timeline</p>
            <span className="telemetry-chip">
              <Clock3 className="h-3.5 w-3.5 text-primary" />
              Live updates
            </span>
          </div>
          <motion.div style={{ y: railY }} className="mt-3 grid gap-2 md:grid-cols-2">
            {ticker.map((line) => (
              <div key={line.id} className="command-log-item">
                {line.text}
              </div>
            ))}
          </motion.div>
        </motion.section>

        <motion.section
          {...revealProps}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          style={{ y: editorialY }}
          className="mt-8 grid gap-4 lg:grid-cols-12"
        >
          <motion.article whileHover={{ y: -5 }} className="ops-panel rounded-[2rem] p-6 lg:col-span-5">
            <p className="metric-label">Define AOI</p>
            <h2 className="mt-2 text-xl font-semibold text-foreground">Draw the field once, monitor it continuously</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The same boundary powers satellite fetches, terrain modeling, plot-point tracking, and saved history, so every
              decision is based on the exact same footprint.
            </p>
            <div className="mt-4 inline-flex rounded-full border border-border bg-background/75 px-3 py-1.5 text-xs text-muted-foreground">
              Consistent boundary, reliable comparisons.
            </div>
          </motion.article>

          <motion.article whileHover={{ y: -5 }} className="ops-panel rounded-[2rem] p-6 lg:col-span-7 lg:-translate-y-4">
            <p className="metric-label">Analyze and Simulate</p>
            <h2 className="mt-2 text-xl font-semibold text-foreground">Understand why stress is happening</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              NDVI from satellite reflectance is layered with soil moisture, ET, weather, and terrain to separate heat stress,
              irrigation gaps, and broader field trends.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="metric-tile">
                <p className="metric-label">Layer stack</p>
                <p className="metric-value">NDVI, soil, ET</p>
              </div>
              <div className="metric-tile">
                <p className="metric-label">Selection model</p>
                <p className="metric-value">3x3 plots + zones</p>
              </div>
              <div className="metric-tile">
                <p className="metric-label">What-if</p>
                <p className="metric-value">Water, risk, yield</p>
              </div>
            </div>
          </motion.article>

          <motion.article whileHover={{ y: -5 }} className="ops-panel rounded-[2rem] p-7 lg:col-span-12">
            <div className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
              <div>
                <p className="metric-label">About AgriSense</p>
                <h2 className="mt-2 text-2xl font-semibold text-foreground">Built from real farm challenges</h2>
                <p className="mt-3 text-sm text-muted-foreground">
                  AgriSense was built to turn complex remote-sensing data into practical actions farmers can trust. Instead of
                  raw charts and disconnected tools, it gives one workflow from field health detection to zone-level
                  intervention planning.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
                <div className="metric-tile">
                  <p className="metric-label">Core mode</p>
                  <p className="metric-value">AI agronomy assistant</p>
                </div>
                <div className="metric-tile">
                  <p className="metric-label">Spatial model</p>
                  <p className="metric-value">Satellite + 3D terrain</p>
                </div>
                <div className="metric-tile">
                  <p className="metric-label">Output</p>
                  <p className="metric-value">Zone action plan</p>
                </div>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="command-log-item">
                <p className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
                  <ScanSearch className="h-3.5 w-3.5 text-primary" />
                  Detect
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Detect early crop stress from NDVI changes.</p>
              </div>
              <div className="command-log-item">
                <p className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
                  <Layers3 className="h-3.5 w-3.5 text-primary" />
                  Contextualize
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Cross-check with soil, ET, terrain, and weather.</p>
              </div>
              <div className="command-log-item">
                <p className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Execute
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Run targeted zone actions and track outcomes.</p>
              </div>
            </div>
          </motion.article>
        </motion.section>
      </main>
    </div>
  )
}
