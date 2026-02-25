import type { MLFeatureVector, ScenarioInput, ScenarioResult } from './types'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function round(value: number, precision = 4) {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

export function runWhatIfSimulation(features: MLFeatureVector, scenario: ScenarioInput): ScenarioResult {
  const irrigationDelta = clamp(Number(scenario?.irrigationDelta || 0), -0.35, 0.6)
  const waterBudget = clamp(Number(scenario?.waterBudget || 0.5), 0, 1)
  const fertilizerDelta = clamp(Number(scenario?.fertilizerDelta || 0), -0.2, 0.3)
  const targetRisk = clamp(Number(scenario?.targetRisk || 0.35), 0.05, 0.95)

  const baselineRisk7d = clamp(
    features.moistureDeficitIndex * 0.45 +
      features.weatherStressIndex * 0.25 +
      Math.max(0, 0.42 - features.ndviMean) * 0.8,
    0,
    1
  )

  const moistureLift = irrigationDelta * 0.52 + waterBudget * 0.14
  const ndviLift = irrigationDelta * 0.1 + fertilizerDelta * 0.06 - features.dataLatencyPenalty * 0.02
  const scenarioNdvi30d = clamp(features.ndviMean + features.ndviDelta30 + ndviLift, -0.2, 0.95)
  const scenarioRisk7d = clamp(
    baselineRisk7d - moistureLift * 0.55 + Math.max(0, targetRisk - 0.55) * 0.05,
    0.02,
    0.98
  )

  const waterUseDeltaPct = round(irrigationDelta * 100, 1)
  const yieldProxyDeltaPct = round((scenarioNdvi30d - (features.ndviMean + features.ndviDelta30)) * 65, 1)

  const recommendation =
    scenarioRisk7d < baselineRisk7d
      ? 'Scenario reduces near-term risk; use as next irrigation schedule candidate.'
      : 'Scenario increases near-term risk; tighten water plan or reduce stress drivers.'

  const confidence = clamp(
    0.55 + (1 - features.dataLatencyPenalty) * 0.2 + (1 - Math.abs(irrigationDelta) * 0.2),
    0.35,
    0.92
  )

  return {
    baselineRisk7d: round(baselineRisk7d),
    scenarioRisk7d: round(scenarioRisk7d),
    baselineNdvi30d: round(features.ndviMean + features.ndviDelta30),
    scenarioNdvi30d: round(scenarioNdvi30d),
    waterUseDeltaPct,
    yieldProxyDeltaPct,
    recommendation,
    confidence: round(confidence),
  }
}
