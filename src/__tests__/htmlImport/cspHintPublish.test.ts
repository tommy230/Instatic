import { afterEach, describe, expect, it } from 'bun:test'
import '@modules/base'
import { registry } from '@core/module-engine'
import { buildImportPlan, commitImportPlan } from '@core/siteImport'
import { publishPage } from '@core/publisher'
import { pageFromRow, pageToCells } from '@core/data/pageFromRow'
import type { DataRow } from '@core/data/schemas'
import { useEditorStore } from '@site/store/store'
import { createSiteImportAdapter } from '@admin/modals/SiteImport/shared/createSiteImportAdapter'
import { buildSiteRuntimeScripts } from '../../../server/publish/runtime/bundleScripts'
import { makeEmptySiteDocument } from '../siteImport/mockSite'
import { makePage } from '../publisher/helpers'

function resetStore(): void {
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

function extractPublishedCsp(html: string): string {
  const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)
  if (!match) throw new Error('no CSP meta found in published page')
  return match[1]!
}

afterEach(resetStore)

describe('imported connection hints through publish', () => {
  it('round-trips page connection hints through the data-row body cell', () => {
    const page = {
      ...makePage({ root: { moduleId: 'base.body' } }),
      connectionHints: ['//kit.fontawesome.com'],
    }
    const now = new Date(0).toISOString()
    const row: DataRow = {
      id: page.id,
      tableId: 'pages',
      cells: pageToCells(page),
      slug: page.slug,
      status: 'draft',
      authorUserId: null,
      createdByUserId: null,
      updatedByUserId: null,
      publishedByUserId: null,
      author: null,
      createdBy: null,
      updatedBy: null,
      publishedBy: null,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      scheduledPublishAt: null,
      deletedAt: null,
    }

    expect(pageFromRow(row).connectionHints).toEqual(['//kit.fontawesome.com'])
  })

  it.each(['head', 'body'] as const)(
    'carries a Font Awesome dns-prefetch from the %s through commit and publish',
    async (placement) => {
      const hint = '<link rel="dns-prefetch" href="//kit.fontawesome.com">'
      const html = `<!doctype html><html><head>${placement === 'head' ? hint : ''}</head><body>${placement === 'body' ? hint : ''}<p>Fixture</p><script src="localized-kit.js"></script></body></html>`
      const site = makeEmptySiteDocument()
      useEditorStore.setState({ site } as Parameters<typeof useEditorStore.setState>[0])

      const plan = buildImportPlan({
        fileMap: {
          files: {
            'index.html': { bytes: new TextEncoder().encode(html), mimeType: 'text/html' },
            'localized-kit.js': {
              bytes: new TextEncoder().encode("document.documentElement.dataset.kit = 'loaded'"),
              mimeType: 'text/javascript',
            },
          },
        },
        currentSite: site,
      })
      await commitImportPlan(plan, createSiteImportAdapter({ sessionId: 'csp-hint-test' }))

      const committedSite = useEditorStore.getState().site!
      const page = committedSite.pages.find((candidate) => candidate.slug === 'index')!
      const runtimeBuild = await buildSiteRuntimeScripts({
        site: committedSite,
        page,
        target: 'publish',
        assetBasePath: '/_instatic/assets/runtime/',
      })
      expect(runtimeBuild.diagnostics).toEqual([])

      const published = publishPage(page, committedSite, registry, {
        runtimeAssets: runtimeBuild.runtimeAssets,
      }).html
      const csp = extractPublishedCsp(published)

      expect(published).toContain('<script src="/_instatic/assets/runtime/')
      expect(csp).toContain(
        "connect-src 'self' https://ka-p.fontawesome.com https://kit.fontawesome.com;",
      )
      expect(csp).toContain(
        "font-src 'self' https://ka-f.fontawesome.com https://ka-p.fontawesome.com;",
      )
      expect(csp).toContain(
        "style-src 'self' 'unsafe-inline' https://ka-p.fontawesome.com https://kit.fontawesome.com;",
      )
      expect(csp).not.toContain('script-src https://kit.fontawesome.com')
    },
  )
})
