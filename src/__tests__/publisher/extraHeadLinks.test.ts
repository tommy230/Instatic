/**
 * `settings.extraHeadLinks` — operator-configured `<link>` tags in the
 * published `<head>`, plus the CSP origins they and vendor-hosted font faces
 * imply.
 *
 * Motivating case: an Adobe Fonts (Typekit) kit. The kit stylesheet is
 * account-scoped and cannot be bundled, and the faces it declares are served
 * from the vendor. Both facts live outside the page body, so neither the body
 * HTML scan nor the asset importer can produce them — if the publisher does not
 * derive them, the page emits a stylesheet its own policy then blocks.
 */
import { describe, it, expect } from 'bun:test'
import { publishPage } from '@core/publisher'
import { makeModule, makeRegistry, makePage, makeSite } from './helpers'
import type { SiteDocument } from '@core/page-tree'

const KIT_CSS_URL = 'https://use.typekit.net/abc1def.css'
const KIT_FACE_URL = 'https://use.typekit.net/af/a3a591/000000003b9adf16/27/l?fvd=n4&v=3'

function publish(site: SiteDocument): { html: string; csp: string } {
  const page = makePage({ root: { moduleId: 'test.plain', props: {} } })
  const reg = makeRegistry({ 'test.plain': makeModule('test.plain') })
  const { html } = publishPage(page, site, reg)
  const csp = html.match(/content="([^"]*)"[^>]*>/)?.[0] ?? ''
  const meta = html.match(
    /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/,
  )
  return { html, csp: meta?.[1] ?? csp }
}

function siteWithKit(): SiteDocument {
  const site = makeSite()
  site.settings.extraHeadLinks = [
    { rel: 'preconnect', href: 'https://use.typekit.net', crossorigin: '' },
    { rel: 'stylesheet', href: KIT_CSS_URL },
  ]
  site.settings.fonts = {
    items: [
      {
        id: 'rift',
        source: 'custom',
        family: 'rift',
        variants: ['400'],
        subsets: ['latin'],
        files: [
          {
            variant: '400',
            subset: 'latin',
            path: KIT_FACE_URL,
            format: 'woff2',
            external: true,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  }
  return site
}

describe('publisher — extraHeadLinks configured', () => {
  it('emits the link tags in head and permits their origin in the CSP', () => {
    const { html, csp } = publish(siteWithKit())

    expect(html).toContain(`<link rel="stylesheet" href="${KIT_CSS_URL}">`)
    expect(html).toContain('<link rel="preconnect" href="https://use.typekit.net" crossorigin>')
    // Head links land inside <head>, before the closing tag.
    expect(html.indexOf(KIT_CSS_URL)).toBeLessThan(html.indexOf('</head>'))

    // The kit stylesheet origin is allowed as a style origin AND a font origin
    // (the faces it declares come from there), and the face URL already in
    // framework.css contributes font-src on its own.
    expect(csp).toMatch(/style-src[^;]*https:\/\/use\.typekit\.net/)
    expect(csp).toMatch(/font-src[^;]*https:\/\/use\.typekit\.net/)
    // font-src is created by this pass, so 'self' must be restored — otherwise
    // the site's own /uploads/fonts faces stop loading.
    expect(csp).toMatch(/font-src[^;]*'self'/)
    expect(csp).toMatch(/style-src[^;]*'self'/)
  })

  it('emits the face origin in font-src even with no head link configured', () => {
    const site = siteWithKit()
    delete site.settings.extraHeadLinks
    const { html, csp } = publish(site)

    expect(html).not.toContain(KIT_CSS_URL)
    expect(csp).toMatch(/font-src[^;]*https:\/\/use\.typekit\.net/)
    expect(csp).toMatch(/font-src[^;]*'self'/)
  })

  it('drops a link whose rel could execute or whose href is unsafe', () => {
    const site = makeSite()
    site.settings.extraHeadLinks = [
      { rel: 'import', href: 'https://evil.example.com/x.html' },
      { rel: 'stylesheet', href: 'javascript:alert(1)' },
      {
        rel: 'stylesheet',
        href: 'https://ok.example.com/a.css"><script src="https://evil.example.com/x.js"></script>',
      },
    ]
    const { html, csp } = publish(site)

    expect(html).not.toContain('evil.example.com')
    expect(html).not.toContain('javascript:alert')
    // The injection attempt is escaped, not emitted as markup.
    expect(html).not.toContain('<script src=')
    expect(csp).not.toContain('evil.example.com')
  })
})

describe('publisher — extraHeadLinks unconfigured', () => {
  it('adds no link tag and no font/style origin', () => {
    const { html, csp } = publish(makeSite())

    expect(html).not.toContain('typekit')
    expect(html).not.toContain('<link rel="stylesheet" href="https://')
    expect(csp).not.toContain('typekit')
    // font-src is never created out of nothing — default-src 'self' still governs.
    expect(csp).not.toContain('font-src')
  })
})
