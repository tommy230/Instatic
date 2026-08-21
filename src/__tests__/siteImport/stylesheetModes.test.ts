/**
 * Per-stylesheet import modes + cross-sheet class semantics.
 *
 * Covers the model that replaced the automatic `instatic-import-scope-*`
 * generation:
 *   - `mode: 'file'` keeps a stylesheet verbatim as an ImportStylesheet
 *     (flattened @import graph, Google imports stripped, url() normalised),
 *     skipping all semantic extraction for it.
 *   - Converted sheets merge CSS-natively; DIVERGENT cross-sheet class
 *     definitions surface as explicit `crossSheetClasses` conflicts whose
 *     resolutions (rename / keep-first / overwrite) apply through
 *     `applyConflictResolutions`.
 *   - The registry's unique-class-name invariant is enforced by demoting
 *     repeated class fragments to ambient rules after renames.
 */

import { describe, it, expect } from 'bun:test'
import '@modules/base'
import { buildImportPlan, applyConflictResolutions } from '@core/siteImport'
import type { FileMap, ImportPlan } from '@core/siteImport'
import { makeEmptySiteDocument } from './mockSite'

const encoder = new TextEncoder()

function twoPageFileMap(cssA: string, cssB: string): FileMap {
  const pageHtml = (cssHref: string) => `<!doctype html><html><head>
    <link rel="stylesheet" href="${cssHref}">
  </head><body>
    <a class="btn" href="#">Buy</a>
  </body></html>`
  return {
    files: {
      'index.html': { bytes: encoder.encode(pageHtml('css/a.css')), mimeType: 'text/html' },
      'original.html': { bytes: encoder.encode(pageHtml('css/b.css')), mimeType: 'text/html' },
      'css/a.css': { bytes: encoder.encode(cssA), mimeType: 'text/css' },
      'css/b.css': { bytes: encoder.encode(cssB), mimeType: 'text/css' },
    },
  }
}

function resolveWithDefaults(plan: ImportPlan): ImportPlan {
  return applyConflictResolutions(
    plan,
    plan.conflicts.pages,
    plan.conflicts.rules,
    plan.conflicts.tokens,
    plan.conflicts.crossSheetClasses,
  )
}

// ---------------------------------------------------------------------------
// Cross-sheet class conflicts (converted sheets)
// ---------------------------------------------------------------------------

