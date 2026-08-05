import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { copyPassthroughAssets } from '../../../server/publish/passthroughAssets'

function stage(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'passthrough-'))
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

describe('copyPassthroughAssets', () => {
  it('copies staged files into the slot at their site-relative path', async () => {
    // LayerSlider builds `<skinsPath><skin>/skin.css` at runtime and waits for
    // it; the path has to answer from the site's own origin.
    const source = stage({
      'wp-content/plugins/LayerSlider/assets/static/layerslider/skins/borderlessdark/skin.css':
        '.ls-borderlessdark{}',
      'wp-content/uploads/2017/05/Spectrum-Logo_Color.png': 'PNGDATA',
    })
    const slot = mkdtempSync(join(tmpdir(), 'slot-'))

    const result = await copyPassthroughAssets(slot, source)

    expect(result.copied).toHaveLength(2)
    const skin = join(
      slot,
      'wp-content/plugins/LayerSlider/assets/static/layerslider/skins/borderlessdark/skin.css',
    )
    expect(existsSync(skin)).toBe(true)
    expect(readFileSync(skin, 'utf-8')).toBe('.ls-borderlessdark{}')
    expect(existsSync(join(slot, 'wp-content/uploads/2017/05/Spectrum-Logo_Color.png'))).toBe(true)
  })

  it('never overwrites a baked page artefact', async () => {
    // A route is the site; a staged file is not.
    const source = stage({ 'about-us.html': 'STAGED' })
    const slot = mkdtempSync(join(tmpdir(), 'slot-'))
    writeFileSync(join(slot, 'about-us.html'), 'BAKED')

    const result = await copyPassthroughAssets(slot, source)

    expect(result.copied).toEqual([])
    expect(result.shadowed).toEqual(['about-us.html'])
    expect(readFileSync(join(slot, 'about-us.html'), 'utf-8')).toBe('BAKED')
  })

  it('refuses the namespaces the publisher owns', async () => {
    const source = stage({
      '_instatic/css/style.css': 'x',
      'uploads/thing.png': 'x',
      'wp-content/ok.css': 'x',
    })
    const slot = mkdtempSync(join(tmpdir(), 'slot-'))

    const result = await copyPassthroughAssets(slot, source)

    expect(result.copied).toEqual(['wp-content/ok.css'])
    expect(result.reserved.sort()).toEqual(['_instatic/css/style.css', 'uploads/thing.png'])
    expect(existsSync(join(slot, '_instatic/css/style.css'))).toBe(false)
  })

  it('is a no-op when nothing is staged', async () => {
    const slot = mkdtempSync(join(tmpdir(), 'slot-'))

    expect(await copyPassthroughAssets(slot, undefined)).toEqual({
      copied: [],
      shadowed: [],
      reserved: [],
    })
    expect(await copyPassthroughAssets(slot, join(tmpdir(), 'does-not-exist-at-all'))).toEqual({
      copied: [],
      shadowed: [],
      reserved: [],
    })
  })

  it('copies again on a republish, so a restaged file lands', async () => {
    const source = stage({ 'wp-content/a.css': 'v1' })
    const first = mkdtempSync(join(tmpdir(), 'slot-'))
    await copyPassthroughAssets(first, source)

    writeFileSync(join(source, 'wp-content/a.css'), 'v2')
    const second = mkdtempSync(join(tmpdir(), 'slot-'))
    await copyPassthroughAssets(second, source)

    expect(readFileSync(join(second, 'wp-content/a.css'), 'utf-8')).toBe('v2')
  })
})
