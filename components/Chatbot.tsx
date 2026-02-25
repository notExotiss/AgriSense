'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircle, Send, Loader2, AlertTriangle } from 'lucide-react'

type ChatState = 'idle' | 'loading' | 'partial-data' | 'provider-outage' | 'offline'

type AssistantDetail = {
  sections?: {
    rationale?: string
    actions?: string[]
    forecast?: string
  }
  evidence?: string[]
  tasks?: Array<{ title?: string } | string>
  renderModel?: 'qa' | 'status' | 'what-if'
}

type Message = {
  role: 'user' | 'assistant'
  text: string
  detail?: AssistantDetail
}

type Props = {
  context: any
  objective?: 'balanced' | 'yield' | 'water'
}

function toNumber(value: any, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function compactStats(raw: any) {
  if (!raw || typeof raw !== 'object') return null
  return {
    min: toNumber(raw.min),
    max: toNumber(raw.max),
    mean: toNumber(raw.mean),
  }
}

function buildCompactContext(raw: any) {
  const context = raw || {}
  return {
    ndviStats: compactStats(context.ndviStats),
    soilStats: compactStats(context.soilStats),
    etStats: compactStats(context.etStats),
    weather: {
      source: context?.weather?.source || context?.weather?.data?.source || undefined,
      isSimulated: Boolean(context?.weather?.isSimulated),
      current: {
        temperature: toNumber(context?.weather?.data?.current?.temperature ?? context?.weather?.current?.temperature),
        humidity: toNumber(context?.weather?.data?.current?.humidity ?? context?.weather?.current?.humidity),
        precipitation: toNumber(context?.weather?.data?.current?.precipitation ?? context?.weather?.current?.precipitation),
        windSpeed: toNumber(context?.weather?.data?.current?.windSpeed ?? context?.weather?.current?.windSpeed),
      },
    },
    timeSeries: {
      source: context?.timeSeries?.source || context?.timeSeries?.data?.source || undefined,
      isSimulated: Boolean(context?.timeSeries?.isSimulated),
      summary: context?.timeSeries?.data?.summary || context?.timeSeries?.summary || null,
    },
    inference: {
      confidence: toNumber(context?.inference?.confidence),
      anomalyLevel: context?.inference?.anomaly?.level || null,
      trend: context?.inference?.forecast?.trend || null,
    },
    grid3x3: Array.isArray(context?.grid3x3) ? context.grid3x3.slice(0, 9) : [],
    selectedCell: typeof context?.selectedCell === 'string' ? context.selectedCell : null,
    warnings: Array.isArray(context?.warnings) ? context.warnings.slice(0, 8) : [],
    providersTried: Array.isArray(context?.providersTried)
      ? context.providersTried.slice(0, 8).map((provider: any) => ({
          provider: provider?.provider,
          ok: Boolean(provider?.ok),
          reason: provider?.reason || undefined,
        }))
      : [],
  }
}

function stateLabel(state: ChatState) {
  if (state === 'loading') return 'Analyzing'
  if (state === 'partial-data') return 'Partial data'
  if (state === 'provider-outage') return 'Provider outage'
  if (state === 'offline') return 'Offline fallback'
  return 'Ready'
}

function renderActions(detail?: AssistantDetail) {
  const sectionActions = Array.isArray(detail?.sections?.actions) ? detail?.sections?.actions || [] : []
  const taskTitles = Array.isArray(detail?.tasks)
    ? detail.tasks
        .map((task) => (typeof task === 'string' ? task : task?.title || ''))
        .filter(Boolean)
    : []
  const ordered = [...sectionActions, ...taskTitles]
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const item of ordered) {
    const key = item.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(item.trim())
    if (deduped.length >= 4) break
  }
  return deduped
}

