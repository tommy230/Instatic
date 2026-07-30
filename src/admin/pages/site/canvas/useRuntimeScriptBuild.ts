/**
 * useRuntimeScriptBuild — owns the bundled runtime scripts injected into the
 * editable canvas iframes when the "Run scripts" toggle is on.
 *
 * Unlike the old preview surface (which built a full static HTML document and
 * dropped it into a sandboxed `srcDoc` iframe), the editable canvas frames are
 * React-rendered, same-origin iframes. So we don't want a whole document — we
 * only want the runtime script contents, which we inject as inline
 * `<script>` tags alongside the live node tree with the configured loader
 * format (see
 * `RuntimeScriptInjector`).
 *
 * Build trigger contract:
 * - Enabled only while the "Run scripts" toggle is on (`enabled`).
 * - Rebuilds when the script bundle's inputs change — the page being viewed,
 *   the active breakpoint, the template context, and anything that affects the
 *   bundle (`site.files` / `site.runtime` / `site.packageJson`). Crucially it
 *   does NOT rebuild on ordinary node-tree edits: those don't touch the script
 *   inputs, so the bundle signature stays stable and scripts are not re-run on
 *   every keystroke.
 * - The signature is derived from a cheap structural digest of `site.files`
 *   (see `digestSiteFiles`), memoized on the files reference, never from the
 *   file contents themselves — a real store carries tens of MB of content and
 *   serializing it per render is not affordable.
 * - Also rebuilds on an explicit Refresh (the user's escape hatch for when a
 *   React reconcile clobbered script-mutated DOM).
 *
 * The 350ms debounce coalesces rapid edits (e.g. agent tool batches).
 */

import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import type { Page } from '@core/page-tree'
import type { SiteFile } from '@core/files/schemas'
import type { TemplateRenderDataContext } from '@core/templates/dynamicBindings'
import { useEditorStore } from '@site/store/store'
import {
  buildCmsRuntimePreview,
  type CmsRuntimePreviewResult,
} from '@core/persistence'
import type { SiteRuntimeDiagnostic, SiteScriptFormat, SiteScriptPlacement } from '@core/site-runtime'
import { getErrorMessage } from '@core/utils/errorMessage'

export type RuntimeScriptStatus = 'idle' | 'building' | 'ready' | 'error'

/**
 * One runtime entry ready to inject inline. Module entries are bundled and
 * self-contained; classic entries are raw browser-global scripts.
 */
export interface InjectableRuntimeScript {
  id: string
  format: SiteScriptFormat
  placement: SiteScriptPlacement
  content: string
}

interface RuntimeScriptBuildState {
  /** Bundled scripts to inject, ordered by priority. Empty until first build. */
  scripts: InjectableRuntimeScript[]
  /** Build lifecycle status. */
  status: RuntimeScriptStatus
  /** Diagnostics surfaced by the server build (esbuild errors, etc.). */
  diagnostics: SiteRuntimeDiagnostic[]
  /** Force a rebuild + re-run from current site state. */
  refresh: () => void
}

interface UseRuntimeScriptBuildArgs {
  page: Page | null
  breakpointId: string
  templateContext?: TemplateRenderDataContext
  /** Gates the effect — pass `false` when the "Run scripts" toggle is off. */
  enabled: boolean
  /** Defaults to the production debounce; tests pass 0 to avoid real-time waits. */
  debounceMs?: number
}

interface BuildResult {
  signature: string
  scripts: InjectableRuntimeScript[]
  diagnostics: SiteRuntimeDiagnostic[]
  status: 'ready' | 'error'
}

/**
 * Map a completed preview build into the inline-injectable entry scripts.
 * `runtimeAssets.scripts` is already priority-ordered; each entry's `src`
 * matches an asset's `publicPath`, whose `content` is the standalone bundle.
 */
function extractInjectableScripts(result: CmsRuntimePreviewResult): InjectableRuntimeScript[] {
  const assetByPublicPath = new Map(result.assets.map((asset) => [asset.publicPath, asset]))
  return result.runtimeAssets.scripts
    .map((script) => {
      const asset = assetByPublicPath.get(script.src)
      if (!asset) return null
      return {
        id: script.fileId,
        format: script.format ?? 'module',
        placement: script.placement,
        content: asset.content,
      }
    })
    .filter((entry): entry is InjectableRuntimeScript => entry !== null)
}

/**
 * How many characters are sampled out of each file's `content` when digesting.
 * Evenly spaced across the string, so a same-length edit almost always moves at
 * least one sample. Constant work per file regardless of content size.
 */
const CONTENT_SAMPLE_POINTS = 16

/**
 * Cheap structural digest of `site.files`.
 *
 * Serializing the files array itself is not viable: the largest real store
 * (18,905 files / 32.3 MB of content) turns every digest into a 32 MB
 * `JSON.stringify`. `SiteFile` carries no content hash or version field — the
 * available fields are `id`, `path`, `type`, `content`, `blob`, `generated`,
 * `ejected`, `createdAt` and `updatedAt` — so we fold the cheap identifying
 * ones plus `updatedAt` (stamped by every `filesSlice` write boundary), the
 * payload lengths, and a bounded content sample into a 64-bit FNV-1a-style
 * pair. That is O(files) with constant work per file instead of O(bytes).
 *
 * The residual gap versus a full content digest is a content edit that keeps
 * the same byte length, lands in the same millisecond as the previous one, and
 * misses every sample point. Callers get a skipped rebuild in that case, which
 * the Refresh button already exists to recover from.
 */
