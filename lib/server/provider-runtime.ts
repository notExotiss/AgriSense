type ProviderState = {
  failures: number
  cooldownUntil: number
}

type RuntimeStore = Record<string, ProviderState>

const globalStore = globalThis as typeof globalThis & {
  __agrisenseProviderRuntime?: RuntimeStore
}

function getStore(): RuntimeStore {
  if (!globalStore.__agrisenseProviderRuntime) {
    globalStore.__agrisenseProviderRuntime = {}
  }
  return globalStore.__agrisenseProviderRuntime
}

export function shouldSkipProvider(provider: string) {
  const store = getStore()
  const state = store[provider]
  if (!state) return false
  return Date.now() < state.cooldownUntil
}

export function markProviderSuccess(provider: string) {
  const store = getStore()
  store[provider] = {
    failures: 0,
    cooldownUntil: 0,
  }
}

export function markProviderFailure(provider: string, options?: { threshold?: number; cooldownMs?: number }) {
  const threshold = options?.threshold ?? 3
  const cooldownMs = options?.cooldownMs ?? 120000
  const store = getStore()
  const prev = store[provider] || { failures: 0, cooldownUntil: 0 }
  const failures = prev.failures + 1
  const shouldCooldown = failures >= threshold
  store[provider] = {
    failures: shouldCooldown ? 0 : failures,
    cooldownUntil: shouldCooldown ? Date.now() + cooldownMs : 0,
  }
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 12000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchJsonWithRetry(
  url: string,
  init: RequestInit = {},
  options?: { retries?: number; timeoutMs?: number; retryOnStatus?: number[] }
) {
  const retries = options?.retries ?? 1
  const timeoutMs = options?.timeoutMs ?? 12000
  const retryOn = new Set(options?.retryOnStatus || [408, 425, 429, 500, 502, 503, 504])

  let lastError: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs)
      if (!response.ok) {
        if (attempt < retries && retryOn.has(response.status)) {
          await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)))
          continue
        }
        const text = await response.text().catch(() => '')
        const error = new Error(`http_${response.status}:${text.slice(0, 200)}`)
        ;(error as any).status = response.status
        throw error
      }
      return await response.json()
    } catch (error: any) {
      lastError = error
      const isAbort = String(error?.name || '').toLowerCase() === 'aborterror'
      if (attempt < retries && isAbort) {
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)))
        continue
      }
      if (attempt < retries && String(error?.message || '').startsWith('http_5')) {
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)))
        continue
      }
      break
    }
  }
  throw lastError instanceof Error ? lastError : new Error('fetch_failed')
}

