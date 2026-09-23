import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { nanoid } from 'nanoid'
import type { MigrationNote, SiteDocument } from '@core/page-tree'
import type { DbClient } from '../db/client'
import { listMediaAssetsForExport } from '../repositories/media'
import { assertPathWithin } from '../util/pathWithin'
import { canonicalContentHash } from '../util/contentHash'

export const PAYLOAD_PUCK_HANDOFF_SCHEMA_VERSION = 2
export const PAYLOAD_PUCK_HANDOFF_DIR = 'payload-puck-handoff'

interface PayloadPuckMediaFile {
  role: 'original' | 'variant' | 'poster'
  publicPath: string
  storagePath: string | null
  sha256: string | null
  sizeBytes: number | null
  width?: number
  height?: number
  format?: string
}

interface PayloadPuckMediaEntry {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  publicPath: string
  uploadedByUserId: string | null
  createdAt: string
  altText: string
  caption: string
  title: string
  tags: string[]
  width: number | null
  height: number | null
  durationMs: number | null
  dominantColor: string | null
  deletedAt: string | null
  replacedAt: string | null
  blurHash: string | null
  posterPath: string | null
  folderIds: string[]
  storageAdapterId: string
  externallyHosted: boolean
  files: PayloadPuckMediaFile[]
}

export type PayloadPuckHandoffSnapshot = SiteDocument & {
  schemaVersion: typeof PAYLOAD_PUCK_HANDOFF_SCHEMA_VERSION
  status: 'current'
  snapshotId: string
  contentHash: string
  siteContentHash: string
  generatedAt: string
  mediaManifest: {
    schemaVersion: 1
    assets: PayloadPuckMediaEntry[]
  }
  migrationNotes: MigrationNote[]
}

export interface PreparedPayloadPuckHandoff {
  snapshot: PayloadPuckHandoffSnapshot
  contents: string
}

interface StalePayloadPuckHandoff {
  schemaVersion: typeof PAYLOAD_PUCK_HANDOFF_SCHEMA_VERSION
  status: 'stale'
  attemptedSnapshotId: string
  attemptedContentHash: string
  failedAt: string
  error: string
}

export interface PayloadPuckExportFileOps {
  atomicWrite(path: string, contents: string): Promise<void>
}

const defaultFileOps: PayloadPuckExportFileOps = {
  atomicWrite: atomicWriteFile,
}

export class PayloadPuckExportError extends Error {
  readonly stage: 'prepare' | 'activate'
  readonly staleMarked: boolean

  constructor(stage: 'prepare' | 'activate', staleMarked: boolean, cause: unknown) {
    super(
      stage === 'prepare'
        ? 'Payload-Puck handoff export could not be prepared, so the site was not published. Existing current.json remains valid; fix the reported media or filesystem error and retry publish.'
        : staleMarked
          ? 'Payload-Puck handoff export failed after the site snapshot was published. current.json is marked stale; retry publish.'
          : 'Payload-Puck handoff export failed after the site snapshot was published, and current.json could not be marked stale. Retry publish and inspect server logs.',
      { cause },
    )
    this.name = 'PayloadPuckExportError'
    this.stage = stage
    this.staleMarked = staleMarked
  }
}

async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function localStoragePath(uploadsDir: string, storagePath: string): string {
  const path = join(uploadsDir, storagePath)
  assertPathWithin(uploadsDir, path)
  return path
}

async function mediaFile(
  uploadsDir: string,
  input: Omit<PayloadPuckMediaFile, 'sha256'> & { local: boolean },
): Promise<PayloadPuckMediaFile> {
  const { local, ...file } = input
  return {
    ...file,
    sha256: local && file.storagePath
      ? await sha256File(localStoragePath(uploadsDir, file.storagePath))
      : null,
  }
}

function storagePathFromPublicPath(publicPath: string): string | null {
  return publicPath.startsWith('/uploads/') ? publicPath.slice('/uploads/'.length) : null
}

