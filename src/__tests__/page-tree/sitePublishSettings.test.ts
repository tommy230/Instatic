/**
 * `settings.publish` — the publisher switches, today just
 * `treeShakeStyleRules`. Parsing must keep an explicit boolean, drop junk, and
 * leave the field absent when nothing usable was supplied.
 */
import { describe, it, expect } from 'bun:test'
import { parseSiteSettings } from '@core/page-tree'

describe('parseSiteSettings publish', () => {
  it('keeps an explicit treeShakeStyleRules boolean', () => {
    expect(parseSiteSettings({ publish: { treeShakeStyleRules: false } }).publish).toEqual({
      treeShakeStyleRules: false,
    })
    expect(parseSiteSettings({ publish: { treeShakeStyleRules: true } }).publish).toEqual({
      treeShakeStyleRules: true,
    })
  })

  it('leaves the field absent for missing or malformed input', () => {
    expect('publish' in parseSiteSettings({})).toBe(false)
    expect('publish' in parseSiteSettings({ publish: {} })).toBe(false)
    expect('publish' in parseSiteSettings({ publish: { treeShakeStyleRules: 'no' } })).toBe(false)
    expect('publish' in parseSiteSettings({ publish: [] })).toBe(false)
  })
})
