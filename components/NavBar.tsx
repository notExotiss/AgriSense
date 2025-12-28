"use client"

import React from "react"
import Link from "next/link"
import ThemeToggle from "./ThemeToggle"
import { Satellite, Menu, Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../components/ui/sheet"

export default function NavBar() {
  const [showAlerts, setShowAlerts] = React.useState(false)
  const [alerts, setAlerts] = React.useState<any[]>([])

  React.useEffect(()=>{
    const handler = (e:any)=> setAlerts(Array.isArray(e.detail) ? e.detail : [])
    window.addEventListener('agrisense:alerts', handler as any)
    return ()=> window.removeEventListener('agrisense:alerts', handler as any)
  },[])

  const criticalCount = alerts.filter(a=>a.type==='critical').length
  const groups = React.useMemo(()=>{
    const m: Record<string, any[]> = {}
    for (const a of alerts){
      const key = a.plotName || a.plotId || 'Current AOI'
      if (!m[key]) m[key] = []
      m[key].push(a)
    }
    return m
  }, [JSON.stringify(alerts)])
  const [openKeys, setOpenKeys] = React.useState<Record<string, boolean>>({})

  return (
    <nav className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <Satellite className="h-6 w-6 text-blue-600" />
            <Link href="/" className="font-bold text-xl">
              AgriSense
            </Link>
          </div>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-6">
            <Link href="/dashboard" className="text-sm font-medium hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
              Dashboard
            </Link>
            <Link href="/plots" className="text-sm font-medium hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
              Plots
            </Link>
            <Link href="/account" className="text-sm font-medium hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
              Account
            </Link>
            <button className="relative" onClick={()=> setShowAlerts(v=>!v)} aria-label="Alerts">
              <Bell className="h-5 w-5" />
              {alerts.length>0 && (
                <span className="absolute -top-1 -right-1 text-[10px] bg-red-600 text-white rounded-full px-1">
                  {criticalCount || alerts.length}
                </span>
              )}
            </button>
            <ThemeToggle />
          </div>

          {/* Mobile Menu */}
          <Sheet>
            <SheetTrigger asChild className="md:hidden">
              <Button variant="ghost" size="sm">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Navigation</SheetTitle>
                <SheetDescription>Access all AgriSense features</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-4 mt-6">
                <Link href="/dashboard" className="text-sm font-medium">
                  Dashboard
                </Link>
                <Link href="/plots" className="text-sm font-medium">
                  Plots
                </Link>
                <Link href="/account" className="text-sm font-medium">
                  Account
                </Link>
                <ThemeToggle />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
      {/* Alerts Popup */}
      {showAlerts && (
        <div className="fixed right-4 top-16 z-50 w-80 rounded-lg border bg-background shadow">
          <div className="p-3 border-b font-medium">Alerts</div>
          <div className="max-h-80 overflow-auto p-2 space-y-2 text-sm">
            {Object.keys(groups).length===0 ? (
              <div className="text-muted-foreground p-2">No alerts</div>
            ) : (
              Object.entries(groups).map(([key, arr])=> (
                <div key={key} className="rounded border">
                  <button className="w-full text-left p-2 font-medium flex items-center justify-between" onClick={()=> setOpenKeys(s=> ({ ...s, [key]: !s[key] }))}>
                    <span className="break-words">{key}</span>
                    <span className="text-xs opacity-70">{arr.length}</span>
                  </button>
                  {openKeys[key] && (
                    <div className="p-2 space-y-2">
                      {arr.map((a:any)=> (
                        <div key={a.id} className={`p-2 rounded border overflow-hidden break-words ${a.type==='critical' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'}`}>
                          <div className="font-medium break-words">{a.message}</div>
                          <div className="opacity-80 break-words">{a.details}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