async function buildMediaEntry(
  uploadsDir: string,
  asset: Awaited<ReturnType<typeof listMediaAssetsForExport>>[number],
): Promise<PayloadPuckMediaEntry> {
  const originalIsLocal = asset.storageAdapterId === '' && !asset.externallyHosted
  const files: PayloadPuckMediaFile[] = [await mediaFile(uploadsDir, {
    role: 'original',
    publicPath: asset.publicPath,
    storagePath: originalIsLocal ? asset.storagePath : null,
    sizeBytes: asset.sizeBytes,
    local: originalIsLocal,
  })]

  for (const variant of asset.variants) {
    const local = variant.storageAdapterId === ''
    files.push(await mediaFile(uploadsDir, {
      role: 'variant',
      publicPath: variant.path,
      storagePath: local ? variant.storagePath : null,
      sizeBytes: variant.sizeBytes,
      width: variant.width,
      height: variant.height,
      format: variant.format,
      local,
    }))
  }

  if (asset.posterPath) {
    const posterStoragePath = storagePathFromPublicPath(asset.posterPath)
    const local = asset.storageAdapterId === '' && !asset.externallyHosted && posterStoragePath !== null
    files.push(await mediaFile(uploadsDir, {
      role: 'poster',
      publicPath: asset.posterPath,
      storagePath: local ? posterStoragePath : null,
      sizeBytes: null,
      local,
    }))
  }

  return {
    id: asset.id,
    filename: asset.filename,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    publicPath: asset.publicPath,
    uploadedByUserId: asset.uploadedByUserId,
    createdAt: asset.createdAt,
    altText: asset.altText,
    caption: asset.caption,
    title: asset.title,
    tags: asset.tags.toSorted(),
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    dominantColor: asset.dominantColor,
    deletedAt: asset.deletedAt,
    replacedAt: asset.replacedAt,
    blurHash: asset.blurHash,
    posterPath: asset.posterPath,
    folderIds: asset.folderIds.toSorted(),
    storageAdapterId: asset.storageAdapterId,
    externallyHosted: asset.externallyHosted,
    files,
  }
}

/** Build and hash complete handoff before committing DB publish state. */
export async function preparePayloadPuckHandoff(
  db: DbClient,
  uploadsDir: string,
  siteSnapshotId: string,
  site: SiteDocument,
  generatedAt = new Date().toISOString(),
): Promise<PreparedPayloadPuckHandoff> {
  try {
    const rows = await listMediaAssetsForExport(db)
    const assets: PayloadPuckMediaEntry[] = []
    for (const row of rows) assets.push(await buildMediaEntry(uploadsDir, row))

    const mediaManifest = { schemaVersion: 1 as const, assets }
    const migrationNotes = site.settings.migrationNotes ?? []
    const contentHash = canonicalContentHash({ site, mediaManifest, migrationNotes })
    const snapshot: PayloadPuckHandoffSnapshot = {
      ...site,
      schemaVersion: PAYLOAD_PUCK_HANDOFF_SCHEMA_VERSION,
      status: 'current',
      snapshotId: siteSnapshotId,
      contentHash,
      siteContentHash: canonicalContentHash(site),
      generatedAt,
      mediaManifest,
      migrationNotes,
    }
    return { snapshot, contents: `${JSON.stringify(snapshot, null, 2)}\n` }
  } catch (err) {
    throw new PayloadPuckExportError('prepare', false, err)
  }
}

/**
 * Persist immutable version first, then atomically replace stable current.json.
 * On failure after DB commit, replace current.json with a machine-readable stale
 * marker so consumers cannot mistake an older handoff for current content.
 */
export async function activatePayloadPuckHandoff(
  uploadsDir: string,
  prepared: PreparedPayloadPuckHandoff,
  fileOps: PayloadPuckExportFileOps = defaultFileOps,
): Promise<void> {
  const root = join(uploadsDir, PAYLOAD_PUCK_HANDOFF_DIR)
  const snapshotPath = join(root, 'snapshots', `${prepared.snapshot.snapshotId}.json`)
  const currentPath = join(root, 'current.json')
  try {
    await fileOps.atomicWrite(snapshotPath, prepared.contents)
    await fileOps.atomicWrite(currentPath, prepared.contents)
  } catch (err) {
    const stale: StalePayloadPuckHandoff = {
      schemaVersion: PAYLOAD_PUCK_HANDOFF_SCHEMA_VERSION,
      status: 'stale',
      attemptedSnapshotId: prepared.snapshot.snapshotId,
      attemptedContentHash: prepared.snapshot.contentHash,
      failedAt: new Date().toISOString(),
      error: 'Latest publish did not finish writing the Payload-Puck handoff. Retry publish.',
    }
    try {
      await fileOps.atomicWrite(currentPath, `${JSON.stringify(stale, null, 2)}\n`)
      throw new PayloadPuckExportError('activate', true, err)
    } catch (staleErr) {
      if (staleErr instanceof PayloadPuckExportError) throw staleErr
      throw new PayloadPuckExportError('activate', false, new AggregateError([err, staleErr]))
    }
  }
}

async function atomicWriteFile(path: string, contents: string): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `.${basename(path)}.${process.pid}.${nanoid()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporary, path)
  } catch (err) {
    await handle?.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
    throw err
  }
}
