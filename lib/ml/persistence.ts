import { getAdminDb } from '../firebaseAdmin'
import type { MLInferenceResult } from './types'

export const ML_ENGINE_VERSION = 'agrisense-ml-v1'

export async function persistModelHeartbeat() {
  try {
    const db = getAdminDb()
    await db.collection('ml_models').doc(ML_ENGINE_VERSION).set(
      {
        version: ML_ENGINE_VERSION,
        updatedAt: new Date().toISOString(),
        objectiveDefault: 'balanced',
      },
      { merge: true }
    )
  } catch {
    // Persistence is optional in environments without Firebase Admin.
  }
}

export async function persistInferenceFeedback(params: {
  plotId?: string
  eventId: string
  result: MLInferenceResult
  feedback?: 'accepted' | 'dismissed' | 'neutral'
}) {
  try {
    const db = getAdminDb()
    await db.collection('ml_feedback').doc(params.eventId).set({
      plotId: params.plotId || null,
      feedback: params.feedback || 'neutral',
      createdAt: new Date().toISOString(),
      engine: params.result.engine,
      objective: params.result.objective,
      confidence: params.result.confidence,
      dataQuality: params.result.dataQuality,
      anomaly: params.result.anomaly,
    })
  } catch {
    // Optional persistence path.
  }
}

