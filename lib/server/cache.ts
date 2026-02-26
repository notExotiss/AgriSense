import { createHash } from 'crypto'

type CacheEntry<T> = {
  value: T
  expiresAt: number
}

type CacheStore = Map<string, CacheEntry<any>>

const globalCache = globalThis as typeof globalThis & {
  __agrisenseMemoryCache?: CacheStore
}

function getCacheStore() {
  if (!globalCache.__agrisenseMemoryCache) {
    globalCache.__agrisenseMemoryCache = new Map()
  }
  return globalCache.__agrisenseMemoryCache
}

export function makeCacheKey(parts: Array<string | number | boolean>) {
  return createHash('sha1').update(parts.join('|')).digest('hex')
}

export function readMemoryCache<T>(key: string): T | null {
  const store = getCacheStore()
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.value as T
}

export function writeMemoryCache<T>(key: string, value: T, ttlMs: number) {
  const store = getCacheStore()
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

export function clearMemoryCache(prefix?: string) {
  const store = getCacheStore()
  if (!prefix) {
    const cleared = store.size
    store.clear()
    return cleared
  }

  let cleared = 0
  const keysToDelete: string[] = []
  store.forEach((_, key) => {
    if (key.startsWith(prefix)) keysToDelete.push(key)
  })
  keysToDelete.forEach((key) => {
    if (store.delete(key)) cleared += 1
  })
  return cleared
}
