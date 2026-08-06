import { describe, expect, it } from 'bun:test'
import { publishPage } from '@core/publisher'
import { scriptTagsForRuntimeAssets, type PublishedPageRuntimeAssets } from '@core/site-runtime'
import { makeModule, makePage, makeRegistry, makeSite } from './helpers'

const registry = makeRegistry({
  'base.body': makeModule('base.body', {
    canHaveChildren: true,
    render: (_props, children) => ({ html: `<main>${children.join('')}</main>` }),
  }),
})

const page = makePage({
  root: { moduleId: 'base.body', props: {}, children: [] },
})

const site = makeSite({ pages: [page] })

describe('publishPage runtime assets', () => {
  it('keeps script execution disabled when no runtime assets are present', () => {
    const { html } = publishPage(page, site, registry)

    expect(html).toContain("script-src 'none'")
    expect(html).toContain("worker-src 'none'")
    expect(html).not.toContain('data-instatic-runtime-script')
  })

  it('allows self-hosted scripts and injects head and body-end runtime assets', () => {
    const runtimeAssets: PublishedPageRuntimeAssets = {
      scripts: [
        {
          fileId: 'body-script',
          src: '/_instatic/assets/runtime/body.123.js',
          placement: 'body-end',
          timing: 'dom-ready',
          priority: 100,
        },
        {
          fileId: 'head-script',
          src: '/_instatic/assets/runtime/head.123.js',
          placement: 'head',
          timing: 'immediate',
          priority: 10,
        },
      ],
    }

    const { html } = publishPage(page, site, registry, { runtimeAssets })

    expect(html).toContain("script-src 'self'")
    expect(html).toContain("worker-src 'self' blob:")
    expect(html).not.toContain("script-src 'none'")
    expect(html).toContain(
      '<script type="module" src="/_instatic/assets/runtime/head.123.js" data-instatic-runtime-script="head-script"></script>',
    )
    expect(html).toContain(
      '<script type="module" src="/_instatic/assets/runtime/body.123.js" data-instatic-runtime-script="body-script"></script>',
    )
    expect(html.indexOf('/_instatic/assets/runtime/head.123.js')).toBeLessThan(html.indexOf('</head>'))
    expect(html.indexOf('/_instatic/assets/runtime/body.123.js')).toBeLessThan(html.indexOf('</body>'))
    expect(html.indexOf('/_instatic/assets/runtime/body.123.js')).toBeGreaterThan(html.indexOf('<body>'))
  })

  it('orders runtime scripts by priority within each placement', () => {
    const runtimeAssets: PublishedPageRuntimeAssets = {
      scripts: [
        { fileId: 'b', src: '/_instatic/assets/runtime/b.js', placement: 'body-end', timing: 'dom-ready', priority: 20 },
        { fileId: 'a', src: '/_instatic/assets/runtime/a.js', placement: 'body-end', timing: 'dom-ready', priority: 10 },
      ],
    }

    const { html } = publishPage(page, site, registry, { runtimeAssets })

    expect(html.indexOf('/_instatic/assets/runtime/a.js')).toBeLessThan(html.indexOf('/_instatic/assets/runtime/b.js'))
  })

  it('emits classic runtime scripts without type=module', () => {
    const runtimeAssets: PublishedPageRuntimeAssets = {
      scripts: [
        {
          fileId: 'classic',
          src: '/_instatic/assets/runtime/jquery.js',
          format: 'classic',
          placement: 'body-end',
          timing: 'dom-ready',
          priority: 10,
        },
      ],
    }

    const { html } = publishPage(page, site, registry, { runtimeAssets })

    expect(html).toContain(
      '<script src="/_instatic/assets/runtime/jquery.js" data-instatic-runtime-script="classic"></script>',
    )
    expect(html).not.toContain(
      '<script type="module" src="/_instatic/assets/runtime/jquery.js"',
    )
  })

  it('does not inject external or unsafe runtime asset URLs', () => {
    const runtimeAssets: PublishedPageRuntimeAssets = {
      scripts: [
        { fileId: 'cdn', src: 'https://cdn.example.com/pkg.js', placement: 'body-end', timing: 'dom-ready', priority: 10 },
        { fileId: 'unsafe', src: 'javascript:alert(1)', placement: 'body-end', timing: 'dom-ready', priority: 20 },
        { fileId: 'escape', src: '../escape.js', placement: 'body-end', timing: 'dom-ready', priority: 30 },
      ],
    }

    const { html } = publishPage(page, site, registry, { runtimeAssets })

    expect(html).toContain("script-src 'none'")
    expect(html).not.toContain('cdn.example.com')
    expect(html).not.toContain('javascript:alert')
    expect(html).not.toContain('../escape.js')
  })

  it('emits safe authored script attributes after managed attributes', () => {
    const runtimeAssets: PublishedPageRuntimeAssets = {
      scripts: [{
        fileId: 'illustrata',
        src: '/_instatic/assets/runtime/widget.js',
        format: 'classic',
        placement: 'body-end',
        timing: 'dom-ready',
        priority: 10,
        authoredAttributes: [
          { name: 'src', value: 'https://widget.cloud.illustrata.io/widget.js' },
          { name: 'type', value: 'text/javascript' },
          { name: 'data-instatic-runtime-script', value: 'authored-marker' },
          { name: 'data-embed-token', value: 'token-"one"&two' },
          { name: 'data-api-base', value: 'https://api.cloud.illustrata.io?a=1&b=2' },
          { name: 'data-target', value: '#illustrata-embed-1' },
          { name: 'defer' },
          { name: 'onclick', value: 'alert(1)' },
          { name: 'ONLOAD', value: 'alert(2)' },
          { name: 'x onload', value: 'alert(3)' },
          { name: 'data-target', value: '#duplicate-loses' },
        ],
      }],
    }

    expect(scriptTagsForRuntimeAssets(runtimeAssets, 'body-end')).toBe(
      '  <script src="/_instatic/assets/runtime/widget.js" data-instatic-runtime-script="illustrata" data-embed-token="token-&quot;one&quot;&amp;two" data-api-base="https://api.cloud.illustrata.io?a=1&amp;b=2" data-target="#illustrata-embed-1" defer></script>',
    )
  })

  it('appends an authored src fragment to a rewritten local asset without doubling existing fragments', () => {
    const base = {
      format: 'classic' as const,
      placement: 'body-end' as const,
      timing: 'dom-ready' as const,
      priority: 10,
      srcFragment: '#xfbml=1&version=v25.0',
    }
    const runtimeAssets: PublishedPageRuntimeAssets = {
      scripts: [
        { ...base, fileId: 'rewritten', src: '/_instatic/assets/runtime/sdk.js' },
        { ...base, fileId: 'unchanged', src: '/_instatic/assets/runtime/sdk.js#existing' },
      ],
    }

    const tags = scriptTagsForRuntimeAssets(runtimeAssets, 'body-end')
    expect(tags).toContain('src="/_instatic/assets/runtime/sdk.js#xfbml=1&amp;version=v25.0"')
    expect(tags).toContain('src="/_instatic/assets/runtime/sdk.js#existing"')
    expect(tags).not.toContain('#existing#xfbml')
  })

  it('lets managed integrity win while retaining authored crossorigin without integrity', () => {
    const runtimeAssets: PublishedPageRuntimeAssets = {
      scripts: [
        {
          fileId: 'managed',
          src: '/managed.js',
          placement: 'head',
          timing: 'immediate',
          priority: 10,
          integrity: 'sha384-managed',
          authoredAttributes: [
            { name: 'integrity', value: 'sha384-authored' },
            { name: 'crossorigin', value: 'use-credentials' },
          ],
        },
        {
          fileId: 'authored',
          src: '/authored.js',
          placement: 'head',
          timing: 'immediate',
          priority: 20,
          authoredAttributes: [{ name: 'crossorigin', value: 'use-credentials' }],
        },
      ],
    }

    const tags = scriptTagsForRuntimeAssets(runtimeAssets, 'head')
    expect(tags).toContain('integrity="sha384-managed" crossorigin="anonymous"')
    expect(tags).not.toContain('sha384-authored')
    expect(tags).toContain('data-instatic-runtime-script="authored" crossorigin="use-credentials"')
  })

  it('keeps output byte-identical when no authored metadata is present', () => {
    expect(scriptTagsForRuntimeAssets({ scripts: [{
      fileId: 'classic',
      src: '/classic.js',
      format: 'classic',
      placement: 'body-end',
      timing: 'dom-ready',
      priority: 10,
    }] }, 'body-end')).toBe(
      '  <script src="/classic.js" data-instatic-runtime-script="classic"></script>',
    )
  })
})
