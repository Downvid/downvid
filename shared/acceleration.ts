export interface AccelerationSettings {
  enabled: boolean
  maxConnections: number
  aria2Path: string
}

export interface AccelerationStatus {
  found: boolean
  path: string | null
  version: string
  reason: string
}

export function normalizeAcceleration(value?: unknown): AccelerationSettings {
  const raw = value && typeof value === 'object' ? value as Partial<AccelerationSettings> : {}
  const count = Number(raw.maxConnections)
  return {
    enabled: raw.enabled !== false,
    maxConnections: Number.isFinite(count) ? Math.max(1, Math.min(16, Math.trunc(count))) : 8,
    aria2Path: typeof raw.aria2Path === 'string' ? raw.aria2Path.trim() : '',
  }
}

export function accelerationConnections(value?: unknown): number {
  const settings = normalizeAcceleration(value)
  return settings.enabled ? settings.maxConnections : 1
}