describe('cross-sheet class conflicts', () => {
  it('flags divergent definitions and renames the later one by default', () => {
    const plan = buildImportPlan({
      fileMap: twoPageFileMap(
        '.btn { border-radius: 0; } .btn:hover { opacity: 0.9; }',
        '.btn { border-radius: 999px; } .btn:hover { opacity: 0.5; }',
      ),
      currentSite: makeEmptySiteDocument(),
    })

    expect(plan.conflicts.crossSheetClasses).toHaveLength(1)
    const conflict = plan.conflicts.crossSheetClasses[0]
    expect(conflict.desiredName).toBe('btn')
    expect(conflict.pageSources).toEqual(['original.html'])
    expect(conflict.sources).toEqual(['css/b.css'])
    expect(conflict.defaultResolution).toEqual({ action: 'auto-rename', resolvedName: 'btn-2' })

    const resolved = resolveWithDefaults(plan)

    // The kept definition owns the bare name; the renamed one is materialised.
    const classRules = resolved.styleRules.filter((r) => r.kind === 'class')
    expect(classRules.map((r) => r.name).sort()).toEqual(['btn', 'btn-2'])
    expect(classRules.find((r) => r.name === 'btn')?.styles.borderTopLeftRadius).toBe('0px')
    expect(classRules.find((r) => r.name === 'btn-2')?.styles.borderTopLeftRadius).toBe('999px')

    // The renamed cascade's ambient selectors and node tokens follow.
    const hoverSelectors = resolved.styleRules
      .filter((r) => r.kind === 'ambient')
      .map((r) => r.selector)
      .sort()
    expect(hoverSelectors).toEqual(['.btn-2:hover', '.btn:hover'])

    const pageA = resolved.pages.find((p) => p.source === 'index.html')!
    const pageB = resolved.pages.find((p) => p.source === 'original.html')!
    const tokensOf = (page: typeof pageA) =>
      Object.values(page.nodeFragment.nodes).flatMap((n) => n.classIds ?? [])
    expect(tokensOf(pageA)).toContain('btn')
    expect(tokensOf(pageB)).toContain('btn-2')
    expect(tokensOf(pageB)).not.toContain('btn')
  })

  it('does not flag identical definitions', () => {
    const plan = buildImportPlan({
      fileMap: twoPageFileMap(
        '.btn { border-radius: 4px; }',
        '.btn { border-radius: 4px; }',
      ),
      currentSite: makeEmptySiteDocument(),
    })

    expect(plan.conflicts.crossSheetClasses).toHaveLength(0)

    // The duplicate fragment demotes to an ambient rule — one bindable class.
    const resolved = resolveWithDefaults(plan)
    const btnClassRules = resolved.styleRules.filter((r) => r.kind === 'class' && r.name === 'btn')
    expect(btnClassRules).toHaveLength(1)
  })

  it('uses important-aware cascade semantics when comparing definitions', () => {
    const plan = buildImportPlan({
      fileMap: twoPageFileMap(
        '.btn { color: red !important; } .btn { color: blue; }',
        '.btn { color: red !important; }',
      ),
      currentSite: makeEmptySiteDocument(),
    })

    expect(plan.conflicts.crossSheetClasses).toHaveLength(0)
  })

  it('preserves priority when materialising a renamed divergent definition', () => {
    const plan = buildImportPlan({
      fileMap: twoPageFileMap(
        '.btn { color: red; }',
        '.btn { color: blue !important; }',
      ),
      currentSite: makeEmptySiteDocument(),
    })
    const resolved = resolveWithDefaults(plan)
    const renamed = resolved.styleRules.find(
      (rule) => rule.kind === 'class' && rule.name === 'btn-2',
    )
    expect(renamed?.styles.color).toBe('blue')
    expect(renamed?.stylePriorities).toEqual({ color: 'important' })
  })

  it('keep-first (skip) drops the divergent definition and binds its pages to the first', () => {
    const plan = buildImportPlan({
      fileMap: twoPageFileMap(
        '.btn { border-radius: 0; }',
        '.btn { border-radius: 999px; }',
      ),
      currentSite: makeEmptySiteDocument(),
    })
    const conflict = plan.conflicts.crossSheetClasses[0]

    const resolved = applyConflictResolutions(plan, [], [], [], [
      { ...conflict, defaultResolution: { action: 'skip' } },
    ])

    const btnRules = resolved.styleRules.filter((r) =>
      (r.kind === 'class' && r.name === 'btn') || (r.kind === 'ambient' && r.selector === '.btn'),
    )
    expect(btnRules).toHaveLength(1)
    expect(btnRules[0].styles.borderTopLeftRadius).toBe('0px')

    const pageB = resolved.pages.find((p) => p.source === 'original.html')!
    const tokens = Object.values(pageB.nodeFragment.nodes).flatMap((n) => n.classIds ?? [])
    expect(tokens).toContain('btn')
  })

  it('overwrite makes the divergent definition win the bare name', () => {
    const plan = buildImportPlan({
      fileMap: twoPageFileMap(
        '.btn { border-radius: 0; }',
        '.btn { border-radius: 999px; }',
      ),
      currentSite: makeEmptySiteDocument(),
    })
    const conflict = plan.conflicts.crossSheetClasses[0]

    const resolved = applyConflictResolutions(plan, [], [], [], [
      { ...conflict, defaultResolution: { action: 'overwrite' } },
    ])

    const btnRules = resolved.styleRules.filter((r) =>
      (r.kind === 'class' && r.name === 'btn') || (r.kind === 'ambient' && r.selector === '.btn'),
    )
    expect(btnRules).toHaveLength(1)
    expect(btnRules[0].styles.borderTopLeftRadius).toBe('999px')
  })

  it('reserves rename suffixes against existing site class names', () => {
    const site = makeEmptySiteDocument()
    site.styleRules['existing'] = {
      id: 'existing',
      name: 'btn-2',
      kind: 'class',
      selector: '.btn-2',
      order: 0,
      styles: {},
      contextStyles: {},
      createdAt: 0,
      updatedAt: 0,
    }
    const plan = buildImportPlan({
      fileMap: twoPageFileMap(
        '.btn { color: red; }',
        '.btn { color: blue; }',
      ),
      currentSite: site,
    })

    expect(plan.conflicts.crossSheetClasses[0].defaultResolution.resolvedName).toBe('btn-3')
  })
})

// ---------------------------------------------------------------------------
// Keep-as-stylesheet mode
// ---------------------------------------------------------------------------

