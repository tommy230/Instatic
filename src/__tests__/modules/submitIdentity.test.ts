/**
 * A rebuilt submit button keeps the identity the source gave it.
 *
 * The importer turns `<input type="submit">` into `<button type="submit">`,
 * which is the right element and a different one to every theme rule written
 * against the original. Tag-qualified selectors are handled upstream (the
 * capture step twins `input[type=submit]` selectors), but id- and class-based
 * rules only work if the id and the classes survive the rebuild.
 *
 * redrockscafe.com's newsletter button is
 * `<input type="submit" id="gform_submit_button_11" class="gform_button button"
 * value="Subscribe">`; it published as a bare `<button class="gform_button"
 * type="submit">Subscribe</button>`.
 */
import { describe, expect, it } from 'bun:test'
import '@modules/base'
import { importHtml } from '@core/htmlImport'
import { registry } from '@core/module-engine'
import type { PageNode } from '@core/page-tree'

const SOURCE =
  '<form><input type="submit" id="gform_submit_button_11" class="gform_button button" value="Subscribe"></form>'

function submitNode(html: string): PageNode {
  const fragment = importHtml(html)
  const node = Object.values(fragment.nodes).find((n) => n.moduleId === 'base.submit')
  if (!node) throw new Error('no base.submit node produced')
  return node
}

describe('base.submit identity carryover', () => {
  it('keeps the source id and class list on the node', () => {
    const node = submitNode(SOURCE)

    expect((node.props as { htmlAttributes?: Record<string, string> }).htmlAttributes)
      .toMatchObject({ id: 'gform_submit_button_11' })
    // Classes ride the class-link axis, not htmlAttributes, so both survive.
    expect(node.classIds).toEqual(['gform_button', 'button'])
  })

  it('emits the id on the published button', () => {
    const node = submitNode(SOURCE)
    const html = registry.getOrThrow('base.submit').render(node.props as never, []).html

    expect(html).toContain('id="gform_submit_button_11"')
    expect(html).toContain('type="submit"')
    expect(html).toContain('Subscribe')
  })

  it('does not re-emit the attributes the module generates itself', () => {
    const node = submitNode(SOURCE)
    const html = registry.getOrThrow('base.submit').render(node.props as never, []).html

    // `value` became the label and `type` is the module's own; emitting either
    // again would put two of them on one element.
    expect(html.match(/type=/g)).toHaveLength(1)
    expect(html).not.toContain('value=')
  })

  it('adds nothing for a submit input that carried no identity', () => {
    const node = submitNode('<form><input type="submit" value="Send"></form>')
    const html = registry.getOrThrow('base.submit').render(node.props as never, []).html

    expect(html).toBe('<button type="submit">Send</button>')
  })
})
