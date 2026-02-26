import type { NextApiRequest, NextApiResponse } from 'next'
import { runMlChat } from '../../lib/ml/engine'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
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

function compactWeather(raw: any) {
  const current = raw?.current || raw?.weather || raw || {}
  return {
    temperature: toNumber(current.temperature ?? current.temperature_2m),
    humidity: toNumber(current.humidity ?? current.relative_humidity_2m),
    precipitation: toNumber(current.precipitation),
    windSpeed: toNumber(current.windSpeed ?? current.wind_speed_10m),
    source: typeof raw?.source === 'string' ? raw.source : undefined,
    isSimulated: Boolean(raw?.isSimulated),
  }
}

function compactTimeSeries(raw: any) {
  const summary = raw?.summary || raw?.data?.summary || {}
  const points = Array.isArray(raw?.timeSeries)
    ? raw.timeSeries
    : Array.isArray(raw?.data?.timeSeries)
      ? raw.data.timeSeries
      : []
  const recent = points.slice(-12).map((point: any) => ({
    date: typeof point?.date === 'string' ? point.date : '',
    ndvi: toNumber(point?.ndvi),
    cloudCover: typeof point?.cloudCover === 'number' ? point.cloudCover : null,
  }))
  return {
    summary: {
      trend: typeof summary?.trend === 'string' ? summary.trend : 'stable',
      averageNDVI: toNumber(summary?.averageNDVI),
      totalPoints: toNumber(summary?.totalPoints),
    },
    points: recent,
    source: typeof raw?.source === 'string' ? raw.source : undefined,
    isSimulated: Boolean(raw?.isSimulated),
  }
}

function compactProviders(raw: any) {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 12).map((provider) => ({
    provider: String(provider?.provider || 'unknown'),
    ok: Boolean(provider?.ok),
    reason: provider?.reason ? String(provider.reason).slice(0, 120) : undefined,
  }))
}

function compactGrid(raw: any) {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 9).map((cell: any, idx: number) => ({
    cellId: String(cell?.cellId || `${Math.floor(idx / 3)}-${idx % 3}`),
    row: Number.isFinite(Number(cell?.row)) ? Number(cell.row) : Math.floor(idx / 3),
    col: Number.isFinite(Number(cell?.col)) ? Number(cell.col) : idx % 3,
    mean: toNumber(cell?.mean),
    min: toNumber(cell?.min),
    max: toNumber(cell?.max),
    validPixelRatio: toNumber(cell?.validPixelRatio),
    stressLevel: typeof cell?.stressLevel === 'string' ? cell.stressLevel : 'unknown',
  }))
}

function sanitizeRequestBody(body: any) {
  const safeBody = body && typeof body === 'object' ? body : {}
  const prompt = String(safeBody?.prompt || safeBody?.question || '').slice(0, 4000).trim()
  const mode = typeof safeBody?.mode === 'string' ? safeBody.mode : undefined
  const history = Array.isArray(safeBody?.history)
    ? safeBody.history.slice(-8).map((entry: any) => ({
        role: String(entry?.role || 'user').slice(0, 12),
        text: String(entry?.text || '').slice(0, 480),
      }))
    : []

  const context = safeBody?.context || {}
  const ndviStats = compactStats(safeBody?.ndviData?.stats || safeBody?.ndviData || context?.ndviStats)
  const soilStats = compactStats(safeBody?.soilData?.stats || safeBody?.soilData || context?.soilStats)
  const etStats = compactStats(safeBody?.etData?.stats || safeBody?.etData || context?.etStats)

  return {
    prompt,
    analysisType: typeof safeBody?.analysisType === 'string' ? safeBody.analysisType : undefined,
    objective: safeBody?.objective || 'balanced',
    mode,
    ndviData: ndviStats ? { stats: ndviStats } : undefined,
    soilData: soilStats ? { stats: soilStats, isSimulated: Boolean(safeBody?.soilData?.isSimulated || context?.soil?.isSimulated) } : undefined,
    etData: etStats ? { stats: etStats, isSimulated: Boolean(safeBody?.etData?.isSimulated || context?.et?.isSimulated) } : undefined,
    weatherData: compactWeather(safeBody?.weatherData || context?.weather),
    timeSeriesData: compactTimeSeries(safeBody?.timeSeriesData || context?.timeSeries),
    context: {
      ndviStats,
      soilStats,
      etStats,
      grid3x3: compactGrid(context?.grid3x3 || safeBody?.grid3x3),
      selectedCell: typeof context?.selectedCell === 'string' ? context.selectedCell : undefined,
      weather: compactWeather(safeBody?.weatherData || context?.weather),
      timeSeries: compactTimeSeries(safeBody?.timeSeriesData || context?.timeSeries),
      warnings: Array.isArray(context?.warnings) ? context.warnings.slice(0, 12).map((item: any) => String(item).slice(0, 200)) : [],
    },
    providersTried: compactProviders(safeBody?.providersTried || context?.providersTried),
    history,
  }
}

function unavailableMessage(retryAfterMs?: number) {
  const retrySeconds = retryAfterMs && retryAfterMs > 0 ? Math.max(1, Math.round(retryAfterMs / 1000)) : null
  return retrySeconds
    ? `Gemini unavailable right now. Retry in about ${retrySeconds}s.`
    : 'Gemini unavailable right now. Retry in a few seconds.'
}

const globalRuntime = globalThis as typeof globalThis & { __agrisenseGeminiEnvWarned?: boolean }

