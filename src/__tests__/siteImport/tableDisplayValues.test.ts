/**
 * Internal table display values survive the CSS parser.
 *
 * BUG G. happy-dom 20.9.0 validates `display` against an allowlist that has
 * `table`, `table-row` and `list-item` but not `table-cell` or any other
 * internal table display type. A value outside the list is not a parse error —
 * the whole declaration is dropped, silently, before any importer code sees the
 * rule. Everything else in the same block survives, so nothing looks wrong.
 *
 * Measured on ecolorworld.com: `.footer_bottom { display: table-cell; … }`
 * imported with its font-size, line-height, height, width and vertical-align
 * intact and no display at all, so the footer rendered as `block`, its
 * paragraph wrapped, and the footer stood 202px taller than production
 * (1081 vs 879 at a 390px viewport).
 *
 * Fixed by patching the allowlist (`patches/happy-dom@20.9.0.patch`). This test
 * fails if the patch is dropped by a lockfile change or a happy-dom upgrade
 * that reintroduces the gap — which would resume losing the declarations
 * silently on every legacy table-layout site in the fleet.
 */
import { describe, expect, it } from 'bun:test'
import { cssToStyleRules } from '@core/siteImport'

/** Every internal table display type, plus the two the upstream list had. */
const TABLE_DISPLAY_VALUES = [
  'table',
  'table-cell',
  'table-row',
  'table-row-group',
  'table-header-group',
  'table-footer-group',
  'table-column',
  'table-column-group',
  'table-caption',
  'inline-table',
]

describe('table display values survive import', () => {
  it.each(TABLE_DISPLAY_VALUES)('keeps display: %s', (value) => {
    const { rules } = cssToStyleRules(`.a { display: ${value} }`)
    expect(rules).toHaveLength(1)
    expect(rules[0].styles).toMatchObject({ display: value })
  })

  it('keeps display alongside the rest of a legacy table-cell block', () => {
    // The exact ecolorworld.com footer rule.
    const { rules } = cssToStyleRules(
      '.footer_bottom { display: table-cell; font-size: 12px; line-height: 22px; height: 53px; width: 1%; vertical-align: middle }',
    )
    expect(rules[0].styles).toMatchObject({
      display: 'table-cell',
      fontSize: '12px',
      height: '53px',
      width: '1%',
      verticalAlign: 'middle',
    })
  })

  it('still refuses a value that is not a display type', () => {
    const { rules } = cssToStyleRules('.a { display: tabel-cell }')
    expect(rules[0]?.styles.display).toBeUndefined()
  })
})
