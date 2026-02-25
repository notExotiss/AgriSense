import { classifyIntent } from './intent'
import type { ChatHistoryTurn, MLChatResponse, MLInferenceResult } from './types'

type LlmComposeInput = {
  prompt: string
  mode?: string
  objective?: string
  selectedCell?: string | null
  inference: MLInferenceResult
  history?: ChatHistoryTurn[]
  context?: any
}

const GEMINI_API_BASES = [
  'https://generativelanguage.googleapis.com/v1beta/models',
  'https://generativelanguage.googleapis.com/v1/models',
]
const DEFAULT_MODEL = 'gemini-2.5-flash'
const DEFAULT_FALLBACK_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
]
const REQUEST_TIMEOUT_MS = 25000
const MAX_RETRIES_PER_MODEL = 2

export class GeminiUnavailableError extends Error {
  attemptedModels: string[]
  retries: number
  retryAfterMs?: number
  lastFailure: string

  constructor(message: string, details: { attemptedModels: string[]; retries: number; retryAfterMs?: number; lastFailure: string }) {
    super(message)
    this.name = 'GeminiUnavailableError'
    this.attemptedModels = details.attemptedModels
    this.retries = details.retries
    this.retryAfterMs = details.retryAfterMs
    this.lastFailure = details.lastFailure
  }
}

function toMode(value?: string): MLChatResponse['mode'] {
  if (
    value === 'irrigation-plan' ||
    value === 'stress-debug' ||
    value === 'forecast' ||
    value === 'next-actions' ||
    value === 'what-if-explainer' ||
    value === 'status'
  ) {
    return value
  }
  return 'status'
}

function toRenderModel(mode: MLChatResponse['mode']): MLChatResponse['renderModel'] {
  if (mode === 'what-if-explainer') return 'what-if'
  if (mode === 'status') return 'status'
  return 'qa'
}

function compactEvidence(inference: MLInferenceResult) {
  return [
    `NDVI mean ${inference.featureVector.ndviMean}`,
    `7-day delta ${inference.featureVector.ndviDelta7}`,
    `30-day delta ${inference.featureVector.ndviDelta30}`,
    `Risk 7d ${Math.round(inference.forecast.risk7d * 100)}%`,
    `Anomaly ${Math.round(inference.anomaly.score * 100)}%`,
    `Confidence ${Math.round(inference.confidence * 100)}%`,
  ]
}

function buildLegacyText(answer: string, rationale?: string, actions?: string[], forecast?: string, evidence?: string[]) {
  const lines: string[] = [answer]
  if (rationale) lines.push(`Why: ${rationale}`)
  if (actions?.length) {
    lines.push(`Actions:\n${actions.map((action, index) => `${index + 1}. ${action}`).join('\n')}`)
  }
  if (forecast) lines.push(`Forecast: ${forecast}`)
  if (evidence?.length) lines.push(`Evidence:\n- ${evidence.join('\n- ')}`)
  return lines.join('\n\n')
}

function parseJsonFromText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    const block = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (!block?.[1]) return null
    try {
      return JSON.parse(block[1].trim())
    } catch {
      return null
    }
  }
}

