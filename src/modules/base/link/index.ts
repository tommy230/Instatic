/**
 * base.link — anchor element.
 *
 * Emits a bare `<a>` with no default class or default CSS.
 * Visual styling is opt-in via user classes (mcClassName / multi-class system).
 */
import type { ModuleDefinition } from '@core/module-engine'
import { registry } from '@core/module-engine'
import { LinkIcon } from 'pixel-art-icons/icons/link'
import { escapeHtml, safeUrl } from '@modules/base/utils/escape'
import { Value } from '@core/utils/typeboxHelpers'
import { ANCHOR_TARGET_OPTIONS, anchorRel } from '@modules/base/shared/anchorTarget'
import {
  htmlAttributesAttr,
  htmlAttributesControl,
} from '@modules/base/shared/htmlAttributes'
import { linkUsesChildren } from './content'
import { LinkEditor } from './LinkEditor'
import { LinkPropsSchema, type LinkStoredProps } from './props'

export const LinkModule: ModuleDefinition<LinkStoredProps> = {
  id: 'base.link',
  name: 'Link',
  description: 'An anchor element.',
  category: 'Interactive',
  version: '2.0.0',
  icon: LinkIcon,
  trusted: true,
  canHaveChildren: true,
  // Inline-editable only while childless — the canvas's generic
  // children-guard mirrors linkUsesChildren() in render().
  inlineTextEdit: { prop: 'text' },

  schema: {
    href: { type: 'url', label: 'URL' },
    text: { type: 'text', label: 'Link text', placeholder: 'Displayed when no children' },
    target: {
      type: 'select',
      label: 'Target',
      options: [...ANCHOR_TARGET_OPTIONS],
    },
    htmlAttributes: htmlAttributesControl(),
  },

  propsSchema: LinkPropsSchema,

  defaults: Value.Create(LinkPropsSchema),

  component: LinkEditor,

  htmlTag: 'a',

  render: (props, renderedChildren) => {
    const hrefAttr = props.href === null ? '' : ` href="${safeUrl(props.href)}"`
    // An imported anchor may carry a semantic rel (next/prev, nofollow, …) in
    // its htmlAttributes bag; themes style against it (`a[rel="next"]`).
    // Merge those tokens with the security rel and emit exactly one rel
    // attribute, keeping the bag's copy out of the generic attribute string.
    const { rel: authoredRel, ...bagWithoutRel } = (props.htmlAttributes ?? {}) as Record<string, unknown>
    const attrs = htmlAttributesAttr(bagWithoutRel)
    const relTokens = [
      ...String(typeof authoredRel === 'string' ? authoredRel : '').split(/\s+/).filter(Boolean),
      ...(props.target === null ? [] : (anchorRel(props.target)?.split(' ') ?? [])),
    ]
    const rel = [...new Set(relTokens)].join(' ')
    const relAttr = rel ? ` rel="${escapeHtml(rel)}"` : ''
    const targetAttr = props.target === null ? '' : ` target="${String(props.target)}"`
    const content = linkUsesChildren(renderedChildren.length)
      ? renderedChildren.join('')
      : String(props.text ?? '')
    return {
      html: `<a${attrs}${hrefAttr}${targetAttr}${relAttr}>${content}</a>`,
    }
  },
}

registry.registerOrReplace(LinkModule)
