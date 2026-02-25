import type { ChatIntent } from './types'

const INTENT_DOCS: Record<ChatIntent, string[]> = {
  irrigation: ['irrigation', 'water', 'moisture', 'drip', 'schedule', 'soil', 'stress', 'evapotranspiration', 'et'],
  stress: ['stress', 'ndvi', 'decline', 'canopy', 'health', 'yellow', 'wilt', 'anomaly', 'hotspot'],
  fertility: ['fertility', 'nutrient', 'nitrogen', 'phosphorus', 'potassium', 'soil test', 'deficiency'],
  'disease-risk': ['disease', 'fungal', 'blight', 'humidity', 'outbreak', 'pest', 'leaf spot'],
  forecast: ['forecast', 'next week', 'next month', 'trend', 'predict', 'projection', 'outlook'],
  actions: ['what should i do', 'next step', 'plan', 'action', 'recommendation', 'task list'],
  'what-if': ['what if', 'simulate', 'scenario', 'tradeoff', 'water budget', 'yield target'],
  general: ['overview', 'summary', 'status', 'field'],
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function termFrequency(tokens: string[]) {
  const tf: Record<string, number> = {}
  for (const token of tokens) tf[token] = (tf[token] || 0) + 1
  const total = tokens.length || 1
  Object.keys(tf).forEach((token) => {
    tf[token] = tf[token] / total
  })
  return tf
}

function buildIdf(corpus: string[][]) {
  const df: Record<string, number> = {}
  for (const doc of corpus) {
    const unique = new Set(doc)
    unique.forEach((token) => {
      df[token] = (df[token] || 0) + 1
    })
  }
  const docs = corpus.length
  const idf: Record<string, number> = {}
  Object.keys(df).forEach((token) => {
    idf[token] = Math.log((docs + 1) / ((df[token] || 0) + 1)) + 1
  })
  return idf
}

function tfidfVector(tokens: string[], idf: Record<string, number>) {
  const tf = termFrequency(tokens)
  const vector: Record<string, number> = {}
  Object.keys(tf).forEach((token) => {
    vector[token] = tf[token] * (idf[token] || 0)
  })
  return vector
}

function cosine(a: Record<string, number>, b: Record<string, number>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  let dot = 0
  let normA = 0
  let normB = 0
  keys.forEach((key) => {
    const av = a[key] || 0
    const bv = b[key] || 0
    dot += av * bv
    normA += av * av
    normB += bv * bv
  })
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom ? dot / denom : 0
}

export function classifyIntent(query: string): { intent: ChatIntent; confidence: number } {
  const inputTokens = tokenize(query)
  if (!inputTokens.length) return { intent: 'general', confidence: 0.3 }

  const docs = Object.values(INTENT_DOCS).map((tokens) => tokens)
  docs.push(inputTokens)
  const idf = buildIdf(docs)
  const inputVector = tfidfVector(inputTokens, idf)

  let bestIntent: ChatIntent = 'general'
  let bestScore = 0
  ;(Object.keys(INTENT_DOCS) as ChatIntent[]).forEach((intent) => {
    let score = cosine(inputVector, tfidfVector(INTENT_DOCS[intent], idf))
    const phrase = query.toLowerCase()
    if (intent === 'what-if' && (phrase.includes('what if') || phrase.includes('simulate') || phrase.includes('scenario'))) {
      score += 0.22
    }
    if (intent === 'actions' && (phrase.includes('what should i do') || phrase.includes('next actions'))) {
      score += 0.2
    }
    if (intent === 'irrigation' && (phrase.includes('water') || phrase.includes('irrigation'))) {
      score += 0.12
    }
    if (score > bestScore) {
      bestScore = score
      bestIntent = intent
    }
  })

  return {
    intent: bestIntent,
    confidence: Number(Math.max(0.2, Math.min(0.99, bestScore)).toFixed(3)),
  }
}
