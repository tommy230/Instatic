import type { CSSDeclarationPriorityBag } from '@core/page-tree'
import type { NewStyleRule } from './types'

export interface DeclarationLayer {
  styles: Record<string, unknown>
  priorities: CSSDeclarationPriorityBag
}

export interface CascadedStyleRuleLayers {
  styles: Record<string, unknown>
  stylePriorities: CSSDeclarationPriorityBag
  contextStyles: Record<string, Record<string, unknown>>
  contextStylePriorities: Record<string, CSSDeclarationPriorityBag>
  contextOrder: string[]
}

export function createCascadedStyleRuleLayers(): CascadedStyleRuleLayers {
  return {
    styles: {},
    stylePriorities: {},
    contextStyles: {},
    contextStylePriorities: {},
    contextOrder: [],
  }
}

/**
 * Merge equal-specificity declaration fragments in source order. An existing
 * important declaration resists a later normal declaration; otherwise the
 * later value wins. Re-inserting winners also preserves their later authored
 * position relative to shorthand declarations.
 */
export function mergeDeclarationCascade(
  target: DeclarationLayer,
  incoming: DeclarationLayer,
): void {
  for (const [property, value] of Object.entries(incoming.styles)) {
    const currentImportant = target.priorities[property] === 'important'
    const incomingImportant = incoming.priorities[property] === 'important'
    if (currentImportant && !incomingImportant) continue

    delete target.styles[property]
    target.styles[property] = value
    if (incomingImportant) target.priorities[property] = 'important'
    else delete target.priorities[property]
  }
}

export function mergeStyleRuleCascade(
  target: CascadedStyleRuleLayers,
  incoming: NewStyleRule,
): void {
  mergeDeclarationCascade(
    { styles: target.styles, priorities: target.stylePriorities },
    { styles: incoming.styles, priorities: incoming.stylePriorities ?? {} },
  )
  const incomingContextStyles = incoming.contextStyles ?? {}
  const incomingDeclaredOrder = incoming.contextOrder ?? []
  const incomingDeclaredIds = new Set(incomingDeclaredOrder)
  const incomingContextOrder = [...new Set([
    ...incomingDeclaredOrder,
    ...Object.keys(incomingContextStyles).filter((id) => !incomingDeclaredIds.has(id)),
  ])]
  const targetContextIds = new Set(target.contextOrder)
  for (const contextId of incomingContextOrder) {
    const styles = incomingContextStyles[contextId]
    if (!styles) continue
    if (!targetContextIds.has(contextId)) {
      target.contextOrder.push(contextId)
      targetContextIds.add(contextId)
    }
    if (!target.contextStyles[contextId]) target.contextStyles[contextId] = {}
    if (!target.contextStylePriorities[contextId]) target.contextStylePriorities[contextId] = {}
    mergeDeclarationCascade(
      {
        styles: target.contextStyles[contextId],
        priorities: target.contextStylePriorities[contextId],
      },
      {
        styles,
        priorities: incoming.contextStylePriorities?.[contextId] ?? {},
      },
    )
  }
}

export function sparsePriorities(
  priorities: CSSDeclarationPriorityBag,
): CSSDeclarationPriorityBag | undefined {
  return Object.keys(priorities).length > 0 ? priorities : undefined
}

export function sparseContextPriorities(
  priorities: Record<string, CSSDeclarationPriorityBag>,
): Record<string, CSSDeclarationPriorityBag> | undefined {
  const sparse = Object.fromEntries(
    Object.entries(priorities).filter(([, bag]) => Object.keys(bag).length > 0),
  )
  return Object.keys(sparse).length > 0 ? sparse : undefined
}

export function mergeRuleBaseDeclarations(
  rule: NewStyleRule,
  incoming: DeclarationLayer,
): void {
  const priorities = { ...(rule.stylePriorities ?? {}) }
  mergeDeclarationCascade({ styles: rule.styles, priorities }, incoming)
  const sparse = sparsePriorities(priorities)
  if (sparse) rule.stylePriorities = sparse
  else delete rule.stylePriorities
}

export function mergeRuleContextDeclarations(
  rule: NewStyleRule,
  contextId: string,
  incoming: DeclarationLayer,
): void {
  const styles = rule.contextStyles[contextId] ?? {}
  const priorities = { ...(rule.contextStylePriorities?.[contextId] ?? {}) }
  mergeDeclarationCascade({ styles, priorities }, incoming)
  const isNewContext = rule.contextStyles[contextId] === undefined
  rule.contextStyles[contextId] = styles

  // Registry order is global first-seen order. Record when this rule first met
  // each context so equal-specificity overrides retain their source order.
  if (isNewContext) {
    rule.contextOrder = [...(rule.contextOrder ?? []), contextId]
  }

  const sparse = sparsePriorities(priorities)
  if (sparse) {
    if (!rule.contextStylePriorities) rule.contextStylePriorities = {}
    rule.contextStylePriorities[contextId] = sparse
  } else if (rule.contextStylePriorities) {
    delete rule.contextStylePriorities[contextId]
    if (Object.keys(rule.contextStylePriorities).length === 0) {
      delete rule.contextStylePriorities
    }
  }
}