export default function Chatbot({ context, objective = 'balanced' }: Props) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [state, setState] = useState<ChatState>('idle')
  const [assistantBackend, setAssistantBackend] = useState<'llm-gemini' | 'deterministic'>('deterministic')
  const [llmMeta, setLlmMeta] = useState<{ model: string | null; retries: number; degraded: boolean }>({
    model: null,
    retries: 0,
    degraded: false,
  })
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const hasContext = useMemo(
    () => Boolean(context?.ndviStats || context?.weather || context?.timeSeries),
    [context]
  )

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e7, behavior: 'smooth' })
  }, [messages, state])

  async function ask(customPrompt?: string, mode?: string) {
    const question = (customPrompt || input).trim()
    if (!question) return

    setMessages((prev) => [...prev, { role: 'user', text: question }])
    if (!customPrompt) setInput('')
    setState('loading')

    try {
      const compactContext = buildCompactContext(context)
      let requestPayload: any = {
        prompt: question,
        context: compactContext,
        objective,
        analysisType: 'chat',
        mode,
        history: messages.slice(-8).map((message) => ({ role: message.role, text: message.text })),
      }
      if (JSON.stringify(requestPayload).length > 120000) {
        requestPayload = {
          ...requestPayload,
          context: {
            ...compactContext,
            providersTried: [],
            warnings: [],
          },
        }
      }

      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const reason = String(payload?.error || response.statusText || 'analysis_failed')
        const message = payload?.message || 'Analysis unavailable right now.'
        setState(reason.includes('provider') ? 'provider-outage' : 'partial-data')
        setMessages((prev) => [...prev, { role: 'assistant', text: message }])
        return
      }

      const answer = String(payload?.answer || payload?.suggestion || payload?.output || '').trim() || 'No recommendation generated.'
      const backend = payload?.assistantBackend === 'llm-gemini' ? 'llm-gemini' : 'deterministic'
      setAssistantBackend(backend)
      setLlmMeta({
        model: typeof payload?.llmFinalModel === 'string' ? payload.llmFinalModel : null,
        retries: Number(payload?.llmRetries || 0),
        degraded: Boolean(payload?.llmDegraded),
      })
      const detail: AssistantDetail = {
        sections: payload?.sections || undefined,
        evidence: Array.isArray(payload?.evidence) ? payload.evidence.slice(0, 5) : [],
        tasks: Array.isArray(payload?.tasks) ? payload.tasks.slice(0, 4) : [],
        renderModel: payload?.renderModel,
      }
      const simulated = Boolean(payload?.isSimulatedInputs)
      setState(simulated ? 'partial-data' : 'idle')
      setMessages((prev) => [...prev, { role: 'assistant', text: answer, detail }])
    } catch {
      const fallback = 'Offline fallback: check irrigation uniformity, scout low-vigor zones, and re-run analysis in 24 hours.'
      setState('offline')
      setMessages((prev) => [...prev, { role: 'assistant', text: fallback }])
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-700/20 bg-zinc-950 text-zinc-50 shadow-lg shadow-black/25"
        aria-label="Open AI Assistant"
      >
        <MessageCircle className="h-6 w-6" />
      </button>

      {open && (
        <section className="liquid-glass fixed bottom-24 right-5 z-50 w-[min(96vw,25rem)] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-black/15">
          <header className="border-b border-zinc-200 bg-zinc-950 px-4 py-3 text-zinc-50">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold tracking-wide">AI Assistant</p>
                <p className="text-xs text-zinc-300">Question-first agronomy guidance</p>
              </div>
              <div className="flex items-center gap-1">
                <span className="rounded-full border border-zinc-600 px-2 py-0.5 text-[11px]">
                  {assistantBackend === 'llm-gemini' ? 'Gemini online' : 'Fallback'}
                </span>
                <span className="rounded-full border border-zinc-600 px-2 py-0.5 text-[11px]">
                  {stateLabel(state)}
                </span>
              </div>
            </div>
            {assistantBackend === 'llm-gemini' && (
              <p className="mt-2 text-[11px] text-zinc-300">
                {llmMeta.model ? `Model: ${llmMeta.model}` : 'Model: Gemini'} {llmMeta.retries > 0 ? `| retries ${llmMeta.retries}` : ''}
                {llmMeta.degraded ? ' | degraded mode' : ''}
              </p>
            )}
          </header>

          <div ref={scrollRef} className="max-h-80 space-y-3 overflow-auto bg-zinc-50 px-4 py-4 text-sm">
            {!messages.length && (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-3 text-zinc-600">
                {hasContext
                  ? 'Ask direct questions like: Why is P5 stressed? What should I do tomorrow?'
                  : 'Run an analysis first to provide data-aware recommendations.'}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void ask('Why is this selected plot point stressed right now?', 'stress-debug')}
                className="rounded-full border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100"
              >
                Explain anomaly
              </button>
              <button
                onClick={() => void ask('Give me a water-saving plan for tomorrow.', 'irrigation-plan')}
                className="rounded-full border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100"
              >
                Water-saving plan
              </button>
              <button
                onClick={() => void ask('What should I do next to protect yield?', 'next-actions')}
                className="rounded-full border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100"
              >
                Yield-priority plan
              </button>
              <button
                onClick={() => void ask('Run through a what-if setup for irrigation and risk.', 'what-if-explainer')}
                className="rounded-full border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100"
              >
                Run what-if
              </button>
            </div>

            {messages.map((message, index) => {
              const actions = message.role === 'assistant' ? renderActions(message.detail) : []
              const evidence = message.role === 'assistant' && Array.isArray(message.detail?.evidence) ? message.detail?.evidence || [] : []
              return (
                <div
                  key={`${message.role}-${index}`}
                  className={
                    message.role === 'user'
                      ? 'ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-emerald-900 px-3 py-2 text-emerald-50'
                      : 'w-fit max-w-[92%] rounded-2xl rounded-bl-sm border border-zinc-200 bg-white px-3 py-2 text-zinc-800'
                  }
                >
                  <p className={message.role === 'assistant' ? 'whitespace-pre-wrap' : ''}>{message.text}</p>
                  {message.role === 'assistant' && message.detail?.sections?.rationale && (
                    <p className="mt-2 text-xs text-zinc-600">
                      <span className="font-semibold text-zinc-700">Why:</span> {message.detail.sections.rationale}
                    </p>
                  )}
                  {message.role === 'assistant' && message.detail?.sections?.forecast && (
                    <p className="mt-2 text-xs text-zinc-600">
                      <span className="font-semibold text-zinc-700">Forecast:</span> {message.detail.sections.forecast}
                    </p>
                  )}
                  {message.role === 'assistant' && actions.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-semibold text-zinc-700">Suggested actions</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-zinc-600">
                        {actions.map((action) => (
                          <li key={action}>{action}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {message.role === 'assistant' && evidence.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-semibold text-zinc-700">Evidence</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-zinc-600">
                        {evidence.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            })}

            {state === 'loading' && (
              <div className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-zinc-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Building recommendation
              </div>
            )}

            {(state === 'partial-data' || state === 'provider-outage') && (
              <div className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                Some providers are degraded. Guidance is conservative.
              </div>
            )}
          </div>

          <footer className="border-t border-zinc-200 bg-white p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void ask()
                  }
                }}
                rows={2}
                placeholder="Ask a direct field question..."
                className="min-h-[2.5rem] flex-1 resize-none rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-200"
              />
              <button
                onClick={() => void ask()}
                disabled={state === 'loading' || !input.trim()}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-900 text-emerald-50 disabled:cursor-not-allowed disabled:bg-zinc-300"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </footer>
        </section>
      )}
    </>
  )
}