function decodeJsonEscapes(value: string) {
  try {
    return JSON.parse(`"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
  } catch {
    return value
  }
}

function sanitizeAnswerText(raw: unknown) {
  let text = String(raw || '').trim()
  if (!text) return ''

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) text = fenced[1].trim()

  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    const parsed = parseJsonFromText(text)
    if (parsed && typeof parsed === 'object') {
      const fromKeys = (parsed as any).answer || (parsed as any).response || (parsed as any).text
      const nested = typeof (parsed as any).data === 'object' ? ((parsed as any).data?.answer || (parsed as any).data?.text) : ''
      const resolved = String(fromKeys || nested || '').trim()
      if (resolved) text = resolved
    }
  }

  if (!text || text.startsWith('{') || text.startsWith('[')) {
    const answerMatch = text.match(/"answer"\s*:\s*"([\s\S]*?)"/i)
    if (answerMatch?.[1]) {
      text = decodeJsonEscapes(answerMatch[1]).replace(/\\n/g, '\n').trim()
    }
  }

  text = text
    .replace(/^["'`{[]+/, '')
    .replace(/["'`\]}]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  return text
}

function sanitizeActions(raw: unknown) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 5)
}

function normalizeHistory(history?: ChatHistoryTurn[]) {
  if (!Array.isArray(history)) return []
  return history
    .slice(-10)
    .map((turn) => ({
      role: turn.role === 'assistant' ? 'model' : 'user',
      text: String(turn.text || '').slice(0, 600),
    }))
    .filter((turn) => Boolean(turn.text))
}

function buildContextPacket(input: LlmComposeInput) {
  const inference = input.inference
  const rawGrid = Array.isArray(input.context?.grid3x3) ? input.context.grid3x3.slice(0, 9) : []
  const selectedCell = input.selectedCell || input.context?.selectedCell || null
  const selectedCellData = selectedCell
    ? rawGrid.find((cell: any) => String(cell?.cellId || '') === String(selectedCell))
    : null

  return {
    objective: input.objective || inference.objective || 'balanced',
    mode: toMode(input.mode),
    selectedCell,
    selectedCellData: selectedCellData || null,
    inference: {
      summary: inference.summary,
      confidence: inference.confidence,
      dataQuality: inference.dataQuality,
      forecast: inference.forecast,
      anomaly: inference.anomaly,
      featureVector: inference.featureVector,
      recommendations: (inference.recommendations || []).slice(0, 4).map((item) => ({
        title: item.title,
        priority: item.priority,
        reason: item.reason,
        actions: (item.actions || []).slice(0, 4),
        expectedImpact: item.expectedImpact,
        confidence: item.confidence,
        timeWindow: item.timeWindow,
      })),
      tasks: (inference.tasks || []).slice(0, 5),
    },
    observed: {
      ndviStats: input.context?.ndviStats || null,
      soilStats: input.context?.soilStats || null,
      etStats: input.context?.etStats || null,
      weather: input.context?.weather || null,
      timeSeriesSummary: input.context?.timeSeries?.summary || null,
      grid3x3: rawGrid,
    },
    providerDiagnostics: {
      providersTried: Array.isArray(input.context?.providersTried) ? input.context.providersTried.slice(0, 12) : [],
      warnings: [
        ...(Array.isArray(input.context?.warnings) ? input.context.warnings.slice(0, 12) : []),
        ...(Array.isArray(inference?.warnings) ? inference.warnings.slice(0, 12) : []),
      ],
    },
  }
}

function buildSystemPrompt() {
  return [
    'You are AgriSense AI Assistant for farm operations.',
    'Answer the user question first in plain language, then provide rationale, actions, and forecast when relevant.',
    'Use only provided context and metrics. Never invent unavailable values.',
    'If the question references missing context, say exactly what is missing and ask one concise clarifying question.',
    'Do not return markdown code fences or raw JSON objects in the answer.',
    'Return strict JSON only with keys: answer, rationale, actions, forecast, mode.',
    'actions must be an array of 0-5 concise action strings.',
    'mode must be one of: status, irrigation-plan, stress-debug, forecast, next-actions, what-if-explainer.',
  ].join(' ')
}

function buildModelCandidates() {
  const normalizeModelName = (value: string) =>
    String(value || '')
      .trim()
      .replace(/^models\//i, '')
      .replace(/:generateContent$/i, '')

  const primary = normalizeModelName(process.env.GEMINI_MODEL || process.env.AGRISENSE_LLM_MODEL || DEFAULT_MODEL)
  const configuredFallback = String(process.env.GEMINI_FALLBACK_MODELS || '')
    .split(',')
    .map((value) => normalizeModelName(value))
    .filter(Boolean)

  const candidates = [primary, ...configuredFallback, ...DEFAULT_FALLBACK_MODELS.map((model) => normalizeModelName(model))]
  const unique: string[] = []
  for (const model of candidates) {
    if (!unique.includes(model)) unique.push(model)
  }
  return unique
}

function shouldRetryStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function extractGeminiText(payload: any) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : []
  const first = candidates[0]
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : []
  const textPart = parts.find((part: any) => typeof part?.text === 'string')
  return String(textPart?.text || '').trim()
}

async function requestGeminiContent(
  apiKey: string,
  model: string,
  body: any
) {
  let fallbackResponse: Response | null = null
  for (const base of GEMINI_API_BASES) {
    const endpoint = `${base}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      REQUEST_TIMEOUT_MS
    )
    if (response.status === 404) {
      fallbackResponse = response
      continue
    }
    return response
  }
  return fallbackResponse as Response
}

async function discoverGeminiModels(apiKey: string): Promise<string[]> {
  const discovered: string[] = []
  for (const base of GEMINI_API_BASES) {
    try {
      const endpoint = `${base}?key=${encodeURIComponent(apiKey)}`
      const response = await fetchWithTimeout(endpoint, { method: 'GET' }, Math.min(REQUEST_TIMEOUT_MS, 8000))
      if (!response.ok) continue
      const payload = await response.json().catch(() => null)
      const models: any[] = Array.isArray(payload?.models) ? payload.models : []
      for (const model of models) {
        const methods = Array.isArray(model?.supportedGenerationMethods) ? model.supportedGenerationMethods : []
        if (!methods.some((method: string) => String(method).toLowerCase() === 'generatecontent')) continue
        const name = String(model?.name || '').replace(/^models\//i, '').trim()
        if (name) discovered.push(name)
      }
    } catch {
      // ignore and keep trying alternate API base
    }
  }
  return Array.from(new Set(discovered))
}

function parseGeminiError(text: string) {
  const fallback = {
    message: text.slice(0, 260),
    status: 'UNKNOWN',
  }
  try {
    const parsed = JSON.parse(text)
    const err = parsed?.error
    return {
      message: String(err?.message || fallback.message),
      status: String(err?.status || fallback.status),
    }
  } catch {
    return fallback
  }
}

export async function composeLlmChatResponse(input: LlmComposeInput): Promise<MLChatResponse | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.AGRISENSE_GEMINI_API_KEY
  if (!apiKey) return null

  const intent = classifyIntent(input.prompt || '')
  const history = normalizeHistory(input.history)
  const mode = toMode(input.mode)
  const contextPacket = buildContextPacket(input)
  const attemptedModels: string[] = []
  let totalRetries = 0
  let finalModel: string | null = null
  let lastFailure = 'gemini_failed'
  let retryAfterMs: number | undefined

  const contents: any[] = [
    {
      role: 'user',
      parts: [{ text: `System rules:\n${buildSystemPrompt()}` }],
    },
    ...history.map((turn) => ({
    role: turn.role,
    parts: [{ text: turn.text }],
  })),
  ]
  contents.push({
    role: 'user',
    parts: [
      {
        text: JSON.stringify({
          question: String(input.prompt || '').slice(0, 4000),
          context: contextPacket,
          outputContract: {
            answer: 'string',
            rationale: 'string',
            actions: ['string'],
            forecast: 'string',
            mode: 'status|irrigation-plan|stress-debug|forecast|next-actions|what-if-explainer',
          },
        }),
      },
    ],
  })

  const requestBody = {
    contents,
    generationConfig: {
      temperature: 0.25,
      topP: 0.9,
      maxOutputTokens: 720,
    },
  }

  const configuredCandidates = buildModelCandidates()
  const discoveredCandidates = await discoverGeminiModels(apiKey)
  const discoveredSet = new Set(discoveredCandidates)
  const prioritizedConfigured =
    discoveredSet.size > 0
      ? configuredCandidates.filter((model) => discoveredSet.has(model))
      : configuredCandidates
  const modelCandidates: string[] = Array.from(
    new Set<string>([...prioritizedConfigured, ...discoveredCandidates, ...configuredCandidates])
  )
  for (const model of modelCandidates) {
    if (!attemptedModels.includes(model)) attemptedModels.push(model)

    for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
      let response: Response
      try {
        response = await requestGeminiContent(apiKey, model, requestBody)
      } catch (error: any) {
        lastFailure = String(error?.message || 'gemini_network_error')
        if (attempt < MAX_RETRIES_PER_MODEL) {
          totalRetries += 1
          await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)))
          continue
        }
        break
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        const parsedError = parseGeminiError(text)
        const normalizedMessage = parsedError.message.toLowerCase()
        const leakedKey =
          normalizedMessage.includes('reported as leaked') ||
          normalizedMessage.includes('api key') && normalizedMessage.includes('leaked')
        const invalidKey =
          normalizedMessage.includes('api key not valid') ||
          normalizedMessage.includes('invalid api key')
        const blocked =
          normalizedMessage.includes('permission denied') ||
          normalizedMessage.includes('not authorized')
        if (leakedKey) {
          lastFailure = 'gemini_key_leaked'
        } else if (invalidKey) {
          lastFailure = 'gemini_key_invalid'
        } else if (blocked) {
          lastFailure = `gemini_permission_denied:${parsedError.status}`
        } else {
          lastFailure = `gemini_http_${response.status}:${parsedError.status}:${parsedError.message.slice(0, 180)}`
        }
        const retryAfterHeader = response.headers.get('retry-after')
        if (retryAfterHeader) {
          const seconds = Number(retryAfterHeader)
          if (Number.isFinite(seconds) && seconds > 0) {
            retryAfterMs = Math.max(retryAfterMs || 0, Math.round(seconds * 1000))
          }
        }
        if (shouldRetryStatus(response.status) && attempt < MAX_RETRIES_PER_MODEL) {
          totalRetries += 1
          await new Promise((resolve) => setTimeout(resolve, 420 * (attempt + 1)))
          continue
        }
        break
      }

      const payload = await response.json().catch(() => null)
      const rawText = extractGeminiText(payload)
      if (!rawText) {
        lastFailure = 'gemini_empty_response'
        if (attempt < MAX_RETRIES_PER_MODEL) {
          totalRetries += 1
          await new Promise((resolve) => setTimeout(resolve, 280 * (attempt + 1)))
          continue
        }
        break
      }

      const parsed = parseJsonFromText(rawText)
      const answer = sanitizeAnswerText((parsed as any)?.answer || rawText)
      if (!answer) {
        lastFailure = 'gemini_missing_answer'
        if (attempt < MAX_RETRIES_PER_MODEL) {
          totalRetries += 1
          await new Promise((resolve) => setTimeout(resolve, 280 * (attempt + 1)))
          continue
        }
        break
      }

      finalModel = model
      const rationale = String((parsed as any)?.rationale || '').trim() || undefined
      const forecast = String((parsed as any)?.forecast || '').trim() || undefined
      const actions = sanitizeActions((parsed as any)?.actions)
      const finalMode = toMode((parsed as any)?.mode || mode)
      const evidence = compactEvidence(input.inference).slice(0, 6)

      return {
        backend: 'llm-gemini',
        mode: finalMode,
        renderModel: toRenderModel(finalMode),
        intent: intent.intent,
        intentConfidence: intent.confidence,
        usedHistory: history.length > 0,
        answer,
        sections: {
          rationale,
          actions,
          forecast,
        },
        evidence,
        tasks: input.inference.tasks.slice(0, 5),
        text: buildLegacyText(answer, rationale, actions, forecast, evidence),
        llmAttemptedModels: attemptedModels,
        llmFinalModel: finalModel,
        llmRetries: totalRetries,
        llmDegraded: totalRetries > 0 || attemptedModels.length > 1,
      }
    }
  }

  throw new GeminiUnavailableError('gemini_all_models_failed', {
    attemptedModels,
    retries: totalRetries,
    retryAfterMs,
    lastFailure,
  })
}
