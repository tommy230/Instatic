/**
 * base.link editor preview component.
 *
 * Component-only file so React Fast Refresh can hot-patch edits without
 * re-running module registration. The children-vs-text fallback and the
 * `rel` decision are shared with the publisher via `./content` and
 * `@modules/base/shared/anchorTarget`, so the canvas cannot drift from the
 * published markup.
 */
import React from 'react'
import type { ModuleComponentProps } from '@core/module-engine'
import { anchorRel } from '@modules/base/shared/anchorTarget'
import { htmlAttributesForReact } from '@modules/base/shared/htmlAttributes'
import { inlineEditableElementProps } from '@modules/base/shared/inlineText'
import { linkUsesChildren } from './content'
import type { LinkStoredProps } from './props'

export const LinkEditor: React.FC<ModuleComponentProps<LinkStoredProps>> = ({ props, children, mcClassName, nodeWrapperProps, inlineEdit }) => {
  const childCount = Array.isArray(children) ? children.length : children != null ? 1 : 0
  // Inline editing only starts on a childless link (text mode), so when
  // `inlineEdit` is set the element edits its `text` prop in place.
  const content = linkUsesChildren(childCount) ? children : (props.text ?? 'Link text')
  // Mirror the publisher's rel merge: authored tokens from the htmlAttributes
  // bag plus the security rel, emitted once so the canvas cannot drift.
  const { rel: authoredRel, ...bagWithoutRel } = htmlAttributesForReact(props.htmlAttributes)
  const relTokens = [
    ...(authoredRel ?? '').split(/\s+/).filter(Boolean),
    ...(props.target === null ? [] : (anchorRel(props.target)?.split(' ') ?? [])),
  ]
  const mergedRel = [...new Set(relTokens)].join(' ')
  return React.createElement(
    'a',
    {
      ...nodeWrapperProps,
      ...bagWithoutRel,
      href: props.href === null ? undefined : props.href,
      target: props.target === null ? undefined : props.target,
      rel: mergedRel || undefined,
      className: mcClassName,
      ...(inlineEdit ? inlineEditableElementProps(inlineEdit) : {}),
    },
    inlineEdit ? undefined : content,
  )
}
