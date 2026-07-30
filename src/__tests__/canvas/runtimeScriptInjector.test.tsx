import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, waitFor } from '@testing-library/react'
import { withCanvasDomReadyReplay } from '@admin/pages/site/canvas/canvasDomReadyReplay'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  delete document.body.dataset.domReadyFired
  delete document.body.dataset.windowLoadFired
  delete document.body.dataset.scrollFired
})

/**
 * `readyState` is a getter on the Document prototype in happy-dom, so it is
 * overridden per-test rather than assigned.
 */
function withReadyState(state: DocumentReadyState, run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(document, 'readyState')
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => state })
  try {
    run()
  } finally {
    if (descriptor) Object.defineProperty(document, 'readyState', descriptor)
    else delete (document as unknown as Record<string, unknown>).readyState
  }
}

describe('RuntimeScriptInjector', () => {
  it('runs DOMContentLoaded handlers registered by scripts injected after the iframe is already ready', async () => {
    withCanvasDomReadyReplay(document, () => {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.dataset.domReadyFired = 'yes'
      })
    })

    await waitFor(() => {
      expect(document.body.dataset.domReadyFired).toBe('yes')
    })
  })

  // Scroll-reveal libraries (CSS3 Animate It, AOS, WOW.js) ship content at
  // `opacity: 0` and run their only initial in-viewport sweep from window
  // `load`. Canvas frames grow to content height instead of scrolling, so no
  // scroll event follows to compensate — a missed `load` leaves the content
  // invisible permanently.
  it('runs window load handlers registered by scripts injected after the iframe finished loading', async () => {
    withReadyState('complete', () => {
      withCanvasDomReadyReplay(document, () => {
        window.addEventListener('load', () => {
          document.body.dataset.windowLoadFired = 'yes'
        })
      })
    })

    await waitFor(() => {
      expect(document.body.dataset.windowLoadFired).toBe('yes')
    })
  })

  it('does not replay window load while the document is still interactive, because a real load is still coming', async () => {
    withReadyState('interactive', () => {
      withCanvasDomReadyReplay(document, () => {
        window.addEventListener('load', () => {
          document.body.dataset.windowLoadFired = 'yes'
        })
      })
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(document.body.dataset.windowLoadFired).toBeUndefined()

    window.dispatchEvent(new Event('load'))
    expect(document.body.dataset.windowLoadFired).toBe('yes')
  })

  it('registers non-replayed window events normally instead of swallowing them', async () => {
    withReadyState('complete', () => {
      withCanvasDomReadyReplay(document, () => {
        window.addEventListener('scroll', () => {
          document.body.dataset.scrollFired = 'yes'
        })
      })
    })

    expect(document.body.dataset.scrollFired).toBeUndefined()
    window.dispatchEvent(new Event('scroll'))
    expect(document.body.dataset.scrollFired).toBe('yes')
  })

  it('restores both patched addEventListener functions once injection returns', () => {
    const documentBefore = document.addEventListener
    const windowBefore = window.addEventListener

    withReadyState('complete', () => {
      withCanvasDomReadyReplay(document, () => {
        expect(document.addEventListener).not.toBe(documentBefore)
        expect(window.addEventListener).not.toBe(windowBefore)
      })
    })

    expect(document.addEventListener).toBe(documentBefore)
    expect(window.addEventListener).toBe(windowBefore)
  })
})
