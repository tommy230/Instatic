# Verification Gates

Do not mark the migration complete until every in-scope gate passes or has an explicit accepted exception.

## G0 - Safety and provenance

- Target isolated or recoverably backed up
- Source, capture time, input hashes, preparation method, and runtime versions recorded
- Secrets and customer binaries excluded from Git and reports

## G1 - Baseline and scope

- Route/status/redirect inventory reconciled from selected discovery sources
- Representative archetypes and responsive screenshots captured
- Dynamic features, WordPress semantics, SEO, content, media, and exclusions mapped

## G2 - Bundle and plan

- ZIP integrity and safety checks pass
- Every local reference resolves to an exact archive entry
- Remote dependencies are inventoried and intentionally retained, localized, replaced, or excluded
- Every stylesheet mode is justified
- Every warning, dropped rule, unused CSS item, and conflict has a recorded disposition
- No silent overwrite or unexplained path normalization

## G3 - Commit integrity

- Selected and imported counts reconcile by category
- Zero unexplained asset upload failures
- Media, fonts, scripts, and dependencies resolve after draft reload
- Failed uploads and possible orphan assets are recorded

## G4 - Structure and editability

- Pages, routes, slugs, internal links, templates, and reusable chrome match the plan
- Representative headings, paragraphs, lists, whitespace-sensitive text, and `<br>` content enter inline editing
- Image replacement, button/link editing, section reorder, and section duplication work where promised
- Media alt text is verified in media metadata
- No unexplained global CSS leakage, duplicate shared styles, fragile generic-node soup, or lost body/data attributes

## G5 - Publish and public output

- Publish completes and survives reload
- Expected routes, aliases, redirects, and 404/status behavior work anonymously
- CSS, media, fonts, scripts, and dependencies load without unexplained console, network, CSP, or mixed-content failures
- Public pages make no unexpected request to the retired WordPress origin

## G6 - Visual and responsive behavior

- At least one page from every archetype checked at agreed desktop, tablet, and mobile widths
- Typography, spacing, layout, imagery, overflow, navigation, and interaction states compared with the baseline
- Design mode with required script setting, Live mode, and published output evaluated separately
- Tolerated differences documented instead of silently passed

## G7 - Content, SEO, and functionality

- Titles, descriptions, language, headings, canonicals, social metadata, structured data, and redirects checked against scope
- Forms, search, menus, anchors, downloads, embeds, maps, and plugin replacements work end to end or are explicitly out of scope
- Structured records, templates, relationships, archives, and bindings validated where promised

## G8 - Accessibility, performance, and durability

- Keyboard access, focus, labels, alt text, contrast, and responsive overflow receive a sanity pass
- Missing or oversized assets, obvious layout shifts, and resource failures reported
- Validation concurrency scaled to page and script weight
- Publish/reload and, when required, export/re-import preserve accepted behavior

## G9 - Learning closeout

- Each lesson candidate carries evidence, applicability, predicate, counterexamples, version, and verification
- Promotion rules applied independently of migration acceptance
- Product defects, documentation gaps, reusable conditional patterns, and site quirks reported separately
