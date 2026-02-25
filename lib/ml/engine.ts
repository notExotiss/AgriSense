import { randomUUID } from 'crypto'
import { computeAnomalyScore } from './anomaly'
import { composeChatResponse } from './chat'
import { buildDataQuality, buildFeatureVector } from './feature-engineering'
import { forecastNdvi } from './forecasting'
import { computeZoneClusters } from './kmeans'
import { composeLlmChatResponse } from './llm-chat'
import { persistInferenceFeedback, persistModelHeartbeat, ML_ENGINE_VERSION } from './persistence'
import { buildRecommendations, computeObjectiveRisk } from './recommendations'
import { runWhatIfSimulation } from './simulation'
import type { MLInferenceResult, MLInput, MLTask, Objective, ScenarioInput } from './types'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function normalizeObjective(value: unknown): Objective {
  if (value === 'yield' || value === 'water' || value === 'balanced') return value
  return 'balanced'
}

function deriveSummary(result: Omit<MLInferenceResult, 'summary'>) {
  const riskPct = Math.round(result.forecast.risk7d * 100)
  const trendText = result.forecast.trend === 'improving' ? 'improving' : result.forecast.trend === 'declining' ? 'declining' : 'stable'
  const whatChanged =
    result.anomaly.level === 'high'
      ? `NDVI volatility is elevated and anomaly risk is ${Math.round(result.anomaly.score * 100)}%.`
      : `Field trend is ${trendText} with ${riskPct}% 7-day risk.`
  const why = result.anomaly.signals[0] || 'Signals across NDVI, weather, and moisture are within expected range.'
  const nextActions = result.recommendations[0]?.title || 'Continue baseline monitoring.'
  const recheckIn = result.anomaly.level === 'high' ? '24-48 hours' : '5-7 days'

  return { whatChanged, why, nextActions, recheckIn }
}

function toTasks(recommendations: MLInferenceResult['recommendations']): MLTask[] {
  return recommendations.map((item, index) => ({
    id: `task-${index + 1}-${item.id}`,
    title: item.title,
    impact: item.expectedImpact,
    confidence: item.confidence,
    timeWindow: item.timeWindow,
    owner: item.id.includes('irrigation') ? 'irrigation' : item.id.includes('zone') ? 'scouting' : 'operations',
  }))
}

export async function runMlInference(input: MLInput): Promise<MLInferenceResult> {
  const objective = normalizeObjective(input.objective)
  const featureVector = buildFeatureVector(input)
  const dataQuality = buildDataQuality(input)
  const forecast = forecastNdvi(input, featureVector)
  const anomaly = computeAnomalyScore(input, featureVector)
  const zones = { k: 3, clusters: computeZoneClusters(input, featureVector) }
  const recommendations = buildRecommendations(featureVector, objective, anomaly.score)

  const objectiveRisk = computeObjectiveRisk(featureVector, objective)
  const featureAgreement = 1 - Math.min(1, Math.abs(forecast.risk7d - anomaly.score))
  const confidence = clamp(dataQuality.score * 0.6 + featureAgreement * 0.25 + (1 - objectiveRisk) * 0.15, 0.2, 0.99)

  const baseResult: Omit<MLInferenceResult, 'summary'> = {
    engine: ML_ENGINE_VERSION,
    objective,
    confidence: Number(confidence.toFixed(4)),
    dataQuality,
    isSimulatedInputs: dataQuality.isSimulatedInputs,
    featureVector,
    forecast,
    anomaly,
    zones,
    recommendations,
    tasks: toTasks(recommendations),
    providersTried: Array.isArray(input.providersTried) ? input.providersTried : [],
    warnings: [...dataQuality.warnings],
  }

  const result: MLInferenceResult = {
    ...baseResult,
    summary: deriveSummary(baseResult),
  }

  // Fire-and-forget persistence to keep request latency tight.
  void persistModelHeartbeat()
  void persistInferenceFeedback({
    eventId: randomUUID(),
    result,
  })

  return result
}

export async function runMlChat(input: MLInput) {
  const inference = await runMlInference(input)
  const prompt = String(input.prompt || '')
  let chat = null
  try {
    chat = await composeLlmChatResponse({
      prompt,
      mode: input.mode,
      objective: input.objective,
      selectedCell: input.selectedCell || input?.context?.selectedCell || null,
      inference,
      history: input.history,
      context: input.context,
    })
  } catch {
    chat = null
  }

  if (!chat) {
    chat = composeChatResponse({
      prompt,
      inference,
      mode: input.mode,
      selectedCell: input.selectedCell || input?.context?.selectedCell || null,
      history: input.history,
    })
    chat.backend = 'deterministic'
  }

  return {
    inference,
    chat,
  }
}

export function runScenario(features: MLInferenceResult['featureVector'], scenario: ScenarioInput) {
  return runWhatIfSimulation(features, scenario)
}
