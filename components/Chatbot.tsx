"use client"

import React, { useEffect, useRef, useState } from 'react'
import { Send, MessageCircle } from 'lucide-react'

export default function Chatbot({ context }:{ context: any }){
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState<{ role:'user'|'ai', text:string }[]>([])
  const boxRef = useRef<HTMLDivElement|null>(null)

  useEffect(()=>{ boxRef.current?.scrollTo({ top: 999999, behavior: 'smooth' }) }, [msgs])

  async function ask(){
    if (!input.trim()) return
    const userMsg = input.trim()
    setMsgs(m=> [...m, { role:'user', text: userMsg }])
    setInput('')
    try{
      const prompt = `You are an agronomy assistant. Use the provided context (NDVI, soil moisture, ET, weather, AOI) to answer clearly and practically. If numeric values exist, reference them succinctly.\n\nContext:\n${JSON.stringify(context).slice(0,6000)}\n\nQuestion: ${userMsg}`
      const r = await fetch('/api/gemini', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ prompt, ndviData: context?.ndvi, soilData: context?.soil, etData: context?.et, weatherData: context?.weather }) })
      
      // Handle rate limit errors
      if (r.status === 429) {
        const errorData = await r.json().catch(() => ({}))
        setMsgs(m=> [...m, { 
          role:'ai', 
          text: errorData.message || 'Rate limit exceeded. Please wait a moment and try again.' 
        }])
        return
      }
      
      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}))
        setMsgs(m=> [...m, { 
          role:'ai', 
          text: errorData.message || `Error: ${r.statusText}` 
        }])
        return
      }
      
      const j = await r.json().catch(()=>({}))
      const text = j?.suggestion || j?.output || 'No response.'
      setMsgs(m=> [...m, { role:'ai', text }])
    } catch(e:any){ 
      setMsgs(m=> [...m, { 
        role:'ai', 
        text: e?.message?.includes('rate limit') 
          ? 'Rate limit exceeded. Please wait a moment and try again.' 
          : (e?.message || 'An error occurred. Please try again.') 
      }]) 
    }
  }

  return (
    <>
      <button onClick={()=> setOpen(v=>!v)} className="fixed bottom-4 right-4 z-50 rounded-full bg-primary text-primary-foreground shadow h-12 w-12 flex items-center justify-center">
        <MessageCircle className="h-6 w-6" />
      </button>
      {open && (
        <div className="fixed bottom-20 right-4 z-50 w-96 rounded-lg border bg-background shadow-lg flex flex-col">
          <div className="p-3 border-b font-medium">AI Assistant</div>
          <div ref={boxRef} className="p-3 space-y-3 max-h-80 overflow-auto text-sm">
            {msgs.length===0 && (
              <div className="text-muted-foreground">Ask about NDVI, soil, ET, or weather for this plot.</div>
            )}
            {msgs.map((m,i)=> (
              <div key={i} className={`p-2 rounded ${m.role==='user' ? 'bg-primary/10' : 'bg-muted'}`}>{m.text}</div>
            ))}
          </div>
          <div className="p-3 flex gap-2">
            <input className="flex-1 border rounded px-2 py-1 bg-background" value={input} onChange={e=> setInput(e.target.value)} onKeyDown={e=> { if (e.key==='Enter') ask() }} placeholder="Type a question..." />
            <button onClick={ask} className="rounded bg-primary text-primary-foreground px-3 text-sm flex items-center gap-1"><Send className="h-4 w-4"/>Send</button>
          </div>
        </div>
      )}
    </>
  )
}