function digestSiteFiles(files: readonly SiteFile[]): string {
  let hashA = 0x811c9dc5
  let hashB = 0x9e3779b9

  const mix = (value: number): void => {
    hashA = Math.imul(hashA ^ value, 0x01000193)
    hashB = Math.imul(hashB + value + 0x9e3779b9, 0x85ebca6b)
  }

  const mixText = (text: string): void => {
    for (let i = 0; i < text.length; i += 1) mix(text.charCodeAt(i))
    mix(text.length)
  }

  const mixSampled = (text: string | undefined): void => {
    if (text === undefined) {
      mix(-1)
      return
    }
    mix(text.length)
    const stride = Math.max(1, Math.ceil(text.length / CONTENT_SAMPLE_POINTS))
    for (let i = 0; i < text.length; i += stride) mix(text.charCodeAt(i))
  }

  for (const file of files) {
    mixText(file.id)
    mixText(file.path)
    mixText(file.type)
    mix(file.updatedAt)
    mix(file.generated ? 1 : 0)
    mix(file.ejected ? 1 : 0)
    mixSampled(file.content)
    mixSampled(file.blob?.base64)
  }
  mix(files.length)

  return `${(hashA >>> 0).toString(16)}-${(hashB >>> 0).toString(16)}-${files.length}`
}

export function useRuntimeScriptBuild({
  page,
  breakpointId,
  templateContext,
  enabled,
  debounceMs = 350,
}: UseRuntimeScriptBuildArgs): RuntimeScriptBuildState {
  const site = useEditorStore((s) => s.site)
  const [build, setBuild] = useState<BuildResult | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)

  // Pull the signature inputs out of `site` so each memo below depends on the
  // narrow slice it actually reads. Mutative's structural sharing means these
  // references only rotate when that part of the document is written, so a
  // node-tree edit leaves `files` / `runtime` / `packageJson` untouched.
  const files = site?.files ?? null
  const runtime = site?.runtime ?? null
  const packageJson = site?.packageJson ?? null
  const pageId = page?.id ?? null

  // Stage 1 — the expensive half, keyed only on the `files` reference, so it
  // runs when a file is actually written rather than on every CanvasRoot
  // render. Short-circuits to `null` while the toggle is off: a disabled
  // "Run scripts" toggle does zero digest work.
  const filesDigest = useMemo(
    () => (enabled && files ? digestSiteFiles(files) : null),
    [enabled, files],
  )

  // Stage 2 — key on the bundle's actual inputs (script files, runtime config,
  // deps) rather than `site.updatedAt`, so editing the node tree — which leaves
  // these untouched — does NOT re-run scripts. Editing a script file or a
  // dependency rotates the digest (and therefore the signature) and triggers a
  // fresh bundle. Everything stringified here is small; the files array is
  // represented by its digest.
  const buildSignature = useMemo(() => {
    if (filesDigest === null || pageId === null) return null
    return JSON.stringify({
      files: filesDigest,
      runtime: runtime ?? null,
      packageJson: packageJson ?? null,
      pageId,
      breakpointId,
      templateContext: templateContext ?? null,
    })
  }, [filesDigest, runtime, packageJson, pageId, breakpointId, templateContext])

  const isIdle = !enabled || !site || !page || buildSignature === null

  const kickOffBuild = useEffectEvent(() => {
    if (page === null || buildSignature === null) return null
    const pageId = page.id
    const capturedBreakpointId = breakpointId
    const capturedTemplateContext = templateContext
    const capturedSignature = buildSignature

    let cancelled = false

    const timeout = window.setTimeout(() => {
      const currentSite = useEditorStore.getState().site
      if (!currentSite) return

      buildCmsRuntimePreview({
        site: currentSite,
        pageId,
        breakpointId: capturedBreakpointId,
        templateContext: capturedTemplateContext,
      })
        .then((result) => {
          if (cancelled) return
          setBuild({
            signature: capturedSignature,
            scripts: extractInjectableScripts(result),
            diagnostics: result.diagnostics,
            status: result.diagnostics.some((d) => d.severity === 'error') ? 'error' : 'ready',
          })
        })
        .catch((error) => {
          if (cancelled) return
          setBuild({
            signature: capturedSignature,
            scripts: [],
            diagnostics: [
              {
                code: 'runtime-script-client-error',
                severity: 'error',
                message: getErrorMessage(error, 'Runtime script build failed'),
              },
            ],
            status: 'error',
          })
        })
    }, debounceMs)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  })

  useEffect(() => {
    if (isIdle || buildSignature === null) return
    return kickOffBuild() ?? undefined
  }, [buildSignature, isIdle, refreshNonce, debounceMs])

  const refresh = () => {
    setRefreshNonce((n) => n + 1)
  }

  const matchesCurrent = build !== null && build.signature === buildSignature
  const status: RuntimeScriptStatus = isIdle
    ? 'idle'
    : matchesCurrent
      ? build.status
      : 'building'
  const scripts = isIdle || !matchesCurrent ? EMPTY_SCRIPTS : build.scripts
  const diagnostics = isIdle || !matchesCurrent ? EMPTY_DIAGNOSTICS : build.diagnostics

  return { scripts, status, diagnostics, refresh }
}

// Stable empty sentinels so the returned arrays keep a constant identity while
// idle/building — prevents downstream effects (the injector) from re-running
// against a fresh `[]` every render.
const EMPTY_SCRIPTS: InjectableRuntimeScript[] = []
const EMPTY_DIAGNOSTICS: SiteRuntimeDiagnostic[] = []
