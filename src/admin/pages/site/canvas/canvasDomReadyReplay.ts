/**
 * canvasDomReadyReplay — gives canvas-injected scripts the document lifecycle
 * they were written against.
 *
 * A published page's scripts are parsed into a document that is still loading,
 * so `DOMContentLoaded` and `window`'s `load` arrive after they register for
 * them. The canvas injects the same scripts into an iframe whose document is
 * already `complete`, so both events fired long ago and a listener registered
 * now would never run.
 *
 * This wrapper patches `addEventListener` for the duration of the injection and
 * replays the milestones that have already passed:
 *
 * - `DOMContentLoaded` on the document, replayed once `readyState` is past
 *   `loading`.
 * - `load` on the iframe's window, replayed once `readyState` is `complete`.
 *
 * The window half is not symmetry for its own sake. Scroll-reveal libraries —
 * CSS3 Animate It, AOS, WOW.js and the rest of the family — ship their content
 * at `opacity: 0` and perform their one and only initial in-viewport sweep from
 * `window`'s `load`. Canvas frames grow to content height rather than scrolling
 * internally, so no scroll event ever follows to make up for a missed sweep:
 * without this replay the reveal class is never added and the content stays
 * invisible for as long as the page is open. That is the whole bug, not a
 * cosmetic delay.
 *
 * Only listeners registered *synchronously* inside `run` are replayed — the
 * originals are restored in `finally`. Classic scripts execute on append, so
 * their top-level registrations are covered; module scripts are deferred and
 * are not, which is a known limit.
 */

function callEventListener(
  thisArg: EventTarget,
  listener: EventListenerOrEventListenerObject,
  event: Event,
): void {
  if (typeof listener === 'function') {
    listener.call(thisArg, event)
    return
  }
  listener.handleEvent(event)
}

/**
 * Replace `target.addEventListener` with one that replays `replayType`
 * asynchronously instead of registering it, and passes every other type
 * through. Returns a restore function.
 */
function patchWithReplay(
  target: EventTarget,
  replayType: string,
  win: Window,
): () => void {
  const original = target.addEventListener
  target.addEventListener = function addEventListenerWithReplay(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (!listener) return
    if (type === replayType) {
      win.setTimeout(() => {
        callEventListener(
          target,
          listener,
          new (win as Window & typeof globalThis).Event(replayType, {
            bubbles: false,
            cancelable: false,
          }),
        )
      }, 0)
      return
    }
    original.call(target, type, listener, options)
  }
  return () => {
    target.addEventListener = original
  }
}

export function withCanvasDomReadyReplay<T>(
  targetDocument: Document,
  run: () => T,
): T {
  const win = targetDocument.defaultView ?? window
  const restores: Array<() => void> = []

  // Past `loading` means the parser finished and DOMContentLoaded has fired.
  if (targetDocument.readyState !== 'loading') {
    restores.push(patchWithReplay(targetDocument, 'DOMContentLoaded', win))
  }

  // `complete` is the state the document reaches *after* window load fires.
  // While it is `interactive` a real `load` is still coming, so registering
  // normally is correct and replaying would double-fire.
  if (targetDocument.readyState === 'complete') {
    restores.push(patchWithReplay(win, 'load', win))
  }

  try {
    return run()
  } finally {
    for (const restore of restores) restore()
  }
}
