import { createHash } from 'node:crypto'

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Stable SHA-256 for persisted publish/export content. */
export function canonicalContentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}