describe('stylesheet mode: file', () => {
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" href="css/style.css">
  </head><body>
    <div class="spec-cell">Cell</div>
  </body></html>`

  function fileModeMap(css: string, extra: FileMap['files'] = {}): FileMap {
    return {
      files: {
        'index.html': { bytes: encoder.encode(html), mimeType: 'text/html' },
        'css/style.css': { bytes: encoder.encode(css), mimeType: 'text/css' },
        ...extra,
      },
    }
  }

  it('keeps the sheet verbatim and skips all semantic extraction', () => {
    const css = `:root { --bg: #101014; }\n.spec-cell { color: var(--bg); }\n* { box-sizing: border-box; }`
    const plan = buildImportPlan({
      fileMap: fileModeMap(css),
      currentSite: makeEmptySiteDocument(),
      options: { stylesheetModes: { 'css/style.css': 'file' } },
    })

    expect(plan.linkedStylesheets).toEqual([
      { path: 'css/style.css', mode: 'file', pageSources: ['index.html'] },
    ])
    expect(plan.stylesheets).toHaveLength(1)
    expect(plan.stylesheets[0].path).toBe('css/style.css')
    expect(plan.stylesheets[0].pageSources).toEqual(['index.html'])
    // Verbatim: no rules, no tokens, no scope classes — the file is the truth.
    expect(plan.stylesheets[0].content).toContain('.spec-cell { color: var(--bg); }')
    expect(plan.styleRules).toHaveLength(0)
    expect(plan.colors).toHaveLength(0)
    expect(plan.conflicts.crossSheetClasses).toHaveLength(0)
    // The page no longer treats the sheet as a converted cascade…
    expect(plan.pages[0].linkedCssPaths).toEqual([])
    // …but the sheet is used, not "unused CSS".
    expect(plan.unusedCss).toHaveLength(0)
    // Node class tokens stay — commit auto-creates bare classes for them.
    const tokens = Object.values(plan.pages[0].nodeFragment.nodes).flatMap((n) => n.classIds ?? [])
    expect(tokens).toContain('spec-cell')
  })

  it('normalises url() payloads to FileMap keys and registers the assets', () => {
    const css = `.hero { background-image: url('../img/bg.png'); }`
    const plan = buildImportPlan({
      fileMap: fileModeMap(css, {
        'img/bg.png': { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
      }),
      currentSite: makeEmptySiteDocument(),
      options: { stylesheetModes: { 'css/style.css': 'file' } },
    })

    expect(plan.stylesheets[0].content).toContain(`url('img/bg.png')`)
    expect(plan.assets.some((a) => a.sourcePath === 'img/bg.png')).toBe(true)
  })

  it('flattens the local @import graph in cascade order and strips Google imports', () => {
    const css = `@import url("https://fonts.googleapis.com/css2?family=Manrope:wght@400&display=swap");\n@import "base.css";\n.spec-cell { color: red; }`
    const plan = buildImportPlan({
      fileMap: fileModeMap(css, {
        'css/base.css': { bytes: encoder.encode('body { margin: 0; }'), mimeType: 'text/css' },
      }),
      currentSite: makeEmptySiteDocument(),
      options: { stylesheetModes: { 'css/style.css': 'file' } },
    })

    const content = plan.stylesheets[0].content
    // Imported file's text lands BEFORE the importer's own rules.
    expect(content.indexOf('margin: 0')).toBeLessThan(content.indexOf('.spec-cell'))
    expect(content).not.toContain('@import')
    expect(plan.googleFonts.map((f) => f.family)).toEqual(['Manrope'])
    expect(plan.unusedCss).toHaveLength(0)
  })

  it('converted sheets are unaffected by another sheet being kept', () => {
    const pageTwo = `<!doctype html><html><head>
      <link rel="stylesheet" href="css/other.css">
    </head><body><p class="lead">Hi</p></body></html>`
    const plan = buildImportPlan({
      fileMap: fileModeMap('.spec-cell { color: red; }', {
        'two.html': { bytes: encoder.encode(pageTwo), mimeType: 'text/html' },
        'css/other.css': { bytes: encoder.encode('.lead { font-size: 18px; }'), mimeType: 'text/css' },
      }),
      currentSite: makeEmptySiteDocument(),
      options: { stylesheetModes: { 'css/style.css': 'file' } },
    })

    expect(plan.stylesheets.map((s) => s.path)).toEqual(['css/style.css'])
    expect(plan.styleRules.some((r) => r.kind === 'class' && r.name === 'lead')).toBe(true)
    expect(plan.styleRules.some((r) => r.name === 'spec-cell')).toBe(false)
    expect(plan.linkedStylesheets).toEqual([
      { path: 'css/style.css', mode: 'file', pageSources: ['index.html'] },
      { path: 'css/other.css', mode: 'convert', pageSources: ['two.html'] },
    ])
  })
})

