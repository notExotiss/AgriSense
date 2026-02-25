import type { ChatHistoryTurn, MLChatResponse, MLInferenceResult } from './types'
import { classifyIntent } from './intent'

type ChatComposeInput = {
  prompt: string
  inference: MLInferenceResult
  mode?: string
  selectedCell?: string | null
  history?: ChatHistoryTurn[]
}

type AskType = 'status' | 'why' | 'compare' | 'action' | 'forecast' | 'stress' | 'what-if'

function formatPct(value: number) {
  return `${Math.round(value * 100)}%`
}

function cellLabel(cellId?: string | null) {
  if (!cellId || !cellId.includes('-')) return null
  const [rowText, colText] = cellId.split('-')
  const row = Number(rowText)
  const col = Number(colText)
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null
  return `P${row * 3 + col + 1}`
}

function compactEvidence(inference: MLInferenceResult) {
  return [
    `NDVI mean ${inference.featureVector.ndviMean}`,
    `7-day delta ${inference.featureVector.ndviDelta7}`,
    `30-day delta ${inference.featureVector.ndviDelta30}`,
    `Risk 7d ${formatPct(inference.forecast.risk7d)}`,
    `Anomaly ${formatPct(inference.anomaly.score)}`,
    `Confidence ${formatPct(inference.confidence)}`,
  ]
}

function normalizeMode(mode?: string): AskType | null {
  if (!mode) return null
  if (mode === 'what-if-explainer') return 'what-if'
  if (mode === 'stress-debug') return 'stress'
  if (mode === 'next-actions' || mode === 'irrigation-plan') return 'action'
  if (mode === 'forecast') return 'forecast'
  return 'status'
}

function inferAskType(prompt: string, mode?: string): AskType {
  const forced = normalizeMode(mode)
  const text = prompt.toLowerCase()

  if (text.includes('what if') || text.includes('simulate') || text.includes('scenario')) return 'what-if'
  if (text.includes('forecast') || text.includes('next week') || text.includes('next month') || text.includes('outlook')) return 'forecast'
  if (text.includes('anomaly') || text.includes('stress') || text.includes('hotspot')) return 'stress'
  if (text.includes('why') || text.includes('reason') || text.includes('cause')) return 'why'
  if (text.includes('compare') || text.includes('difference') || text.includes('changed') || text.includes('versus')) return 'compare'
  if (text.includes('what should i do') || text.includes('next action') || text.includes('plan') || text.includes('should i')) return 'action'

  return forced || 'status'
}

function readCellFromText(text: string): string | null {
  const explicitPlotPoint = text.match(/\bp\s*([1-9])\b/i)
  if (explicitPlotPoint) {
    const index = Number(explicitPlotPoint[1]) - 1
    const row = Math.floor(index / 3)
    const col = index % 3
    return `${row}-${col}`
  }

  const explicitGridCell = text.match(/\b([0-2])\s*[-,:]\s*([0-2])\b/)
  if (explicitGridCell) {
    return `${explicitGridCell[1]}-${explicitGridCell[2]}`
  }

  return null
}

function needsCellClarifier(prompt: string) {
  const text = prompt.toLowerCase()
  const hasPronoun =
    text.includes('that cell') ||
    text.includes('this cell') ||
    text.includes('same cell') ||
    text.includes('that zone') ||
    text.includes('this zone') ||
    text.includes('that one') ||
    text.includes('this one')
  return hasPronoun && !readCellFromText(prompt)
}

function resolveCellContext(
  prompt: string,
  selectedCell?: string | null,
  history?: ChatHistoryTurn[]
): { cellId: string | null; usedHistory: boolean } {
  const fromPrompt = readCellFromText(prompt)
  if (fromPrompt) return { cellId: fromPrompt, usedHistory: false }
  if (selectedCell) return { cellId: selectedCell, usedHistory: false }

  const recent = Array.isArray(history) ? [...history].reverse() : []
  for (const turn of recent) {
    const found = readCellFromText(turn.text || '')
    if (found) return { cellId: found, usedHistory: true }
  }

  return { cellId: null, usedHistory: false }
}

function summarizeDataQuality(inference: MLInferenceResult) {
  return inference.dataQuality.completeness < 0.65
    ? 'Data coverage is partial, so recommendations are intentionally conservative.'
    : 'Data coverage is strong enough for tactical field decisions.'
}

function primaryActions(inference: MLInferenceResult) {
  const top = inference.recommendations[0]
  return (top?.actions || []).slice(0, 3)
}

