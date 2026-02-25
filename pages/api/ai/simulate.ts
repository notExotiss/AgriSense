import type { NextApiRequest, NextApiResponse } from 'next'
import { runMlInference, runScenario } from '../../../lib/ml/engine'
import type { ScenarioInput } from '../../../lib/ml/types'

type SimResponse = {
  success: boolean
  scenario: ReturnType<typeof runScenario>
  baseline: {
    confidence: number
    objective: string
    recommendations: string[]
  }
  warnings?: string[]
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
}

function fallbackScenario(mean = 0.4, scenario?: ScenarioInput) {
  const irrigation = Number(scenario?.irrigationDelta || 0)
  const baselineRisk7d = Math.max(0.08, Math.min(0.92, (0.45 - mean) * 0.9 + 0.3))
  const scenarioRisk7d = Math.max(0.06, Math.min(0.95, baselineRisk7d - irrigation * 0.22))
  const baselineNdvi30d = Math.max(-0.2, Math.min(0.95, mean))
  const scenarioNdvi30d = Math.max(-0.2, Math.min(0.95, mean + irrigation * 0.08))
  return {
    baselineRisk7d: Number(baselineRisk7d.toFixed(4)),
    scenarioRisk7d: Number(scenarioRisk7d.toFixed(4)),
    baselineNdvi30d: Number(baselineNdvi30d.toFixed(4)),
    scenarioNdvi30d: Number(scenarioNdvi30d.toFixed(4)),
    waterUseDeltaPct: Number((irrigation * 100).toFixed(1)),
    yieldProxyDeltaPct: Number(((scenarioNdvi30d - baselineNdvi30d) * 70).toFixed(1)),
    recommendation: 'Use this scenario as a conservative baseline; rerun after fresh ingest.',
    confidence: 0.42,
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<SimResponse | { error: string; message: string }>) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const body = req.body || {}
    const scenario: ScenarioInput = {
      irrigationDelta: Number(body?.scenario?.irrigationDelta ?? 0),
      waterBudget: Number(body?.scenario?.waterBudget ?? 0.5),
      targetRisk: Number(body?.scenario?.targetRisk ?? 0.35),
      fertilizerDelta: Number(body?.scenario?.fertilizerDelta ?? 0),
    }

    const baseline = await runMlInference({
      prompt: 'simulate scenario',
      objective: body?.objective || 'balanced',
      ndviData: body?.ndviData,
      weatherData: body?.weatherData,
      soilData: body?.soilData,
      etData: body?.etData,
      timeSeriesData: body?.timeSeriesData,
      context: body?.context,
      providersTried: body?.providersTried,
      selectedCell: body?.selectedCell || body?.context?.selectedCell || null,
    })

    const simulation = runScenario(baseline.featureVector, scenario)
    return res.status(200).json({
      success: true,
      scenario: simulation,
      baseline: {
        confidence: baseline.confidence,
        objective: baseline.objective,
        recommendations: baseline.recommendations.map((item) => item.title),
      },
    })
  } catch (error: any) {
    const body = req.body || {}
    const mean = Number(body?.ndviData?.stats?.mean || body?.context?.ndviStats?.mean || 0.4)
    return res.status(200).json({
      success: true,
      scenario: fallbackScenario(mean, body?.scenario),
      baseline: {
        confidence: 0.42,
        objective: String(body?.objective || 'balanced'),
        recommendations: ['Refresh analysis inputs and rerun what-if simulation.'],
      },
      warnings: [String(error?.message || 'Scenario simulation degraded mode active.')],
    })
  }
}
