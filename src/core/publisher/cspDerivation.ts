/**
 * Content-Security-Policy derived from the page's own markup.
 *
 * Module-built pages declare what they need: a module's `render()` returns
 * `cspSources` (see `CspSourceRequirement`) and the publisher merges those into
 * the plan, so only pages that actually embed something external carry a
 * relaxed directive. Classic-imported pages (WordPress / HTML imports) have no
 * such declaration — their markup arrives as `base.container` nodes carrying
 * arbitrary `<iframe src>` / `<script src>` attributes, so under the strict base
 * policy (`script-src 'none'; frame-src 'none'`) every third-party embed on an
 * imported page is dead on arrival.
 *
 * This module closes that gap by deriving the policy from the rendered page
 * HTML, in three passes that all feed the SAME `CspPlan`:
 *
 *   1. **Derivation** — `deriveCspSourcesFromHtml` scans the rendered markup for
 *      `<script src>` (→ `script-src`), `<iframe src>` (→ `frame-src`),
 *      `<video|audio|source src>` (→ `media-src`), `<video poster>` (→
 *      `img-src`) and
 *      contributes the ORIGIN of each external reference. Only `https:` (and
 *      scheme-relative `//host/…`, which resolves to https on an https page)
 *      counts; relative / same-origin / `data:` / `blob:` / `http:` URLs are
 *      ignored. Nothing is derived from a page that references nothing
 *      external, so the strict default is preserved byte-for-byte.
 *
 *   2. **Provider implications** — an embed's `src` origin is rarely the only
 *      origin it talks to: the Vimeo player script is loaded from
 *      `player.vimeo.com` but then fetches metadata from `vimeo.com` and injects
 *      its own iframe. `PROVIDER_IMPLICATIONS` (below) is a small, deliberately
 *      minimal data table mapping a seen host to the companion sources that
 *      host is known to require.
 *
 *   3. **Per-site escape hatch** — `site.settings.contentSecurityPolicy
 *      .extraSources` (see `@core/page-tree/siteSettings`) lets an operator add
 *      sources per directive for the provider this table doesn't know about,
 *      without a code change.
 *
 * All three produce plain `PageCspRequirement[]`, unioned into the plan via
 * `addCspSources`, so ordering never affects the emitted policy (`serializeCsp`
 * sorts directives and sources).
 */

/**
 * One directive's worth of derived sources. Structurally the same shape a
 * module's `render()` returns (`CspSourceRequirement` in `@core/module-engine`),
 * but `directive` is a plain string: the module-facing type is a closed union
 * of the directives a module may touch, while the per-site escape hatch can
 * name any directive in the base policy (`worker-src`, `default-src`, …).
 */
export interface PageCspRequirement {
  directive: string
  sources: string[]
}

// ---------------------------------------------------------------------------
// Provider implication table
// ---------------------------------------------------------------------------

/**
 * Companion CSP sources implied by seeing a given host in a page's `<script
 * src>` / `<iframe src>`. Keys are lowercase hostnames (no port, no scheme).
 *
 * Deliberately minimal: every entry is a source the provider's own embed
 * documentation requires for a BASIC embed to function. Anything beyond that
 * (analytics variants, regional CDNs, optional features) belongs in the
 * per-site escape hatch, not here — a table that grows to cover every optional
 * request path silently turns into a permissive default.
 *
 * To extend: add a host key with the directives it implies. The host's OWN
 * origin is already contributed by the derivation pass, so entries only list
 * the companions.
 */
