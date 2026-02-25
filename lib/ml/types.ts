import type { ProviderDiagnostic } from '../types/api'

export type Objective = 'balanced' | 'yield' | 'water'

export type ChatIntent = 'irrigation' | 'stress' | 'fertility' | 'disease-risk' | 'forecast' | 'actions' | 'what-if' | 'general'

export type ChatHistoryTurn = {
  role: 'user' | 'assistant'
  text: string
}

export type DataQualityReport = {
  completeness: number
  providerQuality: number
  score: number
  isSimulatedInputs: boolean
  warnings: string[]
}

export type MLFeatureVector = {
  ndviMin: number
  ndviMax: number
  ndviMean: number
  ndviSpread: number
  ndviDelta7: number
  ndviDelta30: number
  ndviTrendSlope: number
  trendAcceleration: number
  ndviVolatility: number
  soilMoistureMean: number
  moistureDeficitIndex: number
  etMean: number
  weatherStressIndex: number
  temperature: number
  precipitation: number
  humidity: number
  seasonalIndex: number
  shortTermMomentum: number
  dataLatencyPenalty: number
}

export type ZoneCluster = {
  id: number
  count: number
  centroid: number[]
}

export type MLRecommendation = {
  id: string
  title: string
  priority: 'high' | 'medium' | 'low'
  reason: string
  actions: string[]
  expectedImpact: number
  confidence: number
  timeWindow: string
  evidence: string[]
}

export type MLTask = {
  id: string
  title: string
  impact: number
  confidence: number
  timeWindow: string
  owner: 'irrigation' | 'scouting' | 'operations'
}

export type ScenarioInput = {
  irrigationDelta: number
  waterBudget: number
  targetRisk?: number
  fertilizerDelta?: number
}

export type ScenarioResult = {
  baselineRisk7d: number
  scenarioRisk7d: number
  baselineNdvi30d: number
  scenarioNdvi30d: number
  waterUseDeltaPct: number
  yieldProxyDeltaPct: number
  recommendation: string
  confidence: number
}

export type MLInferenceResult = {
  engine: string
  objective: Objective
  confidence: number
  dataQuality: DataQualityReport
  isSimulatedInputs: boolean
  featureVector: MLFeatureVector
  forecast: {
    ndvi7d: number
    ndvi30d: number
    risk7d: number
    risk30d: number
    trend: 'improving' | 'declining' | 'stable'
  }
  anomaly: {
    score: number
    level: 'low' | 'moderate' | 'high'
    signals: string[]
  }
  zones: {
    k: number
    clusters: ZoneCluster[]
  }
  recommendations: MLRecommendation[]
  tasks: MLTask[]
  summary: {
    whatChanged: string
    why: string
    nextActions: string
    recheckIn: string
  }
  providersTried: ProviderDiagnostic[]
  warnings: string[]
}

export type MLChatResponse = {
  mode: 'status' | 'irrigation-plan' | 'stress-debug' | 'forecast' | 'next-actions' | 'what-if-explainer'
  renderModel: 'qa' | 'status' | 'what-if'
  backend?: 'llm-gemini' | 'deterministic'
  intent: ChatIntent
  intentConfidence: number
  usedHistory: boolean
  answer: string
  sections?: {
    rationale?: string
    actions?: string[]
    forecast?: string
  }
  evidence: string[]
  tasks: MLTask[]
  text: string
  llmAttemptedModels?: string[]
  llmFinalModel?: string | null
  llmRetries?: number
  llmDegraded?: boolean
}

export type MLInput = {
  prompt?: string
  analysisType?: string
  mode?: 'status' | 'irrigation-plan' | 'stress-debug' | 'forecast' | 'next-actions' | 'what-if-explainer'
  objective?: Objective
  ndviData?: any
  weatherData?: any
  soilData?: any
  etData?: any
  timeSeriesData?: any
  context?: any
  providersTried?: ProviderDiagnostic[]
  selectedCell?: string | null
  scenario?: ScenarioInput
  history?: ChatHistoryTurn[]
}