// ---------------------------------------------------------------------------
// Cross-sheet renames must never half-apply
//
// Regression shapes from the August 20 2026 re-imports:
//
//   890capital.com — `#section-2-15 > .ct-section-inner-wrap { padding-top:184px }`
//   is the hero's top padding. It is a class-kind rule (the binding class is
//   the rightmost one), so the conflict resolver treated it as a fragment of
//   the `ct-section-inner-wrap` DEFINITION: its divergence from the other
//   pages' scoped rules invented a conflict, and resolving that conflict
//   deleted the rule and flattened its padding onto the bare class. The header
//   content sat 184px too high and every other inner wrap on the page gained
//   padding it never had.
//
//   amongworlds.com — `.cnvs-block-posts-1649131008311 .cs-entry__title-wrapper
//   { color:#FFFFFF !important }` scopes white text to one block. Flattened
//   onto the bare class it painted every post title white.
//
// A selector that only matches inside some ancestor is not part of the class's
// definition: it lives in the registry under its own selector and cannot
// clobber anything. Only `.name`, `.name:hover`, `.name::before` — the
// selectors that apply wherever the class is used — compete for the one global
// name.
// ---------------------------------------------------------------------------

function sharedSheetFileMap(shared: string, cssA: string, cssB: string, bodyB?: string): FileMap {
  const page = (cssHref: string, body: string) => `<!doctype html><html><head>
    <link rel="stylesheet" href="css/shared.css">
    <link rel="stylesheet" href="${cssHref}">
  </head><body>${body}</body></html>`
  const bodyA = '<section id="section-2"><div class="ct-section-inner-wrap">A</div></section>'
  return {
    files: {
      'index.html': { bytes: encoder.encode(page('css/a.css', bodyA)), mimeType: 'text/html' },
      'original.html': {
        bytes: encoder.encode(page('css/b.css', bodyB ?? bodyA)),
        mimeType: 'text/html',
      },
      'css/shared.css': { bytes: encoder.encode(shared), mimeType: 'text/css' },
      'css/a.css': { bytes: encoder.encode(cssA), mimeType: 'text/css' },
      'css/b.css': { bytes: encoder.encode(cssB), mimeType: 'text/css' },
    },
  }
}

/** Every rule in `rules` whose selector matches `el`, as declaration bags. */
function matchedStyles(
  rules: readonly ImportPlan['styleRules'][number][],
  el: Element,
): string[] {
  const matched: string[] = []
  for (const rule of rules) {
    if (typeof rule.rawCss === 'string') continue
    let hit = false
    try {
      hit = el.matches(rule.selector)
    } catch {
      hit = false
    }
    if (hit) matched.push(JSON.stringify(rule.styles))
  }
  return matched.sort()
}

function elementFrom(html: string, selector: string): Element {
  const doc = document.implementation.createHTMLDocument('t')
  doc.body.innerHTML = html
  const el = doc.querySelector(selector)
  if (!el) throw new Error(`fixture element ${selector} not found`)
  return el
}