const PROVIDER_IMPLICATIONS: Readonly<Record<string, readonly PageCspRequirement[]>> = {
  // Vimeo: `player.vimeo.com/api/player.js` (also loaded by jarallax-video)
  // injects a `player.vimeo.com` iframe and fetches oEmbed-ish metadata from
  // `vimeo.com/api/v2/video/<id>.json`.
  'player.vimeo.com': [
    { directive: 'frame-src', sources: ['https://player.vimeo.com'] },
    { directive: 'connect-src', sources: ['https://vimeo.com'] },
  ],
  // YouTube: the IFrame Player API script lives on www.youtube.com and the
  // player frames on either the standard or the privacy-enhanced domain.
  'www.youtube.com': [
    {
      directive: 'frame-src',
      sources: ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
    },
    { directive: 'script-src', sources: ['https://www.youtube.com'] },
  ],
  'www.youtube-nocookie.com': [
    {
      directive: 'frame-src',
      sources: ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
    },
    { directive: 'script-src', sources: ['https://www.youtube.com'] },
  ],
  // Google Tag Manager loads gtag/analytics.js from google-analytics.com and
  // beacons hits back to the same origin.
  'www.googletagmanager.com': [
    { directive: 'script-src', sources: ['https://www.google-analytics.com'] },
    { directive: 'connect-src', sources: ['https://www.google-analytics.com'] },
  ],
  // Google Maps JS API: the loader pulls further script chunks from
  // maps.gstatic.com, XHRs tiles/metadata from maps.googleapis.com, and serves
  // tile images from both.
  'maps.googleapis.com': [
    { directive: 'script-src', sources: ['https://maps.gstatic.com'] },
    { directive: 'connect-src', sources: ['https://maps.googleapis.com'] },
    {
      directive: 'img-src',
      sources: ['https://maps.googleapis.com', 'https://maps.gstatic.com'],
    },
  ],
}

// ---------------------------------------------------------------------------
// Derivation from rendered HTML
// ---------------------------------------------------------------------------

/**
 * Matches an opening `<script …>` / `<iframe …>` tag. The tag name is captured
 * so the src can be routed to the right directive; attributes are captured as
 * one blob and parsed separately (a single regex over `src` alone would also
 * match `data-src`, `srcset`, etc.).
 */
const EXTERNAL_TAG_PATTERN = /<(script|iframe|video|audio|source)(\s[^>]*)>/gi

/** Matches a `src` attribute (quoted or bare) inside a captured attribute blob. */
const SRC_ATTR_PATTERN = /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i

/**
 * Directive each scanned tag contributes its external origin to.
 *
 * Media is here for the same reason images are hot-linked: a migrated site
 * keeps playing video off the source WordPress until per-site cutover, so the
 * `<video>` src is cross-origin by design. Without `media-src` the policy falls
 * back to `default-src 'self'` and the browser refuses the file outright —
 * 890capital.com's hero video and autumnwooddesigns.com's background video both
 * published as flat grey, `readyState 0`, with a console line reading
 * "Loading media from … violates the following Content Security Policy".
 * Neither carries a poster, so there is not even a first frame to fall back to.
 */
const TAG_DIRECTIVE: Readonly<Record<string, string>> = {
  script: 'script-src',
  iframe: 'frame-src',
  video: 'media-src',
  audio: 'media-src',
  source: 'media-src',
}

/**
 * Attributes beyond `src` that pull a media file: a `<video poster>` is fetched
 * as an image, so it belongs to `img-src` rather than `media-src`.
 */
const POSTER_ATTR_PATTERN = /(?:^|\s)poster\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i

/**
 * Reduce a `src` attribute value to the https origin the CSP needs, or `null`
 * when it contributes nothing.
 *
 * - `https://host/path`   → `https://host`
 * - `//host/path`         → `https://host` (scheme-relative: published pages
 *                           are served over https, so this resolves to https)
 * - `/path`, `path`, `#x` → `null` (same origin, already covered by `'self'`)
 * - `http:`, `data:`, `blob:`, `javascript:` → `null` (never relaxed here)
 *
 * A non-default port is preserved (`https://host:8443`) because CSP treats
 * host and host:port as different sources.
 */