function buildQuestionFirstResponse(
  askType: AskType,
  inference: MLInferenceResult,
  cellId: string | null,
  prompt: string
): {
  answer: string
  sections?: { rationale?: string; actions?: string[]; forecast?: string }
  renderModel: 'qa' | 'status' | 'what-if'
  mode: MLChatResponse['mode']
} {
  const plotPoint = cellLabel(cellId)
  const risk7 = formatPct(inference.forecast.risk7d)
  const risk30 = formatPct(inference.forecast.risk30d)
  const anomaly = formatPct(inference.anomaly.score)

  if (askType === 'what-if') {
    return {
      answer: `Use a small scenario first: irrigation +10% with target risk <= 35%. Then compare NDVI30 and water-use deltas before scaling across the full field${plotPoint ? `, starting with ${plotPoint}` : ''}.`,
      sections: {
        rationale: `Current baseline risk is ${risk7} over 7 days with ${inference.forecast.trend} trend, so moderate adjustments are safer than large jumps.`,
        actions: [
          'Run a +10% irrigation scenario.',
          'Compare baseline vs scenario NDVI30 and risk7.',
          'If risk drops without excess water cost, expand to adjacent plot points.',
        ],
        forecast: `Baseline: risk7 ${risk7}, risk30 ${risk30}, trend ${inference.forecast.trend}.`,
      },
      renderModel: 'what-if',
      mode: 'what-if-explainer',
    }
  }

  if (askType === 'forecast') {
    return {
      answer: `The near-term outlook is ${inference.forecast.trend}. Expected NDVI is ${inference.forecast.ndvi7d} in 7 days and ${inference.forecast.ndvi30d} in 30 days, with risk at ${risk7} / ${risk30}.`,
      sections: {
        rationale: `Anomaly signal is ${anomaly}, which indicates ${inference.anomaly.level} instability right now.`,
        actions: primaryActions(inference),
        forecast: `Trend: ${inference.forecast.trend}; NDVI7: ${inference.forecast.ndvi7d}; NDVI30: ${inference.forecast.ndvi30d}.`,
      },
      renderModel: 'qa',
      mode: 'forecast',
    }
  }

  if (askType === 'stress' || askType === 'why') {
    const focus = plotPoint ? ` for ${plotPoint}` : ''
    return {
      answer: `The main stress driver${focus} is ${inference.anomaly.signals[0] || 'a combined NDVI/moisture anomaly'} with anomaly score ${anomaly}.`,
      sections: {
        rationale: inference.summary.why,
        actions: primaryActions(inference),
        forecast: `Risk over 7 days is ${risk7}. Re-check window: ${inference.summary.recheckIn}.`,
      },
      renderModel: 'qa',
      mode: 'stress-debug',
    }
  }

  if (askType === 'compare') {
    return {
      answer: `Compared with the recent baseline, field risk is ${risk7} over 7 days and the trend is ${inference.forecast.trend}. NDVI deltas are ${inference.featureVector.ndviDelta7} (7d) and ${inference.featureVector.ndviDelta30} (30d).`,
      sections: {
        rationale: inference.summary.whatChanged,
        actions: primaryActions(inference),
        forecast: `Anomaly: ${anomaly}; confidence: ${formatPct(inference.confidence)}.`,
      },
      renderModel: 'qa',
      mode: 'status',
    }
  }

  if (askType === 'action') {
    const focus = plotPoint ? ` prioritizing ${plotPoint}` : ''
    return {
      answer: `Start with targeted scouting and irrigation checks${focus}, then re-run analysis after the next intervention cycle.`,
      sections: {
        rationale: inference.summary.why,
        actions: primaryActions(inference),
        forecast: `Current risk: ${risk7}; confidence: ${formatPct(inference.confidence)}.`,
      },
      renderModel: 'qa',
      mode: 'next-actions',
    }
  }

  return {
    answer: `Current status: trend is ${inference.forecast.trend} with ${risk7} 7-day risk${plotPoint ? ` at focus ${plotPoint}` : ''}.`,
    sections: {
      rationale: inference.summary.whatChanged,
      actions: primaryActions(inference),
      forecast: `Anomaly ${anomaly}; NDVI7 ${inference.forecast.ndvi7d}; NDVI30 ${inference.forecast.ndvi30d}.`,
    },
    renderModel: 'status',
    mode: 'status',
  }
}

function toLegacyText(payload: {
  answer: string
  sections?: { rationale?: string; actions?: string[]; forecast?: string }
  evidence: string[]
  dataNote: string
}) {
  const lines: string[] = [payload.answer]
  if (payload.sections?.rationale) lines.push(`Why: ${payload.sections.rationale}`)
  if (payload.sections?.actions?.length) {
    lines.push(`Actions:\n${payload.sections.actions.map((action, index) => `${index + 1}. ${action}`).join('\n')}`)
  }
  if (payload.sections?.forecast) lines.push(`Forecast: ${payload.sections.forecast}`)
  lines.push(`Data note: ${payload.dataNote}`)
  lines.push(`Evidence:\n- ${payload.evidence.join('\n- ')}`)
  return lines.join('\n\n')
}

export function composeChatResponse(input: ChatComposeInput): MLChatResponse {
  const prompt = String(input.prompt || '').trim()
  const classification = classifyIntent(prompt)
  const inference = input.inference
  const askType = inferAskType(prompt, input.mode)
  const { cellId, usedHistory } = resolveCellContext(prompt, input.selectedCell, input.history)

  if (needsCellClarifier(prompt) && !cellId) {
    const answer = 'I can answer that precisely once you pick a plot point (P1-P9) or mention a specific cell like 1-2.'
    const evidence = compactEvidence(inference).slice(0, 4)
    const dataNote = summarizeDataQuality(inference)
    return {
      mode: 'status',
      renderModel: 'qa',
      intent: classification.intent,
      intentConfidence: classification.confidence,
      usedHistory,
      answer,
      sections: {
        actions: ['Select a plot point on the 3x3 grid.', 'Ask again with that point in scope.'],
      },
      evidence,
      tasks: inference.tasks.slice(0, 3),
      text: toLegacyText({
        answer,
        sections: {
          actions: ['Select a plot point on the 3x3 grid.', 'Ask again with that point in scope.'],
        },
        evidence,
        dataNote,
      }),
    }
  }

  const result = buildQuestionFirstResponse(askType, inference, cellId, prompt)
  const evidence = compactEvidence(inference).slice(0, 5)
  const dataNote = summarizeDataQuality(inference)

  return {
    mode: result.mode,
    renderModel: result.renderModel,
    intent: classification.intent,
    intentConfidence: classification.confidence,
    usedHistory,
    answer: result.answer,
    sections: result.sections,
    evidence,
    tasks: inference.tasks.slice(0, 4),
    text: toLegacyText({
      answer: result.answer,
      sections: result.sections,
      evidence,
      dataNote,
    }),
  }
}
