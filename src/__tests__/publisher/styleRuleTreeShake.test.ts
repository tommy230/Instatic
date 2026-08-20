import { describe, it, expect } from 'bun:test'
import {
  collectScriptClassNameTokens,
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
