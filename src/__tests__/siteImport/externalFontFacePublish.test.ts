/**
 * Vendor-hosted @font-face survives the whole import → publish path.
 *
 * redrockscafe.com serves its headings from an Adobe Typekit kit. Every stage
 * of the importer parsed those faces correctly, but the published CSS came out
 * with zero `rift` faces: both the storage boundary (`parseSiteFontsSettings`)
 * and the CSS boundary (`generateSiteFontsCss`) rejected an `https://` src that
 * carried no `mediaAssetId`, because the no-CDN rule predates the case where a
 * face legally cannot be rehosted.
 *
 * These tests pin the full chain with kit-shaped CSS, so a future tightening of
 * the font-src rule cannot silently drop the faces again.
 */
import { describe, expect, it } from 'bun:test'
import { cssToStyleRules } from '@core/siteImport/cssToStyleRules'
import { buildAssetPlan, type CssFileResult } from '@core/siteImport/assetPlan'
import { parseSiteFontsSettings } from '@core/fonts'
import { buildSiteFrameworkCss } from '@core/publisher'
import { addImportedFonts } from '@admin/pages/site/store/slices/site/importedFonts'
import { parseSiteDocument, type SiteDocument } from '@core/page-tree'
import { makeEmptySiteDocument } from './mockSite'

/** Shaped exactly like the faces in the live redrockscafe kit: quoted family,
 *  three extensionless vendor URLs, format() as the only type statement. */
const KIT_CSS = `
@font-face {
font-family:"rift";
src:url("https://use.typekit.net/af/a3a591/00000000000000003b9adf16/27/l?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n4&v=3") format("woff2"),url("https://use.typekit.net/af/a3a591/00000000000000003b9adf16/27/d?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n4&v=3") format("woff"),url("https://use.typekit.net/af/a3a591/00000000000000003b9adf16/27/a?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n4&v=3") format("opentype");
font-display:auto;font-style:normal;font-weight:400;font-stretch:normal;
}
@font-face {
font-family:"rift";
src:url("https://use.typekit.net/af/b1b1b1/00000000000000003b9adf17/27/l?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n7&v=3") format("woff2");
font-display:auto;font-style:normal;font-weight:700;font-stretch:normal;
}
`

function planFonts(css: string) {
  const { fontFaces } = cssToStyleRules(css)
  const cssFileResults: CssFileResult[] = [
    { cssPath: 'assets/kit.css', rules: [], assetRefs: [], fontFaces },
  ]
  // Empty FileMap: a kit is fetched from the vendor, never bundled with the
  // scraped site, so nothing local can back these faces.
  return buildAssetPlan([], cssFileResults, { files: {} })
}

/** Import into a site the way commitPlan does, then round-trip through the
 *  storage schema so the test sees exactly what a reloaded site would hold. */
function importAndReload(fonts: ReturnType<typeof planFonts>['fonts']): SiteDocument {
  const site = makeEmptySiteDocument()
  site.settings = { ...site.settings, fonts: { items: [] } }
  addImportedFonts(site as never, fonts)
  const reloaded = parseSiteFontsSettings(site.settings.fonts)
  return { ...site, settings: { ...site.settings, fonts: reloaded ?? { items: [] } } }
}

describe('vendor-hosted @font-face → published CSS', () => {
  it('keeps both rift variants as absolute typekit srcs through plan, storage and publish', () => {
    const { fonts, warnings } = planFonts(KIT_CSS)

    const rift = fonts.find((f) => f.family.toLowerCase() === 'rift')
    expect(rift).toBeDefined()
    // woff2 wins the format race even though no URL carries an extension —
    // the declared format() hint is the only signal.
    expect(rift!.files.map((f) => f.variant).sort()).toEqual(['400', '700'])
    for (const file of rift!.files) {
      expect(file.format).toBe('woff2')
      expect(file.src.startsWith('https://use.typekit.net/af/')).toBe(true)
    }
    // Kept, and still reported as a cutover dependency.
    expect(warnings.some((w) => w.kind === 'external-font')).toBe(true)

    const site = importAndReload(fonts)

    // Storage boundary keeps the files, marked external.
    const entry = site.settings.fonts!.items.find((f) => f.family.toLowerCase() === 'rift')
    expect(entry).toBeDefined()
    expect(entry!.files).toHaveLength(2)
    expect(entry!.files.every((f) => f.external === true)).toBe(true)

    // CSS boundary: the published framework.css carries both faces verbatim.
    const published = buildSiteFrameworkCss(site)
    const riftFaces = published
      .split('@font-face')
      .filter((block) => /font-family:\s*"rift"/.test(block))
    expect(riftFaces).toHaveLength(2)
    for (const block of riftFaces) {
      expect(block).toContain('src: url("https://use.typekit.net/af/')
      expect(block).toContain('format("woff2")')
    }
    expect(published).toContain('font-weight: 400')
    expect(published).toContain('font-weight: 700')
  })

  it('leaves operator-configured extraHeadLinks untouched across an import', () => {
    const site = makeEmptySiteDocument()
    const links = [{ rel: 'stylesheet', href: 'https://use.typekit.net/abc1def.css' }]
    site.settings = { ...site.settings, fonts: { items: [] }, extraHeadLinks: links }

    const { fonts } = planFonts(KIT_CSS)
    addImportedFonts(site as never, fonts)

    // A re-import adds faces; the head link is operator state and survives
    // byte-identical (an import must never add, drop, or rewrite one).
    expect(site.settings.extraHeadLinks).toEqual(links)
    expect(parseSiteDocument(site).settings.extraHeadLinks).toEqual(links)
  })

  it('still refuses an https font src that no importer marked external', () => {
    const site = makeEmptySiteDocument()
    site.settings = {
      ...site.settings,
      fonts: {
        items: [
          {
            id: 'forged',
            source: 'custom',
            family: 'Forged',
            variants: ['400'],
            subsets: ['latin'],
            files: [
              {
                variant: '400',
                subset: 'latin',
                path: 'https://evil.example.com/x.woff2',
                format: 'woff2',
              },
            ],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    }
    // Dropped at the storage boundary (the entry survives, faceless) …
    const reloaded = parseSiteFontsSettings(site.settings.fonts)
    expect(reloaded?.items.find((f) => f.family === 'Forged')?.files).toEqual([])
    // … and again at the CSS boundary, if a corrupted document skips storage.
    expect(buildSiteFrameworkCss(site)).not.toContain('evil.example.com')
  })
})