function warnGeminiEnvIfNeeded() {
  const hasServerKey = Boolean(
    process.env.GEMINI_API_KEY || process.env.AGRISENSE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  )
  if (!hasServerKey && !globalRuntime.__agrisenseGeminiEnvWarned) {
    globalRuntime.__agrisenseGeminiEnvWarned = true
    console.warn('[AgriSense] Gemini server API key missing. Configure GEMINI_API_KEY for /api/gemini.')
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  warnGeminiEnvIfNeeded()

  try {
    const sanitized = sanitizeRequestBody(req.body)

    const { inference, chat, llmUnavailable } = await runMlChat({
      prompt: sanitized.prompt || 'Provide a field operations summary.',
      analysisType: sanitized.analysisType,
      objective: sanitized.objective,
      mode: sanitized.mode,
      ndviData: sanitized.ndviData,
      weatherData: sanitized.weatherData,
      soilData: sanitized.soilData,
      etData: sanitized.etData,
      timeSeriesData: sanitized.timeSeriesData,
      context: sanitized.context,
      providersTried: sanitized.providersTried,
      selectedCell: sanitized.context?.selectedCell,
      history: sanitized.history,
    })

    if (!chat) {
      const retryAfterMs = Number(llmUnavailable?.retryAfterMs || 0) || undefined
      const attemptedModels = Array.isArray(llmUnavailable?.attemptedModels) ? llmUnavailable?.attemptedModels : []
      const llmRetries = Number(llmUnavailable?.retries || 0)
      const message = unavailableMessage(retryAfterMs)
      return res.status(200).json({
        success: true,
        unavailable: true,
        retryAfterMs,
        assistantBackend: 'unavailable',
        warnings: [llmUnavailable?.lastFailure || llmUnavailable?.message || 'gemini_unavailable'],
        answer: message,
        sections: {},
        renderModel: 'qa',
        usedHistory: false,
        suggestion: message,
        output: message,
        model: inference.engine,
        engine: inference.engine,
        confidence: inference.confidence,
        objective: inference.objective,
        dataQuality: inference.dataQuality,
        isSimulatedInputs: inference.isSimulatedInputs,
        inference,
        intent: 'general',
        intentConfidence: 0,
        mode: sanitized.mode || 'status',
        evidence: [],
        tasks: [],
        selectedCell: sanitized.context?.selectedCell || null,
        scenarioUsed: false,
        llmAttemptedModels: attemptedModels,
        llmFinalModel: null,
        llmRetries,
        llmDegraded: true,
        confidenceBreakdown: {
          model: inference.confidence,
          dataQuality: inference.dataQuality.score,
        },
        timestamp: new Date().toISOString(),
      })
    }

    const fallbackMode = chat.backend === 'unavailable'
    const fallbackWarning = llmUnavailable?.lastFailure || llmUnavailable?.message || null
    return res.status(200).json({
      success: true,
      unavailable: fallbackMode || Boolean(chat.unavailable),
      retryAfterMs: chat.retryAfterMs || llmUnavailable?.retryAfterMs,
      answer: chat.answer,
      sections: chat.sections,
      renderModel: chat.renderModel,
      usedHistory: chat.usedHistory,
      suggestion: chat.answer,
      output: chat.answer,
      assistantBackend: fallbackMode ? 'unavailable' : chat.backend || 'llm-gemini',
      warnings: fallbackWarning ? [fallbackWarning] : [],
      model: inference.engine,
      engine: inference.engine,
      confidence: inference.confidence,
      objective: inference.objective,
      dataQuality: inference.dataQuality,
      isSimulatedInputs: inference.isSimulatedInputs,
      inference,
      intent: chat.intent,
      intentConfidence: chat.intentConfidence,
      mode: chat.mode,
      evidence: chat.evidence,
      tasks: chat.tasks,
      selectedCell: sanitized.context?.selectedCell || null,
      scenarioUsed: false,
      llmAttemptedModels: chat.llmAttemptedModels || [],
      llmFinalModel: chat.llmFinalModel || null,
      llmRetries: Number(chat.llmRetries || 0),
      llmDegraded: Boolean(chat.llmDegraded),
      confidenceBreakdown: {
        model: inference.confidence,
        dataQuality: inference.dataQuality.score,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    const message = String(error?.message || '')
    if (message.toLowerCase().includes('body exceeded')) {
      return res.status(413).json({
        error: 'request_too_large',
        message: 'Request body exceeded limit. Send compact context only.',
      })
    }
    const unavailable = unavailableMessage(8000)
    return res.status(200).json({
      success: true,
      unavailable: true,
      retryAfterMs: 8000,
      warnings: [message || 'gemini_unavailable'],
      answer: unavailable,
      sections: {},
      renderModel: 'qa',
      usedHistory: false,
      suggestion: unavailable,
      output: unavailable,
      assistantBackend: 'unavailable',
      model: 'agrisense-ml-engine',
      engine: 'agrisense-ml-engine',
      confidence: 0,
      objective: req.body?.objective || 'balanced',
      dataQuality: {
        completeness: 0,
        providerQuality: 0,
        score: 0,
        isSimulatedInputs: true,
        warnings: ['Assistant unavailable'],
      },
      isSimulatedInputs: true,
      inference: null,
      intent: 'general',
      intentConfidence: 0,
      mode: req.body?.mode || 'status',
      evidence: [],
      tasks: [],
      selectedCell: req.body?.selectedCell || req.body?.context?.selectedCell || null,
      scenarioUsed: false,
      llmAttemptedModels: [],
      llmFinalModel: null,
      llmRetries: 0,
      llmDegraded: true,
      confidenceBreakdown: {
        model: 0,
        dataQuality: 0,
      },
      timestamp: new Date().toISOString(),
    })
  }
}
