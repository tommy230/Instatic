import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { DbResult } from '../../../server/db'
import {
  activatePayloadPuckHandoff,
  PAYLOAD_PUCK_HANDOFF_DIR,
  preparePayloadPuckHandoff,
  type PayloadPuckExportFileOps,
} from '../../../server/publish/payloadPuckExport'
import { createFakeDb } from './dbTestFake'
import { makePage, makeSite } from '../publisher/helpers'
import type { MigrationNote } from '@core/page-tree'

const migrationNote: MigrationNote = {
  id: 'home-map', route: '/', target: { nodeId: 'map-node', selector: '#map' },
  gapType: 'map', status: 'blocked', missing: 'Interactive map.',
  reason: 'Provider cannot fetch private data URL.',
  source: { provider: 'Map provider', sourceUrl: 'https://source.example/', assetUrls: ['https://source.example/map.kml'] },
  prerequisites: [{ kind: 'production-hostname', detail: 'Public HTTPS data host.' }],
  recommendedPayloadPuckImplementation: 'Use a native map block with versioned GeoJSON.',
  evidence: [{ location: 'bundle/index.html:10' }],
  lastValidatedAt: '2026-09-04T17:34:53.076Z',
}

function parseObject(contents: string): Record<string, unknown> {
  const value: unknown = JSON.parse(contents)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected JSON object')
  }
  return value as Record<string, unknown>
}

function emptyMediaDb() {
  return createFakeDb(async (): Promise<DbResult> => ({ rows: [], rowCount: 0 }))
}

