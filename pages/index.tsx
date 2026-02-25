import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useMemo, useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { motion, useScroll, useTransform } from 'framer-motion'
import { ArrowRight, Clock3, ShieldCheck, Waves, Workflow } from 'lucide-react'
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
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.28 as const },
}
const INTRO_SESSION_KEY = 'agrisense_home_intro_seen_v1'

type TickerLine = { id: string; text: string }

const tickerSeed: TickerLine[] = [
  { id: 'seed-1', text: '06:02 | AOI scene refreshed with low-cloud acquisition' },
  { id: 'seed-2', text: '06:05 | P5 stress watch opened for today' },
  { id: 'seed-3', text: '06:08 | AI Assistant drafted targeted irrigation checklist' },
  { id: 'seed-4', text: '06:12 | Daily re-check scheduled for 06:00 tomorrow' },
]

export default function Home() {
  const router = useRouter()
  const nextPath = useMemo(() => resolveNextPath(router.query.next), [router.query.next])
  const enterHref = useMemo(() => `/api/session/enter?next=${encodeURIComponent(nextPath)}`, [nextPath])

  const { scrollY } = useScroll()
  const heroTextY = useTransform(scrollY, [0, 700], [0, -120])
  const heroVisualY = useTransform(scrollY, [0, 700], [0, -180])
  const orbAY = useTransform(scrollY, [0, 1800], [0, -190])
  const orbBY = useTransform(scrollY, [0, 1800], [0, -120])
  const sectionDrift = useTransform(scrollY, [0, 1400], [0, -46])

  const [clock, setClock] = useState('--:--:-- UTC')
  const [ticker, setTicker] = useState<TickerLine[]>(tickerSeed)
  const [introMode, setIntroMode] = useState<'checking' | 'run' | 'skip'>('checking')
  const [introDone, setIntroDone] = useState(false)
  const tickerCounterRef = useRef(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const seen = window.sessionStorage.getItem(INTRO_SESSION_KEY) === '1'
    if (seen) {
      setIntroMode('skip')
      setIntroDone(true)
    } else {
      setIntroMode('run')
      setIntroDone(false)
    }
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
      '06:14 | Scenario run complete: water -9%, risk stable',
      '06:16 | Map/grid/terrain selection synced for active AOI',
      '06:19 | Provider diagnostics healthy on primary path',
      '06:22 | P2 and P8 moved to scouting queue',
      '06:25 | Forecast confidence updated after weather refresh',
      '06:27 | Alert thresholds applied to this AOI profile',
    ]

    const tickerTimer = window.setInterval(() => {
      const next = logMessages[Math.floor(Math.random() * logMessages.length)]
      tickerCounterRef.current += 1
      setTicker((prev) => [{ id: `tick-${tickerCounterRef.current}`, text: next }, ...prev].slice(0, 5))
    }, 3000)

    return () => {
      window.clearInterval(clockTimer)
      window.clearInterval(tickerTimer)
    }
  }, [])

  const handleIntroComplete = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(INTRO_SESSION_KEY, '1')
    }
    setIntroMode('skip')
    setIntroDone(true)
  }

  return (
    <div className="min-h-screen overflow-x-hidden">
      <motion.div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10"
      >
        <motion.div className="home-orb home-orb-a" style={{ y: orbAY }} />
        <motion.div className="home-orb home-orb-b" style={{ y: orbBY }} />
      </motion.div>

      <div className={`transition-opacity duration-500 ${introDone ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <NavBar />
      </div>

      <main
        className={`app-shell pb-16 pt-10 transition-opacity duration-500 ${introDone ? 'opacity-100' : 'opacity-0 pointer-events-none select-none'}`}
      >
        <section className="relative grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <motion.article className="ops-panel p-8 md:p-10" style={{ y: heroTextY }}>
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              <Workflow className="h-3.5 w-3.5" />
              AgriSense Workspace
            </p>
            <h1 className="mt-4 text-4xl font-bold leading-tight text-foreground md:text-5xl">
              From field image to next action in one flow.
            </h1>
            <p className="mt-4 max-w-xl text-base text-muted-foreground">
              Analyze canopy health, inspect plot points, run what-if checks, and hand teams a clear action plan without bouncing between tools.
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
                <p className="metric-label">Current objective</p>
                <p className="metric-value">Yield + water balance</p>
              </div>
              <div className="metric-tile">
                <p className="metric-label">Update cadence</p>
                <p className="metric-value">Daily check</p>
              </div>
              <div className="metric-tile">
                <p className="metric-label">Ops clock</p>
                <p className="metric-value">{clock}</p>
              </div>
            </div>
          </motion.article>

          <motion.article style={{ y: heroVisualY }} className="hero-monitor p-4 md:p-5">
            <motion.div
              animate={{ y: [0, -7, 0] }}
              transition={{ duration: 6.2, ease: 'easeInOut', repeat: Infinity }}
            >
              <HeroTerrainSequence
                introMode={introMode === 'run' ? 'run' : 'skip'}
                onIntroComplete={handleIntroComplete}
              />
            </motion.div>
          </motion.article>
        </section>

        <motion.section
          {...revealProps}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="mt-5 ops-panel p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">Operations Timeline</p>
            <span className="telemetry-chip">
              <Clock3 className="h-3.5 w-3.5 text-primary" />
              Live updates
            </span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {ticker.map((line, index) => (
              <div key={`${line.id}-${index}`} className="command-log-item">
                {line.text}
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section
          {...revealProps}
          transition={{ duration: 0.42, ease: 'easeOut' }}
          style={{ y: sectionDrift }}
          className="mt-8 grid gap-4 lg:grid-cols-12"
        >
          <motion.article whileHover={{ y: -4 }} className="ops-panel rounded-[2rem] p-6 lg:col-span-7">
            <p className="metric-label">Define AOI</p>
            <h2 className="mt-2 text-xl font-semibold text-foreground">Pin the field area</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Search location, draw exact boundaries, and lock the 3x3 plot-point grid for execution planning.
            </p>
            <div className="mt-4 inline-flex rounded-full border border-border bg-background/75 px-3 py-1.5 text-xs text-muted-foreground">
              AOI-to-grid sync runs live while you draw.
            </div>
          </motion.article>
          <motion.article whileHover={{ y: -4 }} className="ops-panel rounded-[2rem] p-6 lg:col-span-5 lg:-translate-y-5">
            <p className="metric-label">Analyze and Simulate</p>
            <h2 className="mt-2 text-xl font-semibold text-foreground">See what changes next</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Combine NDVI, soil, ET, weather, and scenario testing before applying interventions in the field.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="metric-tile">
                <p className="metric-label">Scenario mode</p>
                <p className="metric-value">what-if ready</p>
              </div>
              <div className="metric-tile">
                <p className="metric-label">Risk view</p>
                <p className="metric-value">7d + 30d</p>
              </div>
            </div>
          </motion.article>
          <motion.article whileHover={{ y: -4 }} className="ops-panel rounded-[2rem] p-6 lg:col-span-4">
            <p className="metric-label">Execute and Track</p>
            <h2 className="mt-2 text-xl font-semibold text-foreground">Close the loop</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Save plots, assign follow-up checks, and keep recommendations tied to measurable outcomes.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="telemetry-chip">Plot history persisted</span>
              <span className="telemetry-chip">Action queue ready</span>
            </div>
          </motion.article>
          <motion.article
            whileHover={{ y: -4 }}
            className="ops-panel rounded-[2rem] p-6 lg:col-span-8 lg:-translate-y-4"
          >
            <p className="metric-label">Operations storyboard</p>
            <h2 className="mt-2 text-xl font-semibold text-foreground">From signal to field action in one pass</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="metric-tile">
                <p className="metric-label">06:00</p>
                <p className="metric-value">Scene update</p>
                <p className="mt-1 text-xs text-muted-foreground">Latest NDVI and provider diagnostics loaded.</p>
              </div>
              <div className="metric-tile">
                <p className="metric-label">06:03</p>
                <p className="metric-value">AI briefing</p>
                <p className="mt-1 text-xs text-muted-foreground">Question-first response with rationale + actions.</p>
              </div>
              <div className="metric-tile">
                <p className="metric-label">06:10</p>
                <p className="metric-value">Execution queue</p>
                <p className="mt-1 text-xs text-muted-foreground">Targeted cells pushed for scouting and irrigation.</p>
              </div>
            </div>
          </motion.article>
        </motion.section>

        <motion.section
          {...revealProps}
          transition={{ duration: 0.44, ease: 'easeOut' }}
          className="mt-8 rounded-[2rem] border border-border bg-card/85 p-6 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="metric-label">Start working</p>
              <h2 className="mt-1 text-2xl font-semibold text-foreground">Enter workspace and run today’s pass</h2>
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <Waves className="h-4 w-4 text-primary" />
              <Clock3 className="h-4 w-4 text-primary" />
            </div>
          </div>
          <div className="mt-5">
            <Link href={enterHref}>
              <Button className="gap-2">
                Enter Workspace
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </motion.section>
      </main>
    </div>
  )
}
