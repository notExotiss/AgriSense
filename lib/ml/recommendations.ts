import type { MLFeatureVector, MLRecommendation, Objective } from './types'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value))
}

function priority(score: number): 'high' | 'medium' | 'low' {
  if (score > 0.72) return 'high'
  if (score > 0.45) return 'medium'
  return 'low'
}

export function computeObjectiveRisk(features: MLFeatureVector, objective: Objective) {
  const weights =
    objective === 'yield'
      ? { ndvi: 1.0, water: 0.58, heat: 0.52, volatility: 0.42, momentum: 0.35 }
      : objective === 'water'
        ? { ndvi: 0.72, water: 1.08, heat: 0.44, volatility: 0.36, momentum: 0.32 }
        : { ndvi: 0.88, water: 0.88, heat: 0.5, volatility: 0.4, momentum: 0.34 }

  const ndviRisk = clamp((0.44 - features.ndviMean) * 3.2, 0, 1)
  const waterRisk = clamp(features.moistureDeficitIndex * 0.9 + (0.22 - features.soilMoistureMean) * 2.6, 0, 1)
  const heatRisk = clamp(features.weatherStressIndex * 0.8 + (features.temperature - 30) / 12, 0, 1)
  const volatilityRisk = clamp((features.ndviVolatility - 0.1) * 5, 0, 1)
  const momentumRisk = clamp((-features.ndviDelta7 * 2.2) + (-features.trendAcceleration * 1.6), 0, 1)

  const linear =
    ndviRisk * weights.ndvi +
    waterRisk * weights.water +
    heatRisk * weights.heat +
    volatilityRisk * weights.volatility +
    momentumRisk * weights.momentum -
    1.26

  return clamp(sigmoid(linear), 0, 1)
}

export function buildRecommendations(features: MLFeatureVector, objective: Objective, anomalyScore: number): MLRecommendation[] {
  const list: MLRecommendation[] = []
  const objectiveRisk = computeObjectiveRisk(features, objective)

  if (features.soilMoistureMean < 0.2 || objectiveRisk > 0.7) {
    list.push({
      id: 'irrigation-tighten',
      title: 'Tighten irrigation scheduling',
      priority: priority(Math.max(objectiveRisk, anomalyScore)),
      reason: 'Soil moisture trend indicates high water stress probability for the next cycle.',
      actions: [
        'Apply shorter, higher-frequency irrigation events for the next 72 hours.',
        'Inspect emitter uniformity in low-vigor zones.',
        'Re-check NDVI and soil moisture after two irrigation cycles.',
      ],
      expectedImpact: Number((8 + objectiveRisk * 12).toFixed(1)),
      confidence: Number((0.62 + (1 - anomalyScore) * 0.2).toFixed(3)),
      timeWindow: '24-72h',
      evidence: [
        `Moisture deficit index ${features.moistureDeficitIndex.toFixed(2)}`,
        `Objective risk ${Math.round(objectiveRisk * 100)}%`,
      ],
    })
  }

  if (features.ndviSpread > 0.38 || features.ndviVolatility > 0.12) {
    list.push({
      id: 'zone-scouting',
      title: 'Run targeted zone scouting',
      priority: priority(features.ndviSpread),
      reason: 'Canopy variability is elevated, which suggests non-uniform stress drivers.',
      actions: [
        'Scout low-vigor and transition zones first.',
        'Record pest pressure and irrigation delivery observations.',
        'Sample soil nutrients in two representative low-NDVI patches.',
      ],
      expectedImpact: Number((5 + features.ndviSpread * 15).toFixed(1)),
      confidence: Number((0.58 + (1 - features.ndviVolatility) * 0.22).toFixed(3)),
      timeWindow: '48h',
      evidence: [
        `NDVI spread ${features.ndviSpread.toFixed(2)}`,
        `NDVI volatility ${features.ndviVolatility.toFixed(2)}`,
      ],
    })
  }

  if (features.humidity > 82 && features.temperature > 24) {
    list.push({
      id: 'disease-watch',
      title: 'Increase disease surveillance',
      priority: priority(0.63),
      reason: 'Warm and humid conditions can increase disease pressure during canopy stress.',
      actions: [
        'Inspect for foliar disease symptoms in dense canopy sections.',
        'Prioritize morning scouting to detect early infection signs.',
        'Track humidity trend over the next 3 days before intervention.',
      ],
      expectedImpact: Number((4.5 + features.weatherStressIndex * 9).toFixed(1)),
      confidence: Number((0.56 + (1 - anomalyScore) * 0.18).toFixed(3)),
      timeWindow: '48-96h',
      evidence: [
        `Humidity ${features.humidity.toFixed(0)}%`,
        `Weather stress index ${features.weatherStressIndex.toFixed(2)}`,
      ],
    })
  }

  if (!list.length) {
    list.push({
      id: 'maintain-baseline',
      title: 'Maintain baseline operations',
      priority: 'low',
      reason: 'Current indicators show stable conditions with manageable risk.',
      actions: [
        'Continue standard irrigation schedule.',
        'Re-run analysis in 5-7 days for drift detection.',
        'Log field notes to improve future recommendation tuning.',
      ],
      expectedImpact: 2.8,
      confidence: 0.69,
      timeWindow: '5-7d',
      evidence: ['Risk profile within baseline thresholds.'],
    })
  }

  return list.slice(0, 4)
}
