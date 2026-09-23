import { Type, type Static } from '@core/utils/typeboxHelpers'
import { compiledCheck } from '@core/utils/typeboxCompiler'

export const MigrationGapTypeSchema = Type.Union([
  Type.Literal('map'),
  Type.Literal('form'),
  Type.Literal('embed'),
  Type.Literal('gated-script'),
  Type.Literal('unsupported-widget'),
  Type.Literal('other'),
])

export const MigrationGapStatusSchema = Type.Union([
  Type.Literal('missing'),
  Type.Literal('blocked'),
  Type.Literal('deferred'),
  Type.Literal('resolved'),
])

export const MigrationPrerequisiteKindSchema = Type.Union([
  Type.Literal('production-hostname'),
  Type.Literal('api-key'),
  Type.Literal('referrer-allowlist'),
  Type.Literal('csp-change'),
  Type.Literal('replacement-library'),
  Type.Literal('other'),
])

export const MigrationNoteSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  route: Type.String({ minLength: 1, pattern: '^/' }),
  target: Type.Object({
    nodeId: Type.Optional(Type.String({ minLength: 1 })),
    selector: Type.Optional(Type.String({ minLength: 1 })),
    text: Type.Optional(Type.String({ minLength: 1 })),
    section: Type.Optional(Type.String({ minLength: 1 })),
  }),
  gapType: MigrationGapTypeSchema,
  status: MigrationGapStatusSchema,
  missing: Type.String({ minLength: 1 }),
  reason: Type.String({ minLength: 1 }),
  source: Type.Object({
    provider: Type.String({ minLength: 1 }),
    sourceUrl: Type.String({ minLength: 1 }),
    providerUrl: Type.Optional(Type.String({ minLength: 1 })),
    assetUrls: Type.Array(Type.String({ minLength: 1 })),
  }),
  prerequisites: Type.Array(Type.Object({
    kind: MigrationPrerequisiteKindSchema,
    detail: Type.String({ minLength: 1 }),
  })),
  recommendedPayloadPuckImplementation: Type.String({ minLength: 1 }),
  evidence: Type.Array(Type.Object({
    location: Type.String({ minLength: 1 }),
    detail: Type.Optional(Type.String({ minLength: 1 })),
  }), { minItems: 1 }),
  lastValidatedAt: Type.String({ minLength: 1 }),
})

export const MigrationNotesSchema = Type.Array(MigrationNoteSchema)

export type MigrationNote = Static<typeof MigrationNoteSchema>

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function isMigrationNote(value: unknown): value is MigrationNote {
  if (!compiledCheck(MigrationNoteSchema, value)) return false
  const note = value as MigrationNote
  const hasTarget = Object.values(note.target).some((part) => typeof part === 'string' && part.length > 0)
  const urls = [note.source.sourceUrl, ...(note.source.providerUrl ? [note.source.providerUrl] : []), ...note.source.assetUrls]
  return hasTarget && urls.every(isHttpUrl) && !Number.isNaN(Date.parse(note.lastValidatedAt))
}

export function assertMigrationNotes(value: unknown): asserts value is MigrationNote[] {
  if (!Array.isArray(value)) throw new Error('Migration notes must be an array')
  const invalidIndex = value.findIndex((note) => !isMigrationNote(note))
  if (invalidIndex !== -1) throw new Error(`Migration note at index ${invalidIndex} is invalid`)
  const ids = value.map((note) => (note as MigrationNote).id)
  if (new Set(ids).size !== ids.length) throw new Error('Migration note IDs must be unique')
}

/** Tolerant persisted-settings parser. Invalid records never enter publish artifacts. */
export function parseMigrationNotes(value: unknown): MigrationNote[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const notes = value.filter((note): note is MigrationNote => {
    if (!isMigrationNote(note) || seen.has(note.id)) return false
    seen.add(note.id)
    return true
  })
  return notes.length > 0 ? notes : undefined
}
