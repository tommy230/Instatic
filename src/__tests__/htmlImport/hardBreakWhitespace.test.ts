/**
 * `<br>` keeps the whitespace the source put beside it.
 *
 * A `<br>`-separated paragraph imports as one text node with hard newlines, and
 * every line used to be trimmed. That is invisible while the break renders — a
 * space next to a forced line break draws nothing — but plenty of themes hide
 * `br` outright (`br{display:none}`), and then the source's own newline beside
 * the tag is the only thing keeping the two words apart.
 *
 * redrockscafe.com renders `Steakhouse<br>\nbest known` as two words on one
 * line in production and published "Steakhousebest known".
 */
import { describe, expect, it } from 'bun:test'
import '@modules/base'
import { importHtml } from '@core/htmlImport'

function textNodes(html: string): string[] {
  const fragment = importHtml(html)
  return Object.values(fragment.nodes)
    .filter((node) => node.moduleId === 'base.text')
    .map((node) => String((node.props as { text?: string }).text ?? ''))
}

describe('hard breaks keep their adjacent whitespace', () => {
  it('keeps the space where the source wrapped after a <br>', () => {
    expect(textNodes('<p>We are an American Restaurant and Steakhouse<br>\nbest known for our steaks.</p>'))
      .toEqual(['We are an American Restaurant and Steakhouse\n best known for our steaks.'])
  })

  it('adds no space when the source had none', () => {
    expect(textNodes('<p>A<br>B</p>')).toEqual(['A\nB'])
  })

  it('collapses a whitespace run beside a break to one space', () => {
    expect(textNodes('<p>A<br>   \n   B</p>')).toEqual(['A\n B'])
  })

  it('still trims the element\'s outer edges', () => {
    expect(textNodes('<p>\n  A<br>B\n  </p>')).toEqual(['A\nB'])
  })

  it('handles several breaks in one paragraph', () => {
    expect(textNodes('<p>one<br>\ntwo<br>\nthree</p>')).toEqual(['one\n two\n three'])
  })
})
