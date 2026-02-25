import '../styles/globals.css'
import type { AppProps } from 'next/app'
import { ThemeProvider } from 'next-themes'
import dynamic from 'next/dynamic'
import Script from 'next/script'
import { useEffect } from 'react'

const Toaster = dynamic(() => import('sonner').then(m => m.Toaster), { ssr: false })

export default function MyApp({ Component, pageProps }: AppProps) {
  useEffect(() => {
    const originalError = console.error
    console.error = (...args: any[]) => {
      const text = args.map((item) => String(item || '')).join(' ').toLowerCase()
      const blockedNoise =
        text.includes('err_blocked_by_client') &&
        (text.includes('amplitude') || text.includes('api2.amplitude.com') || text.includes('telemetry'))
      if (blockedNoise) return
      originalError(...args)
    }

    const rejectionHandler = (event: PromiseRejectionEvent) => {
      const message = String(event?.reason || '').toLowerCase()
      if (message.includes('err_blocked_by_client') && message.includes('amplitude')) {
        event.preventDefault()
      }
    }

    window.addEventListener('unhandledrejection', rejectionHandler)

    // Best effort disable for environments bundling mapbox telemetry.
    import('mapbox-gl')
      .then((module) => {
        try {
          const mapbox: any = module?.default || module
          if (typeof mapbox?.setTelemetryEnabled === 'function') {
            mapbox.setTelemetryEnabled(false)
          }
        } catch {
          // ignore
        }
      })
      .catch(() => {
        // mapbox may not be loaded on every page
      })

    return () => {
      console.error = originalError
      window.removeEventListener('unhandledrejection', rejectionHandler)
    }
  }, [])

  return (
    <>
      <Script id="theme-init" strategy="beforeInteractive">
        {`
          (function() {
            try {
              const theme = localStorage.getItem('theme') || 'system';
              const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
              if (isDark) {
                document.documentElement.classList.add('dark');
              } else {
                document.documentElement.classList.remove('dark');
              }
            } catch (e) {}
          })();
        `}
      </Script>
      <ThemeProvider 
        attribute="class" 
        defaultTheme="system" 
        enableSystem
        disableTransitionOnChange={false}
        storageKey="theme"
      >
        <Toaster richColors position="top-center" />
        <Component {...pageProps} />
      </ThemeProvider>
    </>
  )
} 