async function atomicTestWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${basename(path)}.test.tmp`)
  await writeFile(temporary, contents)
  await rename(temporary, path)
}

describe('Payload-Puck publish handoff', () => {
  let uploadsDir: string

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'payload-puck-handoff-'))
  })

  afterEach(async () => {
    await rm(uploadsDir, { recursive: true, force: true })
  })

  it('regenerates complete current content for page add, edit, and delete', async () => {
    const db = emptyMediaDb()
    const home = makePage({
      root: { moduleId: 'base.body', children: ['copy'] },
      copy: { moduleId: 'base.text', props: { text: 'Version one' } },
    })
    home.id = 'home'
    home.slug = 'index'
    home.title = 'Home'
    const about = makePage({ root: { moduleId: 'base.body', children: [] } })
    about.id = 'about'
    about.slug = 'about'
    about.title = 'About'

    const firstSite = makeSite({ pages: [home] })
    const first = await preparePayloadPuckHandoff(db, uploadsDir, 'snapshot-1', firstSite)
    await activatePayloadPuckHandoff(uploadsDir, first)

    const editedHome = structuredClone(home)
    editedHome.nodes.copy.props = { text: 'Version two' }
    const secondSite = makeSite({ pages: [editedHome, about] })
    const second = await preparePayloadPuckHandoff(db, uploadsDir, 'snapshot-2', secondSite)
    await activatePayloadPuckHandoff(uploadsDir, second)

    const thirdSite = makeSite({ pages: [about] })
    const third = await preparePayloadPuckHandoff(db, uploadsDir, 'snapshot-3', thirdSite)
    await activatePayloadPuckHandoff(uploadsDir, third)

    const root = join(uploadsDir, PAYLOAD_PUCK_HANDOFF_DIR)
    const current = parseObject(await readFile(join(root, 'current.json'), 'utf8'))
    expect(current.status).toBe('current')
    expect(current.snapshotId).toBe('snapshot-3')
    expect(current.contentHash).not.toBe(first.snapshot.contentHash)
    expect(current.contentHash).not.toBe(second.snapshot.contentHash)

    const pages = current.pages
    expect(Array.isArray(pages)).toBe(true)
    expect(pages).toHaveLength(1)
    expect(parseObject(JSON.stringify(pages![0])).id).toBe('about')

    const firstVersion = parseObject(await readFile(join(root, 'snapshots', 'snapshot-1.json'), 'utf8'))
    const secondVersion = parseObject(await readFile(join(root, 'snapshots', 'snapshot-2.json'), 'utf8'))
    expect(firstVersion.pages).toHaveLength(1)
    expect(secondVersion.pages).toHaveLength(2)
    expect(JSON.stringify(secondVersion)).toContain('Version two')
  })

  it('keeps current.json parseable while replacing it repeatedly', async () => {
    const db = emptyMediaDb()
    const site = makeSite({ pages: [] })
    const seed = await preparePayloadPuckHandoff(db, uploadsDir, 'atomic-seed', site)
    await activatePayloadPuckHandoff(uploadsDir, seed)
    const currentPath = join(uploadsDir, PAYLOAD_PUCK_HANDOFF_DIR, 'current.json')
    const errors: unknown[] = []

    const writer = async () => {
      for (let index = 0; index < 40; index++) {
        const prepared = await preparePayloadPuckHandoff(db, uploadsDir, `atomic-${index}`, site)
        await activatePayloadPuckHandoff(uploadsDir, prepared)
      }
    }
    const reader = async () => {
      for (let index = 0; index < 400; index++) {
        try {
          const current = parseObject(await readFile(currentPath, 'utf8'))
          if (current.status !== 'current') errors.push(current)
        } catch (err) {
          errors.push(err)
        }
      }
    }

    await Promise.all([writer(), reader()])
    expect(errors).toEqual([])
  })

  it('marks current stale and throws a retryable error when activation fails', async () => {
    const prepared = await preparePayloadPuckHandoff(
      emptyMediaDb(),
      uploadsDir,
      'failed-snapshot',
      makeSite({ pages: [] }),
    )
    let failedCurrentWrite = false
    const fileOps: PayloadPuckExportFileOps = {
      atomicWrite: async (path, contents) => {
        if (path.endsWith('current.json') && contents.includes('"status": "current"') && !failedCurrentWrite) {
          failedCurrentWrite = true
          throw new Error('simulated current activation failure')
        }
        await atomicTestWrite(path, contents)
      },
    }

    await expect(activatePayloadPuckHandoff(uploadsDir, prepared, fileOps))
      .rejects.toMatchObject({
        name: 'PayloadPuckExportError',
        stage: 'activate',
        staleMarked: true,
      })

    const root = join(uploadsDir, PAYLOAD_PUCK_HANDOFF_DIR)
    const current = parseObject(await readFile(
      join(root, 'current.json'),
      'utf8',
    ))
    expect(current.status).toBe('stale')
    expect(current.attemptedSnapshotId).toBe('failed-snapshot')
    expect(current.pages).toBeUndefined()
    expect(current.error).toContain('Retry publish')
    expect(await readFile(join(root, 'snapshots', 'failed-snapshot.json'), 'utf8'))
      .toBe(prepared.contents)
  })

  it('reports preparation errors without invalidating the prior published handoff', async () => {
    const site = makeSite({ pages: [] })
    const seed = await preparePayloadPuckHandoff(emptyMediaDb(), uploadsDir, 'valid-snapshot', site)
    await activatePayloadPuckHandoff(uploadsDir, seed)
    const missingMediaDb = createFakeDb(async (sql: string): Promise<DbResult> => {
      if (sql.includes('from media_assets')) {
        return {
          rows: [{
            id: 'missing-media', filename: 'missing.png', mime_type: 'image/png', size_bytes: 10,
            storage_path: 'missing.png', public_path: '/uploads/missing.png', uploaded_by_user_id: null,
            created_at: '2026-01-01T00:00:00.000Z', alt_text: '', caption: '', title: '',
            tags_json: [], width: null, height: null, duration_ms: null, dominant_color: null,
            deleted_at: null, replaced_at: null, blur_hash: null, variants_json: [],
            poster_path: null, storage_adapter_id: '', externally_hosted: false,
          }],
          rowCount: 1,
        }
      }
      return { rows: [], rowCount: 0 }
    })

    await expect(preparePayloadPuckHandoff(
      missingMediaDb,
      uploadsDir,
      'invalid-snapshot',
      site,
    )).rejects.toMatchObject({
      name: 'PayloadPuckExportError',
      stage: 'prepare',
      staleMarked: false,
    })

    const current = parseObject(await readFile(
      join(uploadsDir, PAYLOAD_PUCK_HANDOFF_DIR, 'current.json'),
      'utf8',
    ))
    expect(current.status).toBe('current')
    expect(current.snapshotId).toBe('valid-snapshot')
  })

  it('hashes local media and preserves Payload packet top-level compatibility', async () => {
    const bytes = Buffer.from('payload-puck-media')
    await writeFile(join(uploadsDir, 'hero.png'), bytes)
    const db = createFakeDb(async (sql: string): Promise<DbResult> => {
      if (sql.includes('from media_assets')) {
        return {
          rows: [{
            id: 'media-1', filename: 'hero.png', mime_type: 'image/png', size_bytes: bytes.length,
            storage_path: 'hero.png', public_path: '/uploads/hero.png', uploaded_by_user_id: null,
            created_at: '2026-01-01T00:00:00.000Z', alt_text: 'Hero', caption: '', title: '',
            tags_json: [], width: 1, height: 1, duration_ms: null, dominant_color: null,
            deleted_at: null, replaced_at: null, blur_hash: null, variants_json: [],
            poster_path: null, storage_adapter_id: '', externally_hosted: false,
          }],
          rowCount: 1,
        }
      }
      if (sql.includes('from media_asset_folders')) return { rows: [], rowCount: 0 }
      return { rows: [], rowCount: 0 }
    })
    const site = makeSite({ pages: [makePage({ root: { moduleId: 'base.body', children: [] } })] })
    site.settings.migrationNotes = [migrationNote]
    const prepared = await preparePayloadPuckHandoff(db, uploadsDir, 'media-snapshot', site)

    // Payload's packet loader reads staging fields directly and tolerates
    // extra envelope metadata. Matching the complete SiteDocument at the
    // top level keeps current.json usable as imported-site-staging.json.
    expect(prepared.snapshot).toMatchObject(site)
    expect(prepared.snapshot.schemaVersion).toBe(2)
    expect(prepared.snapshot.status).toBe('current')
    expect(prepared.snapshot.snapshotId).toBe('media-snapshot')
    expect(prepared.snapshot.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(prepared.snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(prepared.snapshot.siteContentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(prepared.snapshot.migrationNotes).toEqual([migrationNote])
    expect(prepared.snapshot.mediaManifest.assets[0]?.files[0]?.sha256).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    )
  })
})
