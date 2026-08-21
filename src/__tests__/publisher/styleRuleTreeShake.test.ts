import { describe, it, expect } from 'bun:test'
import {
  collectScriptClassNameTokens,
  scriptCanAddClassName,
  treeShakeStyleRules,
} from '@core/publisher'
import type { StyleRule } from '@core/page-tree'

// ---------------------------------------------------------------------------
// treeShakeStyleRules — runtime (script-added) class handling
//
// Regression shape from arcadiabuilt.com: the theme hides masked headings via
// `.masked-wrapper .masked-row { transform: translate3d(0,100%,0) }` and
// reveals them when jquery.in-viewport-class.js adds `in-viewport-once` on
// scroll. `in-viewport-once` is never on a node in the imported document, so
// pure id-based shaking dropped the reveal rule and published pages kept the
// text permanently hidden behind the overflow mask.
// ---------------------------------------------------------------------------

const rule = (
  id: string,
  name: string,
  selector: string,
  styles: Record<string, string>,
): StyleRule =>
  ({
    id,
    name,
    kind: 'class',
    selector,
    styles,
    contextStyles: {},
    order: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as StyleRule

// `animate` is on nodes (its id is used); `in-viewport-once` exists only in
// the shipped script; `dead-class` appears nowhere outside the stylesheet.
const styleRules: Record<string, StyleRule> = {
  r1: rule('r1', 'masked-row', '.masked-wrapper .masked-row', {
    transform: 'translate3d(0,100%,0)',
  }),
  r2: rule('r2', 'animate', '.masked-wrapper.in-viewport-once .animate', {
    transform: 'translate3d(0,0,0)',
  }),
  r3: rule('r3', 'in-viewport-once', '.pch-content.in-viewport.in-viewport-once', {
    opacity: '1',
  }),
  r4: rule('r4', 'dead-class', '.dead-class .masked-row', { color: 'red' }),
  r5: rule('r5', 'in-viewport', '.in-viewport', { visibility: 'visible' }),
}

const usedIds = new Set(['r1', 'r2'])

const scriptFiles = [
  {
    type: 'script' as const,
    content:
      "opts = { inViewClass: 'in-viewport', onceInViewClass: 'in-viewport-once' };" +
      " $element.addClass(opts.onceInViewClass);",
  },
]

describe('collectScriptClassNameTokens', () => {
  it('extracts class-name-shaped tokens from script files only', () => {
    const tokens = collectScriptClassNameTokens([
      ...scriptFiles,
      { type: 'style' as const, content: '.style-only-token { color: red }' },
      { type: 'script' as const, content: undefined },
    ])
    expect(tokens.has('in-viewport')).toBe(true)
    expect(tokens.has('in-viewport-once')).toBe(true)
    expect(tokens.has('style-only-token')).toBe(false)
  })

  it('returns an empty set for missing files', () => {
    expect(collectScriptClassNameTokens(undefined).size).toBe(0)
  })
})

describe('treeShakeStyleRules with runtime class names', () => {
  const runtime = collectScriptClassNameTokens(scriptFiles)
  const shaken = treeShakeStyleRules(styleRules, usedIds, runtime)

  it('keeps a used rule whose selector depends on a script-added class', () => {
    // Dropped before the fix: `in-viewport-once` was known-but-unused.
    expect(shaken.r2).toBeDefined()
  })

  it('keeps an unassigned rule whose own class is script-added', () => {
    expect(shaken.r3).toBeDefined()
    expect(shaken.r5).toBeDefined()
  })

  it('still drops rules depending on classes absent from nodes and scripts', () => {
    expect(shaken.r4).toBeUndefined()
  })

  it('keeps plainly used rules', () => {
    expect(shaken.r1).toBeDefined()
  })

  it('without runtime names, behaves as before (reveal rules dropped)', () => {
    const idOnly = treeShakeStyleRules(styleRules, usedIds)
    expect(idOnly.r1).toBeDefined()
    expect(idOnly.r2).toBeUndefined()
    expect(idOnly.r3).toBeUndefined()
    expect(idOnly.r4).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// treeShakeStyleRules — classes the scripts ASSEMBLE, renamed copies of them,
// and selectors that name no class at all.
//
// Regression shape from 890capital.com: unslider builds its state classes from
// a prefix (`e._` is "unslider", `e.prefix` is `e._ + "-"`, the class arrives
// as `addClass(e.prefix + "carousel")`), so `unslider-carousel` appears nowhere
// in the shipped file. Verbatim token matching treated it as a class no node
// carries and dropped `.unslider-wrap.unslider-carousel > li`, whose `float` is
// the only thing laying the slides out — the published slider rendered empty.
// ---------------------------------------------------------------------------

const ambient = (id: string, selector: string): StyleRule =>
  ({
    id,
    name: selector,
    kind: 'ambient',
    selector,
    styles: { float: 'left' },
    contextStyles: {},
    order: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as StyleRule

describe('treeShakeStyleRules — runtime classes the scripts assemble', () => {
  const unsliderRules: Record<string, StyleRule> = {
    // Bare dependency entries the importer mints for selector-only classes.
    c1: rule('c1', 'unslider-wrap', '.unslider-wrap', {}),
    c2: rule('c2', 'unslider-carousel', '.unslider-carousel', {}),
    c3: rule('c3', 'aos-animate-2', '.aos-animate-2', { opacity: '1' }),
    c4: rule('c4', 'never-touched', '.never-touched', { color: 'red' }),
    a1: ambient('a1', '#slider-421 .unslider-wrap.unslider-carousel > li'),
    a2: ambient('a2', '.ct-video > .oxygen-vsb-responsive-video-wrapper > iframe'),
    a3: ambient('a3', '[data-oxy-video] > iframe'),
    a4: ambient('a4', '.never-touched > li'),
    a5: ambient('a5', '.aos-animate-2 .fade-target'),
  }
  // `ct-video` and `oxygen-vsb-responsive-video-wrapper` are real markup, so
  // their rules are assigned; nothing else is.
  const videoWrapper = rule('c5', 'ct-video', '.ct-video', {})
  const videoInner = rule(
    'c6',
    'oxygen-vsb-responsive-video-wrapper',
    '.oxygen-vsb-responsive-video-wrapper',
    {},
  )
  const fadeTarget = rule('c7', 'fade-target', '.fade-target', {})
  const allRules = { ...unsliderRules, c5: videoWrapper, c6: videoInner, c7: fadeTarget }
  const assigned = new Set(['c5', 'c6', 'c7'])

  const scripts = [
    {
      type: 'script' as const,
      // Verbatim: nothing. Assembled: prefix "unslider" + "wrap" / "carousel".
      content:
        'e._="unslider",e.prefix=e._+"-";'
        + 'e.$container.addClass(e.prefix+"wrap").addClass(e.prefix+"carousel");'
        + 'el.classList.add("aos-animate");',
    },
  ]
  const runtime = collectScriptClassNameTokens(scripts)
  const shaken = treeShakeStyleRules(allRules, assigned, runtime)

  it('keeps a rule whose classes the script assembles from a prefix', () => {
    expect(shaken.a1).toBeDefined()
  })

  it('keeps a rule whose only class was renamed from a script-added class', () => {
    // Cross-sheet auto-rename turns `aos-animate` into `aos-animate-2`; AOS
    // still adds the unsuffixed name, so the renamed copy is reachable too.
    expect(shaken.c3).toBeDefined()
    expect(shaken.a5).toBeDefined()
  })

  it('keeps an assigned selector chain that ends in a bare element', () => {
    expect(shaken.a2).toBeDefined()
  })

  it('keeps an attribute-only selector that names no class', () => {
    expect(shaken.a3).toBeDefined()
  })

  it('still drops rules for a class no node and no script can produce', () => {
    expect(shaken.c4).toBeUndefined()
    expect(shaken.a4).toBeUndefined()
  })

  it('drops the assembled-class rules when no script ships', () => {
    const idOnly = treeShakeStyleRules(allRules, assigned)
    expect(idOnly.a1).toBeUndefined()
    expect(idOnly.a2).toBeDefined()
    expect(idOnly.a3).toBeDefined()
  })
})

describe('scriptCanAddClassName', () => {
  const tokens = new Set(['unslider', 'wrap', 'carousel', 'aos-animate', 'is', 'open'])

  it('accepts a verbatim name', () => {
    expect(scriptCanAddClassName('aos-animate', tokens)).toBe(true)
  })

  it('accepts a name both halves of which are script literals', () => {
    expect(scriptCanAddClassName('unslider-carousel', tokens)).toBe(true)
    expect(scriptCanAddClassName('is-open', tokens)).toBe(true)
  })

  it('rejects a name only one half of which is a script literal', () => {
    expect(scriptCanAddClassName('unslider-gallery', tokens)).toBe(false)
    expect(scriptCanAddClassName('menu-open', tokens)).toBe(false)
  })

  it('accepts an auto-renamed copy of a name it would accept', () => {
    expect(scriptCanAddClassName('aos-animate-2', tokens)).toBe(true)
    expect(scriptCanAddClassName('unslider-carousel-11', tokens)).toBe(true)
  })

  it('rejects an unrelated name', () => {
    expect(scriptCanAddClassName('never-touched', tokens)).toBe(false)
  })
})
