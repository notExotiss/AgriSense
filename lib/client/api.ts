import type { GridCellSummary, PlotItem } from '../types/api'

export class ApiClientError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'ApiClientError'
    this.code = code
    this.status = status
  }
}

async function parseJson(response: Response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const payload = await parseJson(response)
  if (!response.ok) {
    throw new ApiClientError(payload?.message || payload?.error || `Request failed (${response.status})`, payload?.error || 'request_failed', response.status)
  }
  return payload as T
}

export function mapSaveError(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Network issue. Check connection and retry.'
  if (error.code === 'invalid_auth') return 'Authentication token is invalid or expired. Sign in again and retry.'
  if (error.status === 401) return 'Sign-in expired. Please sign in again.'
  if (error.status === 403) return 'You do not have access to this plot.'
  if (error.status === 408) return 'Request timed out. Retry in a few seconds.'
  if (error.status === 413 || error.code === 'plot_payload_too_large') {
    return 'Plot snapshot is too large to save. Re-run analysis and retry.'
  }
  if (error.code === 'invalid_geometry') return 'Selected area geometry is invalid. Redraw the AOI and retry.'
  if (error.code === 'invalid_payload') return 'Plot payload contains unsupported values.'
  if (error.status === 503 || error.code === 'firebase_admin_misconfigured') {
    return 'Server save service is misconfigured. Check Firebase Admin credentials.'
  }
  if (error.code === 'validation_failed') return 'Some required fields are missing.'
  return error.message || 'Save failed. Please retry.'
}

export async function fetchPlots(token: string): Promise<PlotItem[]> {
  const payload = await requestJson<{ items?: PlotItem[] }>('/api/items', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  return Array.isArray(payload.items) ? payload.items : []
}

export async function savePlot(
  token: string,
  body: {
    name: string
    locationName?: string
    description?: string
    ndviStats?: { min: number; max: number; mean: number } | null
    previewPng?: string | null
    geojson?: any
    bbox?: [number, number, number, number]
    grid3x3?: GridCellSummary[]
    inferenceSnapshot?: any
    sourceQuality?: any
  }
): Promise<{ id: string }> {
  return await requestJson<{ id: string }>('/api/items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}

export async function deletePlot(token: string, id: string): Promise<void> {
  await requestJson<void>(`/api/plots/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}
