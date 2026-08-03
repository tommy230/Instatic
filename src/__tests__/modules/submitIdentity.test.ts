/**
 * A rebuilt submit button keeps safe source identity attributes while the
 * module remains authoritative for submission behavior.
 */
import { describe, expect, it } from 'bun:test'
import '@modules/base'
import { importHtml } from '@core/htmlImport'
import { registry } from '@core/module-engine'
import type { PageNode } from '@core/page-tree'

const SOURCE =
  '<form><input type="submit" id="signup-submit" class="primary-action action" value="Subscribe"></form>'

function submitNode(html: string): PageNode {
  const fragment = importHtml(html)
  const node = Object.values(fragment.nodes).find((candidate) => candidate.moduleId === 'base.submit')
  if (!node) throw new Error('no base.submit node produced')
  return node
}

function formNode(html: string): PageNode {
  const fragment = importHtml(html)
  const node = Object.values(fragment.nodes).find((candidate) => candidate.moduleId === 'base.form')
  if (!node) throw new Error('no base.form node produced')
  return node
}

function renderSubmit(node: PageNode): string {
  return registry.getOrThrow('base.submit').render(node.props as never, []).html
}

describe('base.submit identity carryover', () => {
  it('keeps the source id and class list on the node', () => {
    const node = submitNode(SOURCE)

    expect((node.props as { htmlAttributes?: Record<string, string> }).htmlAttributes)
      .toMatchObject({ id: 'signup-submit' })
    // Classes ride the class-link axis, not htmlAttributes, so both survive.
    expect(node.classIds).toEqual(['primary-action', 'action'])
  })

  it('emits the id on the published button', () => {
    const html = renderSubmit(submitNode(SOURCE))

    expect(html).toBe('<button type="submit" id="signup-submit">Subscribe</button>')
  })

  it('does not re-emit the attributes the module generates itself', () => {
    const html = renderSubmit(submitNode(SOURCE))

    // `value` became the label and `type` is the module's own; emitting either
    // again would put two of them on one element.
    expect(html.match(/type=/g)).toHaveLength(1)
    expect(html).not.toContain('value=')
  })

  it('adds nothing for a submit input that carried no identity', () => {
    const html = renderSubmit(submitNode('<form><input type="submit" value="Send"></form>'))

    expect(html).toBe('<button type="submit">Send</button>')
  })

  const collisionCases = [
    { name: 'type', source: 'type="submit"' },
    { name: 'value', source: 'value="Send"' },
    { name: 'formaction', source: 'formaction="https://other.invalid/collect"' },
    { name: 'formmethod', source: 'formmethod="get"' },
    { name: 'formenctype', source: 'formenctype="text/plain"' },
    { name: 'formtarget', source: 'formtarget="_blank"' },
    { name: 'formnovalidate', source: 'formnovalidate' },
  ] as const

  for (const collision of collisionCases) {
    it(`strips source ${collision.name} before publishing the rebuilt submit button`, () => {
      const sourceAttributes = [
        collision.name === 'type' ? collision.source : 'type="submit"',
        collision.name === 'value' ? collision.source : 'value="Send"',
        collision.name === 'type' || collision.name === 'value' ? '' : collision.source,
      ].filter(Boolean).join(' ')
      const node = submitNode(
        `<form><input ${sourceAttributes}></form>`,
      )
      const htmlAttributes = (node.props as { htmlAttributes?: Record<string, string> }).htmlAttributes ?? {}
      const html = renderSubmit(node)

      expect(htmlAttributes).not.toHaveProperty(collision.name)
      if (collision.name === 'type') {
        expect(html.match(/type=/g)).toHaveLength(1)
        expect(html).toContain('type="submit"')
      } else {
        expect(html).not.toContain(`${collision.name}=`)
      }
    })
  }

  it('strips source form before emitting the module-generated form attribute once', () => {
    const node = submitNode(
      '<form><button type="submit" form="signup">Send</button></form>',
    )
    const htmlAttributes = (node.props as { htmlAttributes?: Record<string, string> }).htmlAttributes ?? {}
    const html = renderSubmit(node)

    expect(htmlAttributes).not.toHaveProperty('form')
    expect(html.match(/ form=/g)).toHaveLength(1)
    expect(html).toBe('<button type="submit" form="signup">Send</button>')
  })

  it('strips source disabled before emitting the module-generated disabled attribute once', () => {
    const node = submitNode(
      '<form><button type="submit" disabled>Send</button></form>',
    )
    const htmlAttributes = (node.props as { htmlAttributes?: Record<string, string> }).htmlAttributes ?? {}
    const html = renderSubmit(node)

    expect(htmlAttributes).not.toHaveProperty('disabled')
    expect(html.match(/ disabled(?:[ =>])/g)).toHaveLength(1)
    expect(html).toBe('<button type="submit" disabled>Send</button>')
  })

  it('keeps source novalidate on the form without copying it onto the submit button', () => {
    const source = '<form novalidate><input type="submit" value="Send"></form>'
    const form = formNode(source)
    const submit = submitNode(source)
    const formHtmlAttributes = (form.props as { htmlAttributes?: Record<string, string> }).htmlAttributes ?? {}
    const submitHtmlAttributes = (submit.props as { htmlAttributes?: Record<string, string> }).htmlAttributes ?? {}
    const html = renderSubmit(submit)

    expect(formHtmlAttributes).toMatchObject({ novalidate: '' })
    expect(submitHtmlAttributes).not.toHaveProperty('novalidate')
    expect(submitHtmlAttributes).not.toHaveProperty('formnovalidate')
    expect(html).not.toContain('novalidate')
  })
})
