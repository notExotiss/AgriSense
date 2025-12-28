import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { Button } from './ui/button'

export default function ThemeToggle(){
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={()=> setTheme(isDark ? 'light':'dark')}>
      {isDark ? <Sun className="h-4 w-4"/> : <Moon className="h-4 w-4"/>}
    </Button>
  )
} 