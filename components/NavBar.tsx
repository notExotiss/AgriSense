'use client'

import React from 'react'
import Link from 'next/link'
import { Bell, Menu, Satellite, X } from 'lucide-react'
import { Button } from './ui/button'
import ThemeToggle from './ThemeToggle'

type AlertItem = {
  id?: string
  type?: 'critical' | 'warning'
  message?: string
  details?: string
  plotName?: string
}

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/plots', label: 'Plots' },
  { href: '/account', label: 'Account' },
]

const gatedRoutePattern = /^\/(dashboard|plots|account|ingest)(\/|$)/

function resolveNavHref(href: string) {
  if (!gatedRoutePattern.test(href)) return href
  return `/api/session/enter?next=${encodeURIComponent(href)}`
}

export default function NavBar() {
  const [alerts, setAlerts] = React.useState<AlertItem[]>([])
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [alertsOpen, setAlertsOpen] = React.useState(false)

  React.useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<AlertItem[]>
      setAlerts(Array.isArray(customEvent.detail) ? customEvent.detail : [])
    }
    window.addEventListener('agrisense:alerts', handler)
    return () => window.removeEventListener('agrisense:alerts', handler)
  }, [])

  const criticalCount = alerts.filter((alert) => alert.type === 'critical').length

  return (
    <>
      <header className="liquid-glass sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Satellite className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold leading-none text-foreground">AgriSense</span>
              <span className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Field Ops</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-5 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={resolveNavHref(link.href)}
                className="text-sm font-medium text-muted-foreground transition hover:text-primary"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setAlertsOpen((value) => !value)}
              className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              aria-label="Open alerts"
            >
              <Bell className="h-4 w-4" />
              {alerts.length > 0 && (
                <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {criticalCount || alerts.length}
                </span>
              )}
            </button>
            <ThemeToggle />

            <Button
              variant="outline"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen((value) => !value)}
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {mobileOpen && (
          <nav className="border-t border-border bg-background px-4 py-3 md:hidden">
            <div className="space-y-2">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={resolveNavHref(link.href)}
                  onClick={() => setMobileOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-primary"
                >
                  {link.label}
                </Link>
              ))}
              <div className="pt-2">
                <ThemeToggle />
              </div>
            </div>
          </nav>
        )}
      </header>

      {alertsOpen && (
        <aside className="liquid-glass fixed right-4 top-20 z-50 w-[min(95vw,26rem)] rounded-2xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Alert Center</p>
              <p className="text-xs text-muted-foreground">Active agronomy and system alerts</p>
            </div>
            <button onClick={() => setAlertsOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-80 space-y-2 overflow-auto p-3">
            {!alerts.length && <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">No active alerts.</p>}
            {alerts.map((alert, index) => (
              <article
                key={`${alert.id || index}`}
                className={
                  alert.type === 'critical'
                    ? 'alert-card alert-card-critical'
                    : 'alert-card alert-card-warning'
                }
              >
                <p className="alert-title">{alert.message || 'Alert'}</p>
                <p className="alert-copy">{alert.details || 'No additional details provided.'}</p>
                {alert.plotName && <p className="alert-meta">{alert.plotName}</p>}
              </article>
            ))}
          </div>
        </aside>
      )}
    </>
  )
}