describe('cross-sheet class conflicts — scoped selectors', () => {
  it('does not treat an id-scoped rule as part of the class definition', () => {
    const plan = buildImportPlan({
      fileMap: sharedSheetFileMap(
        '.ct-section-inner-wrap { max-width: 1440px; padding-top: 75px; }',
        '#section-2 > .ct-section-inner-wrap { padding-top: 184px; }',
        '#section-9 > .ct-section-inner-wrap { padding-top: 60px; }',
      ),
      currentSite: makeEmptySiteDocument(),
    })

    // The bare definition is identical in both cascades, so nothing conflicts.
    expect(plan.conflicts.crossSheetClasses).toHaveLength(0)

    const resolved = resolveWithDefaults(plan)
    const selectors = resolved.styleRules.map((rule) => rule.selector)
    expect(selectors).toContain('#section-2 > .ct-section-inner-wrap')
    expect(selectors).toContain('#section-9 > .ct-section-inner-wrap')

    // 184px stays on the scoped rule and never leaks onto the bare class.
    const scoped = resolved.styleRules.find((r) => r.selector === '#section-2 > .ct-section-inner-wrap')
    expect(scoped?.styles.paddingTop).toBe('184px')
    const bare = resolved.styleRules.find(
      (r) => r.kind === 'class' && r.name === 'ct-section-inner-wrap',
    )
    expect(bare?.styles.paddingTop).toBe('75px')
  })

  it('keeps a scoped !important override off the bare class when renaming', () => {
    const plan = buildImportPlan({
      fileMap: sharedSheetFileMap(
        '.cs-entry__title-wrapper { color: #333333; }',
        '.cs-entry__title-wrapper:hover { color: #eeeeee; }',
        // The scoped override is the FIRST rule naming the class in this sheet,
        // so it is the sheet's class-kind rule — exactly the shape that made
        // the resolver treat it as the class's own definition.
        '.cnvs-block-posts-1649131008311 .cs-entry__title-wrapper { color: #ffffff !important; }'
        + ' .cs-entry__title-wrapper:hover { color: #000000; }',
      ),
      currentSite: makeEmptySiteDocument(),
    })

    // The `:hover` definitions really do diverge — that IS a conflict.
    expect(plan.conflicts.crossSheetClasses).toHaveLength(1)
    const resolved = resolveWithDefaults(plan)

    const renamed = resolved.styleRules.find(
      (r) => r.kind === 'class' && r.name === 'cs-entry__title-wrapper-2',
    )
    expect(renamed).toBeDefined()
    expect(renamed?.styles.color).not.toBe('#ffffff')

    // The scoped rule survives, renamed in lockstep.
    const scoped = resolved.styleRules.find((r) =>
      r.selector.startsWith('.cnvs-block-posts-1649131008311 '),
    )
    expect(scoped?.selector).toBe(
      '.cnvs-block-posts-1649131008311 .cs-entry__title-wrapper-2',
    )
    expect(scoped?.styles.color).toBe('#ffffff')
  })

  it('rewrites every selector that reaches a renamed page', () => {
    const bodyB = '<div id="hero" class="wrap"><a class="btn" href="#">Buy</a></div>'
    const fileMap = sharedSheetFileMap(
      '.btn { color: #111111; }',
      '.btn { border-radius: 0; }',
      '#hero > .btn { padding: 20px 32px; }'
      + ' .btn:hover { color: red; }'
      + ' .wrap .btn { margin: 4px; }',
      bodyB,
    )
    const plan = buildImportPlan({ fileMap, currentSite: makeEmptySiteDocument() })
    expect(plan.conflicts.crossSheetClasses).toHaveLength(1)

    const pageBPaths = new Set(
      plan.pages.find((p) => p.source === 'original.html')!.linkedCssPaths,
    )
    const reachesPageB = plan.styleRules.filter((_, index) =>
      pageBPaths.has(plan.styleRuleSources[index]),
    )

    const before = matchedStyles(reachesPageB, elementFrom(bodyB, 'a.btn'))
    expect(before.length).toBeGreaterThan(0)

    const resolved = resolveWithDefaults(plan)
    const pageB = resolved.pages.find((p) => p.source === 'original.html')!
    const tokens = Object.values(pageB.nodeFragment.nodes).flatMap((n) => n.classIds ?? [])
    expect(tokens).toContain('btn-2')

    // The element as it will be published: same markup, renamed class.
    const after = matchedStyles(
      resolved.styleRules,
      elementFrom(bodyB.replace('class="btn"', 'class="btn-2"'), 'a.btn-2'),
    )

    // Every declaration bag that reached this element before the rename still
    // reaches it after. Nothing was dropped, and nothing half-renamed.
    for (const styles of before) expect(after).toContain(styles)
  })

  it('falls back to keep-first when a shared sheet scopes the class', () => {
    const plan = buildImportPlan({
      fileMap: sharedSheetFileMap(
        '.btn { color: #111111; } #hero > .btn { padding: 20px 32px; }',
        '.btn { border-radius: 0; }',
        '.btn { border-radius: 999px; }',
        '<div id="hero"><a class="btn" href="#">Buy</a></div>',
      ),
      currentSite: makeEmptySiteDocument(),
    })
    expect(plan.conflicts.crossSheetClasses).toHaveLength(1)

    const resolved = resolveWithDefaults(plan)

    // `#hero > .btn` lives in the sheet BOTH cascades load, so it cannot follow
    // the rename without breaking the page that keeps the old name. Renaming
    // anyway would publish `class="btn-2"` with a rule still asking for `.btn`.
    expect(resolved.styleRules.some((r) => r.name === 'btn-2')).toBe(false)
    expect(resolved.styleRules.map((r) => r.selector)).toContain('#hero > .btn')

    const pageB = resolved.pages.find((p) => p.source === 'original.html')!
    const tokens = Object.values(pageB.nodeFragment.nodes).flatMap((n) => n.classIds ?? [])
    expect(tokens).toContain('btn')
    expect(tokens).not.toContain('btn-2')
  })
})
