/**
 * SiteSettings — per-site configuration stored in SiteDocument.settings.
 * Mirrors `validateSettings` in `validate.ts` (lines ~614–633).
 *
 * Color tokens — REMOVED.
 *
 * The legacy `site.settings.colorTokens` field was the original raw
 * design-token shape (`{ '--color-primary': '#6366f1', ... }`) emitted into a
 * `:root {}` block in the published `framework.css`. It has been fully
 * superseded by the structured framework Color settings
 * (`site.settings.framework.colors`), which is what the editor's Colors panel
 * reads from and writes to.
 *
 * Keeping both paths around silently injected ghost tokens into every fresh
 * project (the old `DEFAULT_COLOR_TOKENS` had seven `#6366f1`-family defaults)
 * that the user could not see or remove via the UI. Per CLAUDE.md ("we are
 * pre-release, don't leave both an old and new implementation side-by-side")
 * the legacy field has been removed entirely; persisted snapshots that still
 * carry a `colorTokens` key are silently dropped on parse.
 *
 * For tolerant parsing (with fallbacks for invalid sub-fields), use
 * `parseSiteSettings` instead of `parseValue(SiteSettingsSchema, raw)`.
 *
 * Constraint #269: no imports from editor / editor-store here.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'
import { compiledCheck } from '@core/utils/typeboxCompiler'
import { FrameworkSettingsSchema } from '@core/framework-schema'
import { SiteFontsSettingsSchema, parseSiteFontsSettings } from '@core/fonts'

// ---------------------------------------------------------------------------
// SiteCspSettingsSchema — per-site Content-Security-Policy escape hatch
// ---------------------------------------------------------------------------

/**
 * Extra CSP sources this site's published pages need, keyed by directive
 * (`{ 'connect-src': ['https://vimeo.com'] }`).
 *
 * The publisher derives most of the policy from page content plus a small
 * provider-implication table (`@core/publisher/cspDerivation`). This is the
 * escape hatch for the provider that table doesn't know about — an operator
 * unblocks the embed here instead of waiting on a code change.
 *
 * Sources are validated at publish time (`siteConfiguredCspSources`): a
 * malformed directive name or a source expression carrying whitespace, quotes,
 * `;` or `,` is dropped rather than emitted into the `<meta>` tag.
 */
const SiteCspSettingsSchema = Type.Object({
  extraSources: Type.Record(Type.String(), Type.Array(Type.String())),
})

export type SiteCspSettings = Static<typeof SiteCspSettingsSchema>

// ---------------------------------------------------------------------------
// ExtraHeadLinkSchema — operator-configured `<link>` tags
// ---------------------------------------------------------------------------

/**
 * Extra `<link>` tags emitted into every published page's `<head>`.
 *
 * The case that forced this: a migrated site whose type is licensed from a
 * vendor (Adobe Fonts / Typekit) needs `<link rel="stylesheet"
 * href="https://use.typekit.net/xxxx.css">` in the head — the kit CSS is
 * account-scoped and cannot be bundled. Site import never writes this field;
 * only an operator (or the migration pipeline, over the store API) does, so
 * re-importing a site never adds or removes a head link.
 *
 * `rel` is restricted at publish time to a small non-executable set
 * (`stylesheet`, `preconnect`, `dns-prefetch`, `preload`) and `href` must pass
 * `isSafeUrl`, so this cannot become a script-injection channel.
 */
const ExtraHeadLinkSchema = Type.Object({
  rel: Type.String({ minLength: 1 }),
  href: Type.String({ minLength: 1 }),
  crossorigin: Type.Optional(Type.String()),
  as: Type.Optional(Type.String()),
})

export type ExtraHeadLink = Static<typeof ExtraHeadLinkSchema>

// ---------------------------------------------------------------------------
// SiteSettingsSchema
// ---------------------------------------------------------------------------

