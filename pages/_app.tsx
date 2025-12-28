import '../styles/globals.css'
import type { AppProps } from 'next/app'
import { ThemeProvider } from 'next-themes'
import dynamic from 'next/dynamic'
import Head from 'next/head'

const Toaster = dynamic(() => import('sonner').then(m => m.Toaster), { ssr: false })

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
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
            `,
          }}
        />
      </Head>
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