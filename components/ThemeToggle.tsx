import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { Button } from './ui/button'
import { useEffect, useState } from 'react'

export default function ThemeToggle(){
  const [mounted, setMounted] = useState(false)
  const { theme, setTheme } = useTheme()
  useEffect(()=>{ setMounted(true) }, [])
  if (!mounted) {
    return <Button variant="ghost" size="icon" aria-label="Toggle theme"><Sun className="h-4 w-4"/></Button>
  }
  const isDark = theme === 'dark'
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={()=> setTheme(isDark ? 'light':'dark')}>
      {isDark ? <Sun className="h-4 w-4"/> : <Moon className="h-4 w-4"/>}
    </Button>
  )
} 
