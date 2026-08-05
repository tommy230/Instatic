/**
 * Content-derived CSP (`src/core/publisher/cspDerivation.ts`).
 *
 * The gap this fleet locks in: classic-imported pages (WordPress / HTML
 * imports) carry third-party `<script src>` / `<iframe src>` markup that no
 * module declares `cspSources` for, so the strict base policy
 * (`script-src 'none'; frame-src 'none'`) killed every third-party embed on an
 * imported page. The publisher now derives those origins from the rendered
 * page HTML, expands them through a small provider-implication table, and
 * unions a per-site escape hatch — all into the SAME `CspPlan`, so the output
 * stays sorted and deterministic and a page referencing nothing external keeps
 * today's exact policy.
 */
import { describe, it, expect } from 'bun:test'
import {
  createBaseCspPlan,
  deriveCspSourcesFromHtml,
  publishPage,
  serializeCsp,
  siteConfiguredCspSources,
} from '@core/publisher'
import { makeModule, makeRegistry, makePage, makeSite } from './helpers'

function extractPublishedCsp(html: string): string {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)
  if (!m) throw new Error('no CSP meta found in published page')
  return m[1]!
}

/**
 * A registry whose single module emits the given raw HTML — the stand-in for a
 * classic-imported `base.container` subtree carrying third-party markup. The
 * HTML is closed over rather than passed as a prop because `escapeProps`
 * escapes prop values before `render()` sees them.
 */
function rawHtmlRegistry(html: string) {
  return makeRegistry({
    'test.raw': makeModule('test.raw', { render: () => ({ html }) }),
  })
}

function publishWithBody(html: string, site = makeSite()): string {
  const page = makePage({ root: { moduleId: 'test.raw' } })
  return extractPublishedCsp(publishPage(page, site, rawHtmlRegistry(html)).html)
}

// ---------------------------------------------------------------------------
// Derivation from markup
// ---------------------------------------------------------------------------