function originFromSrc(rawSrc: string): string | null {
  const src = decodeHtmlEntities(rawSrc.trim())
  if (!src) return null

  const absolute = src.startsWith('//') ? `https:${src}` : src
  if (!/^https:\/\//i.test(absolute)) return null

  let url: URL
  try {
    url = new URL(absolute)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !url.hostname) return null
  return url.port ? `https://${url.hostname}:${url.port}` : `https://${url.hostname}`
}

/**
 * Decode the handful of entities the publisher's attribute escaper emits
 * (`escapeHtml` / `sanitizeRenderableHtmlAttribute`), so a src written as
 * `https://x/?a=1&amp;b=2` still parses as a URL. Ampersand is decoded last so
 * `&amp;lt;` doesn't collapse into `<`.
 */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * Scan rendered page HTML and return the CSP sources it implies: one entry per
 * external `<script src>` origin (`script-src`), one per external `<iframe src>`
 * origin (`frame-src`), plus every companion source from
 * `PROVIDER_IMPLICATIONS` for the hosts seen.
 *
 * Returns `[]` for markup with no external script/iframe references — which is
 * what keeps the strict base policy byte-identical for pages that need nothing.
 */
export function deriveCspSourcesFromHtml(html: string): PageCspRequirement[] {
  const byDirective = new Map<string, Set<string>>()
  const add = (directive: string, source: string): void => {
    const set = byDirective.get(directive) ?? new Set<string>()
    set.add(source)
    byDirective.set(directive, set)
  }

  for (const match of html.matchAll(EXTERNAL_TAG_PATTERN)) {
    const tagName = match[1]?.toLowerCase() ?? ''
    const directive = TAG_DIRECTIVE[tagName]
    if (!directive) continue

    const attrs = match[2] ?? ''

    // A poster is an image the media element paints before playback, and it is
    // the only thing a blocked video would otherwise have shown.
    if (tagName === 'video') {
      const posterMatch = POSTER_ATTR_PATTERN.exec(attrs)
      const posterOrigin = posterMatch
        ? originFromSrc(posterMatch[1] ?? posterMatch[2] ?? posterMatch[3] ?? '')
        : null
      if (posterOrigin) add('img-src', posterOrigin)
    }

    const srcMatch = SRC_ATTR_PATTERN.exec(attrs)
    if (!srcMatch) continue
    const origin = originFromSrc(srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '')
    if (!origin) continue

    add(directive, origin)

    // Provider implications keyed by the host we just saw, in whichever tag it
    // appeared: a Vimeo player referenced as a script and the same player
    // referenced as an iframe need the same companion origins.
    const host = origin.slice('https://'.length).split(':')[0] ?? ''
    for (const implied of PROVIDER_IMPLICATIONS[host] ?? []) {
      for (const source of implied.sources) add(implied.directive, source)
    }
  }

  return requirementsFromMap(byDirective)
}

// ---------------------------------------------------------------------------
// Site-settings derivation (fonts + head links)
// ---------------------------------------------------------------------------

/** Origin of an absolute https URL, or null when it isn't one. */
function httpsOrigin(url: string): string | null {
  if (!/^https:\/\//i.test(url)) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * `font-src` origins for the site's vendor-hosted faces, and `style-src` /
 * `font-src` origins for operator-configured head links.
 *
 * These two channels put an external URL into the published document without
 * ever appearing in the page body, so `deriveCspSourcesFromHtml` cannot see
 * them: the font URL lives inside `framework.css` and the head link is added
 * after the body walk. Without this pass a Typekit face is emitted and then
 * blocked by the site's own policy, which is the same class of failure as
 * emitting no face at all.
 *
 * `'self'` is not added here — `ensureSelfInFetchDirectives` restores it for
 * any directive these sources bring into existence.
 */
export function siteAssetCspSources(site: {
  settings: {
    fonts?: { items: readonly { files?: readonly { path: string }[] }[] } | undefined
    extraHeadLinks?: readonly { rel: string; href: string; as?: string }[] | undefined
  }
}): PageCspRequirement[] {
  const byDirective = new Map<string, Set<string>>()
  const add = (directive: string, source: string): void => {
    const set = byDirective.get(directive) ?? new Set<string>()
    set.add(source)
    byDirective.set(directive, set)
  }

  for (const entry of site.settings.fonts?.items ?? []) {
    for (const file of entry.files ?? []) {
      const origin = httpsOrigin(file.path)
      if (origin && isSafeCspSource(origin)) add('font-src', origin)
    }
  }

  for (const link of site.settings.extraHeadLinks ?? []) {
    // Same malformed-href rule the head emitter applies, so a link that is
    // dropped from the document never leaves an origin behind in the policy.
    if (/["'<>\s]/.test(link.href)) continue
    const origin = httpsOrigin(link.href)
    if (!origin || !isSafeCspSource(origin)) continue
    if (link.rel === 'stylesheet' || (link.rel === 'preload' && link.as === 'style')) {
      add('style-src', origin)
      // A vendor kit stylesheet exists to declare @font-face rules; the faces
      // it names are fetched from the same origin family, so the stylesheet
      // origin is a font origin too. Emitting only style-src would load the
      // kit and then block every face it declares.
      add('font-src', origin)
    } else if (link.rel === 'preload' && link.as === 'font') {
      add('font-src', origin)
    } else if (link.rel === 'preconnect' || link.rel === 'dns-prefetch') {
      // A connection hint fetches nothing on its own; no directive needed.
      continue
    }
  }

  return requirementsFromMap(byDirective)
}

// ---------------------------------------------------------------------------
// Per-site escape hatch
// ---------------------------------------------------------------------------

/** Directive names are CSP tokens: lowercase letters, digits, dashes. */
const DIRECTIVE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * A source expression is either a quoted keyword/hash (`'self'`,
 * `'unsafe-inline'`, `'sha256-…'`) or a host/scheme source with no whitespace
 * and none of the characters that would terminate a directive or break out of
 * the `content="…"` attribute.
 */
const SOURCE_KEYWORD_PATTERN = /^'[A-Za-z0-9-]+(?:[+/=A-Za-z0-9-]*)'$/
const SOURCE_HOST_PATTERN = /^[^\s;,'"<>]+$/

/** Reject anything that could break directive parsing or escape the meta tag. */
function isSafeCspSource(source: string): boolean {
  if (source.length === 0 || source.length > 255) return false
  return SOURCE_KEYWORD_PATTERN.test(source) || SOURCE_HOST_PATTERN.test(source)
}

/**
 * Turn a site's configured `contentSecurityPolicy.extraSources` map into
 * requirements, dropping malformed directive names and unsafe source
 * expressions. Invalid entries are skipped silently rather than throwing: the
 * value is user-editable configuration, and a typo must not fail a publish.
 */
export function siteConfiguredCspSources(
  extraSources: Readonly<Record<string, readonly string[]>> | undefined,
): PageCspRequirement[] {
  if (!extraSources) return []
  const byDirective = new Map<string, Set<string>>()
  for (const [rawDirective, sources] of Object.entries(extraSources)) {
    const directive = rawDirective.trim().toLowerCase()
    if (!DIRECTIVE_NAME_PATTERN.test(directive)) continue
    if (!Array.isArray(sources)) continue
    for (const raw of sources) {
      if (typeof raw !== 'string') continue
      const source = raw.trim()
      if (!isSafeCspSource(source)) continue
      const set = byDirective.get(directive) ?? new Set<string>()
      set.add(source)
      byDirective.set(directive, set)
    }
  }
  return requirementsFromMap(byDirective)
}

/**
 * Flatten the accumulator into requirements with deterministic ordering.
 * `serializeCsp` sorts anyway; sorting here too keeps the intermediate value
 * comparable in tests.
 */
function requirementsFromMap(
  byDirective: ReadonlyMap<string, ReadonlySet<string>>,
): PageCspRequirement[] {
  return [...byDirective.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([directive, sources]) => ({ directive, sources: [...sources].sort() }))
}
