/**
 * Content-Security-Policy as data.
 *
 * The published-page CSP is built in stages by different layers: the publisher
 * emits a base policy (`createBaseCspPlan`), then the server-side injection
 * pipeline relaxes it for plugin `frontend.assets[]`, elected media-storage
 * adapters, and the native-form runtime. Historically each stage rewrote the
 * finished `<meta>` string with its own regex, serializing source sets from JS
 * `Set`s whose iteration order depended on which stage ran first — so the same
 * plugins + adapters could emit DIFFERENT CSP strings across runs, breaking
 * content-hashing and making tests brittle.
 *
 * This module is the single source of truth for the CSP. A `CspPlan` is a plain
 * `Map<directive, Set<source>>`. Every stage mutates the plan as DATA
 * (`setCspDirective` to replace, `addCspSources` to union) and `serializeCsp`
 * emits the directive string with DETERMINISTIC ordering — directives sorted by
 * name, sources sorted within each directive. The same inputs therefore always
 * produce a byte-identical policy.
 *
 * `rewriteCspMeta` is the one helper the server post-processing stages use to
 * mutate an already-emitted `<meta>` tag: it parses the policy back into a
 * plan, hands it to a mutator, and re-serializes once — no per-directive regex
 * surgery, no second pass.
 */

/** A CSP policy modelled as data: directive name → set of source expressions. */
interface CspPlan {
  directives: Map<string, Set<string>>
}

/** Matches the published-page CSP `<meta>` tag so its policy can be rewritten. */
const CSP_META_PATTERN =
  /<meta http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/i

/** An empty plan. */
function emptyCspPlan(): CspPlan {
  return { directives: new Map() }
}

/**
 * Replace a directive's source list outright. Use when a stage owns the
 * directive's value (e.g. relaxing `script-src` to exactly `'self'`).
 */
export function setCspDirective(
  plan: CspPlan,
  directive: string,
  sources: Iterable<string>,
): void {
  plan.directives.set(directive, new Set(sources))
}

/**
 * Union extra sources into a directive (creating it if absent). Adding a real
 * source to a `'none'` directive drops `'none'` — `'none'` is only valid as the
 * sole value, and mixing it with a real source is a contradiction.
 */
export function addCspSources(
  plan: CspPlan,
  directive: string,
  sources: Iterable<string>,
): void {
  const set = plan.directives.get(directive) ?? new Set<string>()
  set.delete("'none'")
  for (const source of sources) set.add(source)
  plan.directives.set(directive, set)
}

/**
 * The publisher's base policy. `script-src`/`worker-src` default to `'none'`
 * and relax to `'self'` (+ the importmap hash) once the page carries any
 * script tag; the runtime cache URLs live under the same origin.
 */
export function createBaseCspPlan(opts: {
  anyScriptTag: boolean
  importmapSha?: string
}): CspPlan {
  const plan = emptyCspPlan()
  setCspDirective(plan, 'default-src', ["'self'"])

  const scriptSources = opts.anyScriptTag ? ["'self'"] : ["'none'"]
  if (opts.importmapSha) scriptSources.push(`'sha256-${opts.importmapSha}'`)
  setCspDirective(plan, 'script-src', scriptSources)

  setCspDirective(plan, 'style-src', ["'self'", "'unsafe-inline'"])
  setCspDirective(plan, 'img-src', ["'self'", 'data:', 'https:'])
  setCspDirective(plan, 'frame-src', ["'none'"])
  setCspDirective(plan, 'worker-src', opts.anyScriptTag ? ["'self'", 'blob:'] : ["'none'"])
  return plan
}

/**
 * Fetch directives that fall back to `default-src` when absent.
 *
 * The base policy sets `default-src 'self'` and names only some of these, so a
 * directive a later channel creates from third-party origins alone silently
 * revokes same-origin access for its resource type: present means default-src
 * no longer applies. On lfrep.com a derived `font-src ka-f.fontawesome.com`
 * blocked the site's own self-hosted Parnaso and Graphik faces, document.fonts
 * reported status "error", and every headline fell back to a wide sans and
 * wrapped at 270px.
 */
const SELF_FALLBACK_DIRECTIVES = new Set([
  'connect-src',
  'font-src',
  'frame-src',
  'img-src',
  'manifest-src',
  'media-src',
  'object-src',
  'script-src',
  'style-src',
  'worker-src',
])

/**
 * Restore the same-origin access a newly-created directive would revoke.
 *
 * Only directives absent from `baseDirectives` are touched. A directive the
 * base policy set deliberately is the author's decision and stays that way:
 * `frame-src 'none'` gaining an embed origin should permit that embed, not
 * quietly reopen same-origin framing. The bug being fixed is narrower than
 * that — a directive that did not exist, created from third-party origins
 * alone, revokes a same-origin access nobody chose to revoke.
 */
export function ensureSelfInFetchDirectives(
  plan: CspPlan,
  baseDirectives: ReadonlySet<string>,
): void {
  for (const [directive, sources] of plan.directives) {
    if (baseDirectives.has(directive)) continue
    if (!SELF_FALLBACK_DIRECTIVES.has(directive)) continue
    if (sources.size === 0) continue
    if (sources.size === 1 && sources.has("'none'")) continue
    sources.add("'self'")
  }
}

/** The directive names a plan currently carries, for the check above. */
export function cspDirectiveNames(plan: CspPlan): Set<string> {
  return new Set(plan.directives.keys())
}

/**
 * Parse a serialized policy (the `content="…"` value) back into a plan. Splits
 * on `;` for directives and on whitespace for the directive name + its sources.
 * No dynamic `RegExp` is built from the input, so an attacker-controlled
 * directive name cannot inject regex metacharacters.
 */
export function parseCspContent(content: string): CspPlan {
  const plan = emptyCspPlan()
  for (const chunk of content.split(';')) {
    const trimmed = chunk.trim()
    if (!trimmed) continue
    const parts = trimmed.split(/\s+/)
    const directive = parts[0]
    if (!directive) continue
    plan.directives.set(directive, new Set(parts.slice(1)))
  }
  return plan
}

/**
 * Serialize a plan to a CSP policy string with deterministic ordering:
 * directives sorted by name, sources sorted within each directive. Empty
 * directives are dropped. Returns `''` for an empty plan.
 */
export function serializeCsp(plan: CspPlan): string {
  const directives = [...plan.directives.entries()]
    .filter(([, sources]) => sources.size > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (directives.length === 0) return ''
  return (
    directives
      .map(([name, sources]) => `${name} ${[...sources].sort().join(' ')}`)
      .join('; ') + ';'
  )
}

/** Render a plan as a complete CSP `<meta>` tag. */
export function cspMetaTag(plan: CspPlan): string {
  return `<meta http-equiv="Content-Security-Policy" content="${serializeCsp(plan)}">`
}

/**
 * Rewrite the CSP `<meta>` tag in an HTML document by mutating its policy as
 * data: parse the current policy into a plan, apply `mutate`, and re-serialize
 * once. A no-op when the document has no CSP meta tag.
 */
export function rewriteCspMeta(html: string, mutate: (plan: CspPlan) => void): string {
  return html.replace(CSP_META_PATTERN, (_full, content: string) => {
    const plan = parseCspContent(content)
    mutate(plan)
    return cspMetaTag(plan)
  })
}
