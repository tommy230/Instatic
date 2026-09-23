import { describe, expect, it } from 'bun:test'
import { assertMigrationNotes, isMigrationNote, parseSiteSettings, type MigrationNote } from '@core/page-tree'

const note: MigrationNote = {
  id: 'home-map',
  route: '/',
  target: { nodeId: 'map-node', selector: '#map' },
  gapType: 'map',
  status: 'blocked',
  missing: 'Interactive map.',
  reason: 'Provider cannot fetch private data URL.',
  source: {
    provider: 'Map provider',
    sourceUrl: 'https://source.example/',
    providerUrl: 'https://maps.example/api.js',
    assetUrls: ['https://source.example/map.kml'],
  },
  prerequisites: [{ kind: 'production-hostname', detail: 'Public HTTPS data host.' }],
  recommendedPayloadPuckImplementation: 'Use a native map block with versioned GeoJSON.',
  evidence: [{ location: 'bundle/index.html:10' }],
  lastValidatedAt: '2026-09-04T17:34:53.076Z',
}

describe('migration notes', () => {
  it('validates and persists structured inert note data', () => {
    expect(isMigrationNote(note)).toBe(true)
    expect(() => assertMigrationNotes([note])).not.toThrow()
    expect(parseSiteSettings({ shortcuts: {}, migrationNotes: [note] }).migrationNotes).toEqual([note])
  })

  it('rejects missing targets, non-HTTP URLs, and invalid timestamps', () => {
    expect(isMigrationNote({ ...note, target: {} })).toBe(false)
    expect(isMigrationNote({ ...note, source: { ...note.source, assetUrls: ['javascript:alert(1)'] } })).toBe(false)
    expect(isMigrationNote({ ...note, lastValidatedAt: 'not-a-date' })).toBe(false)
    expect(() => assertMigrationNotes([note, note])).toThrow('Migration note IDs must be unique')
  })

  it('drops invalid persisted records instead of exporting them', () => {
    expect(parseSiteSettings({ shortcuts: {}, migrationNotes: [{ ...note, route: 'home' }] }).migrationNotes).toBeUndefined()
  })
})