describe('deriveCspSourcesFromHtml — external script + iframe origins', () => {
  it('routes <script src> to script-src and <iframe src> to frame-src', () => {
    const derived = deriveCspSourcesFromHtml(
      '<script src="https://cdn.example.com/a/b.js"></script>' +
        '<iframe src="https://embed.example.org/e/1"></iframe>',
    )
    expect(derived).toEqual([
      { directive: 'frame-src', sources: ['https://embed.example.org'] },
      { directive: 'script-src', sources: ['https://cdn.example.com'] },
    ])
  })

  it('reduces a URL to its origin and keeps a non-default port', () => {
    const derived = deriveCspSourcesFromHtml(
      '<script src="https://cdn.example.com:8443/deep/path.js?v=2#x"></script>',
    )
    expect(derived).toEqual([
      { directive: 'script-src', sources: ['https://cdn.example.com:8443'] },
    ])
  })

  it('treats a scheme-relative src as https', () => {
    expect(deriveCspSourcesFromHtml('<script src="//cdn.example.com/a.js"></script>')).toEqual([
      { directive: 'script-src', sources: ['https://cdn.example.com'] },
    ])
  })

  it('ignores relative, same-origin, http and non-network schemes', () => {
    const derived = deriveCspSourcesFromHtml(
      '<script src="/_instatic/assets/x.js"></script>' +
        '<script src="local.js"></script>' +
        '<script src="http://insecure.example.com/a.js"></script>' +
        '<iframe src="data:text/html,hi"></iframe>' +
        '<iframe src="about:blank"></iframe>' +
        '<iframe></iframe>',
    )
    expect(derived).toEqual([])
  })

  it('does not mistake data-src / srcset for src', () => {
    const derived = deriveCspSourcesFromHtml(
      '<iframe data-src="https://lazy.example.com/e" srcset="https://srcset.example.com/x"></iframe>',
    )
    expect(derived).toEqual([])
  })

  it('decodes entity-escaped src attributes', () => {
    const derived = deriveCspSourcesFromHtml(
      '<iframe src="https://player.vimeo.com/video/12?h=a&amp;dnt=1"></iframe>',
    )
    const frame = derived.find((d) => d.directive === 'frame-src')
    expect(frame?.sources).toContain('https://player.vimeo.com')
  })

  it('dedupes repeated origins and sorts deterministically', () => {
    const a = deriveCspSourcesFromHtml(
      '<script src="https://b.example/1.js"></script>' +
        '<script src="https://a.example/2.js"></script>' +
        '<script src="https://b.example/3.js"></script>',
    )
    const b = deriveCspSourcesFromHtml(
      '<script src="https://a.example/2.js"></script>' +
        '<script src="https://b.example/3.js"></script>',
    )
    expect(a).toEqual([
      { directive: 'script-src', sources: ['https://a.example', 'https://b.example'] },
    ])
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// Provider implications
// ---------------------------------------------------------------------------

describe('deriveCspSourcesFromHtml — provider implication table', () => {
  it('vimeo player script implies frame-src player.vimeo.com + connect-src vimeo.com', () => {
    // The amkinggroup.com case: jarallax-video loads player.vimeo.com/api/player.js,
    // fetches vimeo.com/api/v2/video/<id>.json, then injects a player iframe.
    const derived = deriveCspSourcesFromHtml(
      '<script src="https://player.vimeo.com/api/player.js"></script>',
    )
    expect(derived).toEqual([
      { directive: 'connect-src', sources: ['https://vimeo.com'] },
      { directive: 'frame-src', sources: ['https://player.vimeo.com'] },
      { directive: 'script-src', sources: ['https://player.vimeo.com'] },
    ])
  })

  it('applies the same implications when the host appears as an iframe instead', () => {
    const derived = deriveCspSourcesFromHtml(
      '<iframe src="https://player.vimeo.com/video/12345"></iframe>',
    )
    expect(derived).toEqual([
      { directive: 'connect-src', sources: ['https://vimeo.com'] },
      { directive: 'frame-src', sources: ['https://player.vimeo.com'] },
    ])
  })

  it('youtube embed implies both youtube domains plus the iframe-API script origin', () => {
    const derived = deriveCspSourcesFromHtml(
      '<iframe src="https://www.youtube.com/embed/abc"></iframe>',
    )
    expect(derived).toEqual([
      {
        directive: 'frame-src',
        sources: ['https://www.youtube-nocookie.com', 'https://www.youtube.com'],
      },
      { directive: 'script-src', sources: ['https://www.youtube.com'] },
    ])
  })

  it('youtube-nocookie carries the same implied set', () => {
    const derived = deriveCspSourcesFromHtml(
      '<iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe>',
    )
    expect(derived.find((d) => d.directive === 'frame-src')?.sources).toEqual([
      'https://www.youtube-nocookie.com',
      'https://www.youtube.com',
    ])
  })

  it('googletagmanager implies google-analytics for script-src and connect-src', () => {
    const derived = deriveCspSourcesFromHtml(
      '<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>',
    )
    expect(derived).toEqual([
      { directive: 'connect-src', sources: ['https://www.google-analytics.com'] },
      {
        directive: 'script-src',
        sources: ['https://www.google-analytics.com', 'https://www.googletagmanager.com'],
      },
    ])
  })

  it('maps.googleapis.com implies its gstatic / tile companions', () => {
    const derived = deriveCspSourcesFromHtml(
      '<script src="https://maps.googleapis.com/maps/api/js?key=K"></script>',
    )
    expect(derived).toEqual([
      { directive: 'connect-src', sources: ['https://maps.googleapis.com'] },
      {
        directive: 'img-src',
        sources: ['https://maps.googleapis.com', 'https://maps.gstatic.com'],
      },
      {
        directive: 'script-src',
        sources: ['https://maps.googleapis.com', 'https://maps.gstatic.com'],
      },
    ])
  })

  it('an unknown provider contributes only its own origin', () => {
    expect(
      deriveCspSourcesFromHtml('<script src="https://widgets.unknown.example/w.js"></script>'),
    ).toEqual([{ directive: 'script-src', sources: ['https://widgets.unknown.example'] }])
  })
})

// ---------------------------------------------------------------------------
// Per-site escape hatch
// ---------------------------------------------------------------------------

describe('siteConfiguredCspSources — per-site escape hatch', () => {
  it('returns nothing when the site configures nothing', () => {
    expect(siteConfiguredCspSources(undefined)).toEqual([])
    expect(siteConfiguredCspSources({})).toEqual([])
  })

  it('normalizes directive case and sorts sources', () => {
    expect(
      siteConfiguredCspSources({
        'Connect-SRC': ['https://b.example', 'https://a.example', 'https://a.example'],
      }),
    ).toEqual([
      { directive: 'connect-src', sources: ['https://a.example', 'https://b.example'] },
    ])
  })

  it('keeps quoted keyword sources', () => {
    expect(siteConfiguredCspSources({ 'script-src': ["'unsafe-inline'"] })).toEqual([
      { directive: 'script-src', sources: ["'unsafe-inline'"] },
    ])
  })

  it('drops malformed directive names and unsafe source expressions', () => {
    expect(
      siteConfiguredCspSources({
        'bad directive': ['https://a.example'],
        '<script>': ['https://b.example'],
        'connect-src': [
          'https://ok.example',
          'https://x.example; script-src *',
          'has space',
          'quote"break',
          '',
        ],
      }),
    ).toEqual([{ directive: 'connect-src', sources: ['https://ok.example'] }])
  })
})

// ---------------------------------------------------------------------------
// End-to-end through publishPage
// ---------------------------------------------------------------------------

describe('published page CSP — derived from page content', () => {
  it('a page referencing nothing external keeps the strict base policy byte-identical', () => {
    const baseline = serializeCsp(createBaseCspPlan({ anyScriptTag: false }))
    expect(publishWithBody('<div>hello</div><img src="/uploads/a.png">')).toBe(baseline)
  })

  it('an imported page with a vimeo embed gets script/frame/connect sources', () => {
    const csp = publishWithBody(
      '<div class="jarallax" data-jarallax-video="https://vimeo.com/12345">' +
        '<script src="https://player.vimeo.com/api/player.js"></script>' +
        '</div>',
    )
    // connect-src did not exist in the base policy, so creating it here would
    // revoke same-origin fetches unless 'self' comes with it.
    expect(csp).toContain("connect-src 'self' https://vimeo.com;")
    expect(csp).toContain('frame-src https://player.vimeo.com;')
    expect(csp).toContain('script-src https://player.vimeo.com;')
    // No blanket relaxation: the lone 'none' is replaced by the real origin,
    // not widened to 'self' or '*'.
    expect(csp).not.toContain("script-src 'none'")
    expect(csp).not.toContain('*')
  })

  it('merges the per-site escape hatch into the same plan', () => {
    const site = makeSite()
    site.settings.contentSecurityPolicy = {
      extraSources: {
        'connect-src': ['https://f.vimeocdn.com'],
        'font-src': ['https://fonts.gstatic.com'],
      },
    }
    const csp = publishWithBody('<iframe src="https://player.vimeo.com/video/1"></iframe>', site)
    expect(csp).toContain("connect-src 'self' https://f.vimeocdn.com https://vimeo.com;")
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com;")
  })

  it('escape-hatch sources alone do not otherwise disturb the base policy', () => {
    const site = makeSite()
    site.settings.contentSecurityPolicy = { extraSources: { 'connect-src': ['https://a.example'] } }
    const withHatch = publishWithBody('<p>x</p>', site)
    const baseline = serializeCsp(createBaseCspPlan({ anyScriptTag: false }))
    expect(withHatch).toBe(
      baseline.replace('default-src', "connect-src 'self' https://a.example; default-src"),
    )
  })

  it('is byte-identical across repeated publishes and insensitive to markup order', () => {
    const first = publishWithBody(
      '<script src="https://b.example/1.js"></script>' +
        '<iframe src="https://player.vimeo.com/video/9"></iframe>',
    )
    const second = publishWithBody(
      '<script src="https://b.example/1.js"></script>' +
        '<iframe src="https://player.vimeo.com/video/9"></iframe>',
    )
    const reordered = publishWithBody(
      '<iframe src="https://player.vimeo.com/video/9"></iframe>' +
        '<script src="https://b.example/1.js"></script>',
    )
    expect(first).toBe(second)
    expect(first).toBe(reordered)
  })
})

// ---------------------------------------------------------------------------
// media-src (local patch #13)
// ---------------------------------------------------------------------------

describe('media elements contribute media-src', () => {
  it('derives media-src from a cross-origin video src', () => {
    // 890capital.com: the Oxygen hero is a <video> hot-linked to the source
    // WordPress, exactly as the images are. With no media-src the policy falls
    // back to default-src 'self' and the browser refuses the file: readyState
    // stays 0, no poster, flat grey where the building render should be.
    const reqs = deriveCspSourcesFromHtml(
      '<video src="https://890capital.com/wp-content/uploads/2025/07/hero.mp4"></video>',
    )
    expect(reqs).toContainEqual({ directive: 'media-src', sources: ['https://890capital.com'] })
  })

  it('derives media-src from <source> inside a video, and from audio', () => {
    const reqs = deriveCspSourcesFromHtml(
      '<video><source src="https://cdn.example.com/a.mp4" type="video/mp4"></video>' +
        '<audio src="https://audio.example.com/b.mp3"></audio>',
    )
    const media = reqs.find((r) => r.directive === 'media-src')
    expect(media?.sources).toEqual(['https://audio.example.com', 'https://cdn.example.com'])
  })

  it('sends a poster to img-src, because a poster is fetched as an image', () => {
    const reqs = deriveCspSourcesFromHtml(
      '<video poster="https://media.example.com/first-frame.jpg" src="https://media.example.com/x.mp4"></video>',
    )
    expect(reqs).toContainEqual({ directive: 'img-src', sources: ['https://media.example.com'] })
    expect(reqs).toContainEqual({ directive: 'media-src', sources: ['https://media.example.com'] })
  })

  it('adds nothing for same-origin or relative media', () => {
    expect(deriveCspSourcesFromHtml('<video src="/uploads/local.mp4"></video>')).toEqual([])
    expect(deriveCspSourcesFromHtml('<video></video>')).toEqual([])
  })
})
