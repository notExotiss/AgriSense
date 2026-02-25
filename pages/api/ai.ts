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

    return res.status(200).json({
      answer: result.chat.answer,
      sections: result.chat.sections,
      output: result.chat.text,
      assistantBackend: result.chat.backend || 'deterministic',
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
    const fallback = [
      'AI Assistant fallback mode is active.',
      'Use current NDVI trend, anomaly score, and selected-cell stress to prioritize irrigation and scouting.',
      'Re-run analysis after refreshing data providers.',
    ].join(' ')
    return res.status(200).json({
      output: fallback,
      engine: 'agrisense-ml-fallback',
      confidence: 0.42,
      dataQuality: {
        completeness: 0.5,
        providerQuality: 0.5,
        score: 0.42,
        isSimulatedInputs: true,
        warnings: [message],
      },
      degraded: true,
      warnings: [message],
    })
  }
}
