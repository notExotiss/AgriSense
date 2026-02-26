import type { NextApiRequest, NextApiResponse } from 'next'
import { runMlChat } from '../../lib/ml/engine'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const body = req.body || {}
    const prompt = String(body?.prompt || '').trim()
    const result = await runMlChat({
      prompt: prompt || 'Provide a farm health summary.',
      ndviData: body?.ndviData,
      weatherData: body?.weatherData,
      soilData: body?.soilData,
      etData: body?.etData,
      timeSeriesData: body?.timeSeriesData,
      context: body?.context,
      objective: body?.objective || 'balanced',
      mode: body?.mode,
      selectedCell: body?.selectedCell || body?.context?.selectedCell || null,
      providersTried: body?.providersTried,
      history: Array.isArray(body?.history)
        ? body.history.slice(-8).map((turn: any) => ({
            role: turn?.role === 'assistant' ? 'assistant' : 'user',
            text: String(turn?.text || '').slice(0, 400),
          }))
        : [],
    })

    if (!result.chat) {
      const retryAfterMs = Number(result.llmUnavailable?.retryAfterMs || 0) || 8000
      const answer = `Gemini unavailable right now. Retry in about ${Math.max(1, Math.round(retryAfterMs / 1000))}s.`
      return res.status(200).json({
        answer,
        sections: {},
        output: answer,
        assistantBackend: 'unavailable',
        unavailable: true,
        retryAfterMs,
        llmAttemptedModels: result.llmUnavailable?.attemptedModels || [],
        llmFinalModel: null,
        llmRetries: Number(result.llmUnavailable?.retries || 0),
        llmDegraded: true,
        engine: result.inference.engine,
        confidence: result.inference.confidence,
        dataQuality: result.inference.dataQuality,
        inference: result.inference,
        mode: body?.mode || 'status',
        evidence: [],
        tasks: [],
        selectedCell: body?.selectedCell || body?.context?.selectedCell || null,
        scenarioUsed: false,
        confidenceBreakdown: {
          model: result.inference.confidence,
          dataQuality: result.inference.dataQuality?.score,
        },
      })
    }

    return res.status(200).json({
      answer: result.chat.answer,
      sections: result.chat.sections,
      output: result.chat.answer,
      assistantBackend: result.chat.backend || 'llm-gemini',
      engine: result.inference.engine,
      confidence: result.inference.confidence,
      dataQuality: result.inference.dataQuality,
      inference: result.inference,
      mode: result.chat.mode,
      evidence: result.chat.evidence,
      tasks: result.chat.tasks,
      selectedCell: body?.selectedCell || body?.context?.selectedCell || null,
      scenarioUsed: false,
      confidenceBreakdown: {
        model: result.inference.confidence,
        dataQuality: result.inference.dataQuality?.score,
      },
    })
  } catch (error: any) {
    const message = String(error?.message || 'Unexpected inference error')
    const answer = 'Gemini unavailable right now. Retry in a few seconds.'
    return res.status(200).json({
      answer,
      output: answer,
      assistantBackend: 'unavailable',
      unavailable: true,
      retryAfterMs: 8000,
      engine: 'agrisense-ml-engine',
      confidence: 0,
      dataQuality: {
        completeness: 0,
        providerQuality: 0,
        score: 0,
        isSimulatedInputs: true,
        warnings: [message],
      },
      degraded: true,
      warnings: [message],
    })
  }
}