export const SiteSettingsSchema = Type.Object({
  metaTitle: Type.Optional(Type.String()),
  metaDescription: Type.Optional(Type.String()),
  faviconUrl: Type.Optional(Type.String()),
  language: Type.Optional(Type.String()),
  /** Structured framework token settings — absent means framework disabled. */
  framework: Type.Optional(FrameworkSettingsSchema),
  /** Library of installed fonts — absent when no fonts added. */
  fonts: Type.Optional(SiteFontsSettingsSchema),
  /** Published-page CSP escape hatch — absent when the site adds nothing. */
  contentSecurityPolicy: Type.Optional(SiteCspSettingsSchema),
  /** Extra `<head>` `<link>` tags — absent when the operator configured none. */
  extraHeadLinks: Type.Optional(Type.Array(ExtraHeadLinkSchema)),
  /** Keyboard shortcut overrides — defaults to {} — handled in parseSiteSettings. */
  shortcuts: Type.Record(Type.String(), Type.String()),
})

export type SiteSettings = Static<typeof SiteSettingsSchema>

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  shortcuts: {},
}

// ---------------------------------------------------------------------------
// Tolerant parsing
// ---------------------------------------------------------------------------

/**
 * Parse SiteSettings, providing fallbacks for all resilient fields.
 *
 * Persisted snapshots from older versions may carry a top-level `colorTokens`
 * field — that legacy data path was removed in favour of the structured
 * framework Color settings (`framework.colors`). Any persisted `colorTokens`
 * key is silently dropped here (no migration: per CLAUDE.md, the dev DB is
 * disposable and there are no production users).
 */
export function parseSiteSettings(raw: unknown): SiteSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_SITE_SETTINGS
  const r = raw as Record<string, unknown>

  const shortcuts: Record<string, string> = {}
  if (r.shortcuts && typeof r.shortcuts === 'object' && !Array.isArray(r.shortcuts)) {
    for (const [k, v] of Object.entries(r.shortcuts as Record<string, unknown>)) {
      if (typeof v === 'string') shortcuts[k] = v
    }
  }

  const framework = compiledCheck(FrameworkSettingsSchema, r.framework)
    ? (r.framework as SiteSettings['framework'])
    : undefined

  const fonts = r.fonts != null ? parseSiteFontsSettings(r.fonts) : undefined

  const contentSecurityPolicy = parseSiteCspSettings(r.contentSecurityPolicy)

  const extraHeadLinks = parseExtraHeadLinks(r.extraHeadLinks)

  return {
    ...(typeof r.metaTitle === 'string' ? { metaTitle: r.metaTitle } : {}),
    ...(typeof r.metaDescription === 'string' ? { metaDescription: r.metaDescription } : {}),
    ...(typeof r.faviconUrl === 'string' ? { faviconUrl: r.faviconUrl } : {}),
    ...(typeof r.language === 'string' ? { language: r.language } : {}),
    framework,
    fonts,
    ...(contentSecurityPolicy ? { contentSecurityPolicy } : {}),
    ...(extraHeadLinks ? { extraHeadLinks } : {}),
    shortcuts,
  }
}

/**
 * Parse the extra head links, dropping malformed entries. Returns `undefined`
 * when nothing usable is present so the field stays absent rather than
 * persisting an empty array on every site.
 */
function parseExtraHeadLinks(raw: unknown): ExtraHeadLink[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const links: ExtraHeadLink[] = []
  for (const entry of raw) {
    if (!compiledCheck(ExtraHeadLinkSchema, entry)) continue
    const link = entry as ExtraHeadLink
    links.push({
      rel: link.rel,
      href: link.href,
      ...(link.crossorigin != null ? { crossorigin: link.crossorigin } : {}),
      ...(link.as != null ? { as: link.as } : {}),
    })
  }
  return links.length > 0 ? links : undefined
}

/**
 * Parse the CSP escape hatch, dropping non-string-array entries. Returns
 * `undefined` when nothing usable is present so the field stays absent rather
 * than persisting an empty object on every site.
 */
function parseSiteCspSettings(raw: unknown): SiteCspSettings | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const source = (raw as Record<string, unknown>).extraSources
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined

  const extraSources: Record<string, string[]> = {}
  for (const [directive, values] of Object.entries(source as Record<string, unknown>)) {
    if (!Array.isArray(values)) continue
    const sources = values.filter((v): v is string => typeof v === 'string')
    if (sources.length > 0) extraSources[directive] = sources
  }
  return Object.keys(extraSources).length > 0 ? { extraSources } : undefined
}
