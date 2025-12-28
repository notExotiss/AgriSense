import { useState } from 'react'

export default function RecipeSuggestions({ foodName }: { foodName: string }){
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState<string | null>(null)

  async function fetchIdeas(){
    setLoading(true)
    try{
      const r = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: `Give quick, low-waste recipes using ${foodName}.` })
      })
      
      // Handle rate limit errors
      if (r.status === 429) {
        const errorData = await r.json().catch(() => ({}))
        setText(errorData.message || 'Rate limit exceeded. Please wait a moment and try again.')
        return
      }
      
      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}))
        setText(errorData.message || `Error: ${r.statusText}`)
        return
      }
      
      const j = await r.json()
      setText(j.output || 'No result')
    } catch (e: any) {
      setText(e?.message?.includes('rate limit') 
        ? 'Rate limit exceeded. Please wait a moment and try again.' 
        : 'An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border rounded p-4 bg-white">
      <button disabled={loading} onClick={fetchIdeas} className="px-3 py-2 bg-emerald-600 text-white rounded disabled:opacity-60">
        {loading ? 'Thinking…' : 'Get recipe suggestions'}
      </button>
      {text && (
        <pre className="whitespace-pre-wrap text-sm mt-3">{text}</pre>
      )}
    </div>
  )
} 