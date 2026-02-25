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

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_MODEL = 'gemini-1.5-flash'
const DEFAULT_FALLBACK_MODELS = ['gemini-1.5-flash', 'gemini-1.5-flash-8b']
const REQUEST_TIMEOUT_MS = 25000
const MAX_RETRIES_PER_MODEL = 2

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
    'Return strict JSON only with keys: answer, rationale, actions, forecast, mode.',
    'actions must be an array of 0-5 concise action strings.',
    'mode must be one of: status, irrigation-plan, stress-debug, forecast, next-actions, what-if-explainer.',
  ].join(' ')
}

function buildModelCandidates() {
  const primary = process.env.GEMINI_MODEL || process.env.AGRISENSE_LLM_MODEL || DEFAULT_MODEL
  const configuredFallback = String(process.env.GEMINI_FALLBACK_MODELS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const candidates = [primary, ...configuredFallback, ...DEFAULT_FALLBACK_MODELS]
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
  const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    REQUEST_TIMEOUT_MS
  )
  return response
}

export async function composeLlmChatResponse(input: LlmComposeInput): Promise<MLChatResponse | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY
  if (!apiKey) return null

  const intent = classifyIntent(input.prompt || '')
  const history = normalizeHistory(input.history)
  const mode = toMode(input.mode)
  const contextPacket = buildContextPacket(input)
  const attemptedModels: string[] = []
  let totalRetries = 0
  let finalModel: string | null = null
  let lastFailure = 'gemini_failed'

  const contents: any[] = history.map((turn) => ({
    role: turn.role,
    parts: [{ text: turn.text }],
  }))
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
    systemInstruction: {
      parts: [{ text: buildSystemPrompt() }],
    },
    contents,
    generationConfig: {
      temperature: 0.25,
      topP: 0.9,
      maxOutputTokens: 720,
      responseMimeType: 'application/json',
    },
  }

  const modelCandidates = buildModelCandidates()
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
        lastFailure = `gemini_http_${response.status}:${text.slice(0, 220)}`
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
      const answer = String((parsed as any)?.answer || rawText).trim()
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

  throw new Error(`gemini_all_models_failed:${lastFailure}`)
}

