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

function explainLlmFailure(lastFailure?: string, retryAfterMs?: number) {
  const retrySeconds = retryAfterMs && retryAfterMs > 0 ? Math.max(1, Math.round(retryAfterMs / 1000)) : null
  const retryText = retrySeconds ? ` Retry in about ${retrySeconds}s.` : ''
  const failure = String(lastFailure || '').toLowerCase()

  if (failure.includes('gemini_key_leaked')) {
    return {
      answer: `Gemini is blocked because the configured API key was reported as leaked.${retryText}`,
      rationale: 'Google rejected the key at the provider layer before the model could run.',
      actions: [
        'Create a new Gemini API key in Google AI Studio.',
        'Set only GEMINI_API_KEY on the server and remove NEXT_PUBLIC_GEMINI_API_KEY from client env.',
        'Restart the Next.js server after updating the key.',
      ],
    }
  }

  if (failure.includes('gemini_key_invalid') || failure.includes('permission_denied')) {
    return {
      answer: `Gemini rejected the API credentials for this request.${retryText}`,
      rationale: 'The provider returned an authorization failure.',
      actions: [
        'Verify GEMINI_API_KEY is valid and active.',
        'Confirm the key has access to Gemini generateContent.',
        'Restart the server after any env changes.',
      ],
    }
  }

  if (failure.includes('gemini_http_404')) {
    return {
      answer: `Gemini model configuration is invalid for the current API version.${retryText}`,
      rationale: 'The configured model name could not be resolved by the provider.',
      actions: [
        'Set GEMINI_MODEL to a currently available model from the Gemini ListModels endpoint.',
        'Optionally set GEMINI_FALLBACK_MODELS to additional supported models.',
        'Restart the server after changing environment variables.',
      ],
    }
  }

  return {
    answer: `Gemini is temporarily unavailable for this request.${retryText}`,
    rationale: 'The LLM provider did not return a usable response for this request.',
    actions: ['Retry the same question in a moment.', 'If this persists, verify GEMINI_API_KEY and model availability.'],
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

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
      const failure = explainLlmFailure(llmUnavailable?.lastFailure || llmUnavailable?.message, retryAfterMs)
      const attemptedModels = Array.isArray(llmUnavailable?.attemptedModels) ? llmUnavailable?.attemptedModels : []
      const llmRetries = Number(llmUnavailable?.retries || 0)
      return res.status(200).json({
        success: true,
        unavailable: true,
        retryAfterMs,
        assistantBackend: 'unavailable',
        warnings: [llmUnavailable?.lastFailure || llmUnavailable?.message || 'gemini_unavailable'],
        answer: failure.answer,
        sections: {
          rationale: failure.rationale,
          actions: failure.actions,
        },
        renderModel: 'qa',
        usedHistory: false,
        suggestion: failure.answer,
        output: failure.answer,
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

    return res.status(200).json({
      success: true,
      unavailable: false,
      answer: chat.answer,
      sections: chat.sections,
      renderModel: chat.renderModel,
      usedHistory: chat.usedHistory,
      suggestion: chat.text,
      output: chat.text,
      assistantBackend: chat.backend || 'llm-gemini',
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
    const fallbackFailure = explainLlmFailure(message, 8000)
    if (message.toLowerCase().includes('body exceeded')) {
      return res.status(413).json({
        error: 'request_too_large',
        message: 'Request body exceeded limit. Send compact context only.',
      })
    }
    return res.status(200).json({
      success: true,
      unavailable: true,
      retryAfterMs: 8000,
      warnings: [message || 'gemini_unavailable'],
      answer: fallbackFailure.answer,
      sections: {
        rationale: fallbackFailure.rationale,
        actions: fallbackFailure.actions,
      },
      renderModel: 'qa',
      usedHistory: false,
      suggestion: fallbackFailure.answer,
      output: fallbackFailure.answer,
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
