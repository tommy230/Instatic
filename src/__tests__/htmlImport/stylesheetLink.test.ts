import { describe, expect, it } from 'bun:test'
import '@modules/base'
import { importHtml } from '@core/htmlImport'
import { makeHtmlPagePlan } from '@core/siteImport'
import { publishPage } from '@core/publisher'
import { registry } from '@core/module-engine'
import type { FileMap } from '@core/siteImport'
import { makePage, makeSite } from '../publisher/helpers'

describe('stylesheet link import', () => {
  const html = '<body><link rel="stylesheet" href="assets/body.css"><main>OK</main></body>'
  const fileMap: FileMap = {
    files: {
      'index.html': { bytes: new TextEncoder().encode(html), mimeType: 'text/html' },
      'assets/body.css': {
        bytes: new TextEncoder().encode('main { color: green; }'),
        mimeType: 'text/css',
      },
    },
  }

  it('keeps body stylesheet CSS in the page plan without creating or publishing a link husk', () => {
    const { pagePlan } = makeHtmlPagePlan('index.html', html, fileMap)

    expect(pagePlan.linkedCssPaths).toEqual(['assets/body.css'])
    expect(Object.values(pagePlan.nodeFragment.nodes)).not.toContainEqual(
      expect.objectContaining({ props: expect.objectContaining({ customTag: 'link' }) }),
    )

    const rootNodeId = pagePlan.nodeFragment.rootIds[0]!
    const page = makePage(pagePlan.nodeFragment.nodes, rootNodeId)
    const { html: publishedHtml } = publishPage(page, makeSite(), registry)
    const publishedDoc = new DOMParser().parseFromString(publishedHtml, 'text/html')
    const stylesheetHusks = Array.from(publishedDoc.querySelectorAll('[rel]')).filter((element) => {
      if (element.tagName.toLowerCase() === 'link') return false
      return (element.getAttribute('rel') ?? '')
        .split(/\s+/)
        .some((token) => token.toLowerCase() === 'stylesheet')
    })
    expect(stylesheetHusks).toHaveLength(0)
  })

  it('removes case-insensitive stylesheet tokens while leaving other link relations alone', () => {
    const result = importHtml(
      '<head><link rel="stylesheet" href="head.css"></head><body><link REL="STYLESHEET alternate" href="theme.css"><link rel="preload" href="font.woff2"><link rel="alternate\u00a0stylesheet" href="metadata.css"><main>OK</main></body>',
    )

    // stripUnsafe operates on the whole document, including head. This is safe:
    // makeHtmlPagePlan harvests links from a separate parse before importHtml.
    expect(result.stripped.stylesheetLinks).toBe(2)
    const linkNodes = Object.values(result.nodes).filter((node) => node.props.customTag === 'link')
    expect(linkNodes).toHaveLength(2)
    expect(linkNodes.map((node) => node.props.htmlAttributes)).toEqual([
      { rel: 'preload', href: 'font.woff2' },
      { rel: 'alternate\u00a0stylesheet', href: 'metadata.css' },
    ])
  })
})
