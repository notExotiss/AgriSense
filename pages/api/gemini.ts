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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const sanitized = sanitizeRequestBody(req.body)

    const { inference, chat } = await runMlChat({
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

    return res.status(200).json({
      success: true,
      answer: chat.answer,
      sections: chat.sections,
      renderModel: chat.renderModel,
      usedHistory: chat.usedHistory,
      suggestion: chat.text,
      output: chat.text,
      assistantBackend: chat.backend || 'deterministic',
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
    const safeMean = toNumber(req.body?.ndviData?.stats?.mean ?? req.body?.context?.ndviStats?.mean, 0.4)
    const riskLabel = safeMean < 0.3 ? 'high' : safeMean < 0.45 ? 'moderate' : 'low'
    const fallbackText = [
      `AI Assistant is running in degraded mode (${message || 'inference unavailable'}).`,
      `Current NDVI mean indicates ${riskLabel} vegetation stress risk.`,
      'Recommended next steps:',
      '1. Re-run analysis for the same AOI and compare the selected 3x3 cell.',
      '2. Prioritize irrigation uniformity checks in stressed cells.',
      '3. Re-check within 24-48 hours after intervention.',
    ].join('\n')
    const fallbackActions = [
      'Re-run analysis for the same AOI and compare selected plot points.',
      'Prioritize irrigation uniformity checks in stressed cells.',
      'Re-check within 24-48 hours after intervention.',
    ]

    return res.status(200).json({
      success: true,
      degraded: true,
      warnings: [message || 'ML inference unavailable; fallback response returned.'],
      answer: fallbackText,
      sections: {
        rationale: `Current NDVI mean indicates ${riskLabel} vegetation stress risk.`,
        actions: fallbackActions,
      },
      renderModel: 'qa',
      usedHistory: false,
      suggestion: fallbackText,
      output: fallbackText,
      assistantBackend: 'deterministic',
      model: 'agrisense-ml-fallback',
      engine: 'agrisense-ml-fallback',
      confidence: 0.42,
      objective: req.body?.objective || 'balanced',
      dataQuality: {
        completeness: 0.5,
        providerQuality: 0.5,
        score: 0.42,
        isSimulatedInputs: true,
        warnings: ['Fallback assistant response'],
      },
      isSimulatedInputs: true,
      inference: null,
      intent: 'general',
      intentConfidence: 0.3,
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
        model: 0.42,
        dataQuality: 0.42,
      },
      timestamp: new Date().toISOString(),
    })
  }
}
