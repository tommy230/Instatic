# Known Patterns

These entries summarize evidence available through 2026-07-28. Apply `learning-policy.md`; predicates and non-implications are part of each claim.

## IP-001 - Validate resolved references against exact archive entries

- Evidence: `verified`; applicability: `universal-invariant`; state: `validated`
- Claim: Before a static import, resolve every local URL in HTML and CSS and require an exact matching bundle entry.
- Does not imply: a `public/assets` prefix or any other archive layout is universally correct.
- Evidence: Carolina invalid and corrected arms had identical HTML and asset bytes. Moving entries from `assets/*` to the paths actually referenced as `public/assets/*` restored images and fonts. Both arms reported 183 rules and 50 media, so counts did not reveal the defect.
- Sources: 2026-07-22 Carolina trial, `instatic-trial-ops/TRIAL-RESULTS.md`; current `siteImport` path and asset tests.
- Sites: Carolina Construction Services; cause also follows current bundle resolution mechanics.
- Verification: fail preflight on missing local references and preserve a reference manifest.

## IP-002 - Import counters are reconciliation data, not acceptance evidence

- Evidence: `verified`; applicability: `universal-invariant`; state: `validated`
- Claim: Require browser, structural, route, and published-output verification even when importer counters reconcile.
- Does not imply: counters are unimportant. Use them to detect omissions, not to establish fidelity.
- Evidence: the invalid and corrected Carolina bundles produced the same page, rule, and media counts but materially different rendering. Git history also records silent token, font, SVG, and conditional CSS losses found only through source/output comparison.
- Verification: complete G3 through G8 independently.

## IP-003 - Localize required external browser dependencies when static capture cannot supply them

- Evidence: `verified`; applicability: `conditional-pattern`; state: `validated`
- Predicate: a rendered static import depends on absolute external CSS or browser JavaScript that is not otherwise available to the Instatic import plan or desired deployment.
- Action: localize the required dependencies while preserving source order, tag attributes, inline configuration, and dependency priority, then retest all runtime surfaces.
- Does not imply: localize every external asset, that localized code is safe or portable, or that backend-fed behavior will work.
- Evidence: Vantage improved from 123 rules, 3 inline scripts, and no media to 2,986 rules and 13 scripts after localizing 7 CSS and 10 functional JS files. 300 South Tryon repeated the pattern with 25 CSS and 24 external JS files, while backend map data still failed.
- Versions/sites: historical Instatic 0.0.11-era Vantage and 300 South Tryon runs. Revalidate current behavior.
- Verification: dependency manifest, console/network review, Design with scripts, Live, published desktop, and published mobile.

## IP-004 - Separate editor settings, editor runtime, and published runtime

- Evidence: `verified`; applicability: `conditional-pattern`; state: `validated`
- Predicate: the imported site uses scripts, animations, responsive frames, or interaction code.
- Action: normalize zoom, pan, and viewport; test Design with the required script setting, Live, and anonymous published output separately.
- Does not imply: every Design-only defect is merely a setting or that published success excuses poor editability.
- Evidence: Vantage and 300 South Tryon appeared broken with scripts off or the canvas mispositioned while Live or published behavior remained intact.
- Verification: record all surfaces independently and classify the first failing boundary.

## IP-005 - Treat WordPress-backed features as a separate portability class

- Evidence: `verified`; applicability: `conditional-pattern`; state: `validated`
- Predicate: a feature uses REST, `admin-ajax`, nonces, authentication, plugin feeds, server-side submissions, commerce, search, maps, calendars, directories, or similar WordPress services.
- Action: choose captured data, an Instatic-native replacement, a documented adapter, retained external service, or accepted degradation.
- Does not imply: all WordPress plugins fail or that browser-only scripts require replacement.
- Evidence: 300 South Tryon carousels worked while map markers backed by WordPress did not. South America Mission exposed form, events, REST, and consent configuration dependencies.
- Verification: test the actual user outcome end to end, including failure and persistence states where relevant.

## IP-006 - Reconcile route truth from multiple sources

- Evidence: `verified`; applicability: `conditional-pattern`; state: `validated`
- Predicate: the source contains multiple route families or the migration claims full-site coverage.
- Action: reconcile sitemaps, public crawl, redirect/canonical resolution, and authorized WordPress inventory. Inspect representative custom-post and attachment routes before inclusion or exclusion.
- Does not imply: every discovered or orphaned object belongs in the migrated information architecture.
- Evidence: 300 South Tryon hosted inventory found published content omitted by the prior sitemap; Arcadia expanded to 313 routes including custom-post families; South America Mission inventoried 1,095 URLs and excluded 751 attachment shells only after review.
- Verification: preserve discovery sets and editorial decisions separately, then validate every included route and internal link.

## IP-007 - Canonicalize redirects and unrepresentable legacy paths

- Evidence: `verified`; applicability: `conditional-pattern`; state: `validated`
- Predicate: WordPress redirects a source link or an Instatic slug cannot preserve the original path exactly.
- Action: resolve canonical destinations before capture and create an explicit redirect or alias map for accepted legacy paths.
- Does not imply: always replace underscores or copy every historical redirect.
- Evidence: a 300 South Tryon source link depended on a WordPress redirect; Arcadia and South America Mission produced many version-bound underscore-to-hyphen aliases.
- Verification: crawl published internal links and test the agreed legacy path set.

## IP-008 - Scale persistence and validation to serialized size and script weight

- Evidence: `verified`; applicability: `conditional-pattern`; state: `validated`
- Predicate: projected site-document size, page-scoped scripts, or observed memory approaches request or machine limits.
- Action: checkpoint before persistence, use bounded incremental saves when required, and reduce rendered-page concurrency while preserving exhaustive static-file and link checks.
- Does not imply: use historical five-page batches or fixed concurrency for every site.
- Evidence: South America Mission hit HTTP 413 on a 289 MB replace save and succeeded with bounded incremental persistence. Arcadia and South America Mission showed high-concurrency rendered validation could add severe memory pressure.
- Verification: record size, request limits, memory, batch/concurrency choice, recovery result, and representative HTTP smoke evidence.

## IP-009 - Verify editability, including line-break text

- Evidence: `verified`; applicability: `conditional-pattern`; state: `candidate`
- Predicate: source text contains `<br>`-only child markup or other whitespace-sensitive structures.
- Action: confirm representative text imports as an editable Text module and retains its intended line breaks. Preserve genuinely mixed nested markup structurally.
- Does not imply: flatten links, styled spans, or arbitrary mixed content into plain text.
- Evidence: 300 South Tryon produced raw text and `<br>` children under a Container, blocking inline editing. A focused importer change and clean reimport restored a single editable Text module and passed browser and regression checks.
- Version note: evidence comes from the current dirty Instatic worktree and must be revalidated after the fix is committed or changed.
- Verification: double-click headings, paragraphs, lists, and line-break text; edit and reload.

## IP-010 - A complete rendered document is the static baseline

- Evidence: `verified`; applicability: `conditional-pattern`; state: `validated`
- Predicate: the selected lane is static presentation import.
- Action: provide complete rendered route HTML plus its required assets rather than a client shell that depends on hydration to reveal page structure.
- Does not imply: static capture is always the right WordPress migration lane.
- Evidence: the Carolina React-prerender comparison retained semantic structure but lost most Tailwind v4 rules because unsupported `@layer` and `@property` constructs were dropped on Instatic 0.0.11. The corrected rendered-static arm showed substantially better editor fidelity for that page.
- Caveat: this was one reconstructed Carolina homepage and does not establish a universal preference for Ditto, React, or direct capture.
- Verification: inspect initial HTML for complete meaningful content and inventory unsupported CSS before import.

## IP-011 - Static import does not migrate WordPress semantics

- Evidence: `canonical`; applicability: `universal-invariant`; state: `validated`
- Claim: Site Import maps static files into Instatic pages, styles, media, fonts, and runtime assets. It does not inherently recreate WordPress post types, taxonomies, plugin data, backend behavior, users, comments, server-side forms, search, commerce, memberships, bookings, redirects, or complete head metadata.
- Does not imply: those capabilities cannot be migrated through a structured or hybrid workstream.
- Sources: current `docs/features/site-import.md`, `docs/features/html-import.md`, and absence of a WordPress-specific adapter in current code/tests.
- Verification: require an explicit semantic mapping for every promised capability.

## IP-012 - Shared plugin runtime ordering is a diagnostic pattern, not an automatic fix

- Evidence: `observed`; applicability: `site-specific`; state: `candidate`
- Claim: South America Mission's Complianz runtime failed when a shared deduplicated script ran before page-scoped configuration and required root custom properties were lost.
- Action: when a plugin survives structurally but fails at runtime, inspect configuration ordering, script lifecycle, and CSS custom-property retention before rewriting code.
- Does not imply: install the South America compatibility layer on other sites or reorder all shared scripts.
- Verification: plugin-specific desktop/mobile behavior, persistence, reopen, secondary route, console, and network evidence.

## IP-013 - Unsupported CSS findings remain version-bound

- Evidence: `canonical` for current unsupported categories and `observed` for historical outcomes; applicability: `conditional-pattern`; state: `needs-revalidation`
- Predicate: source CSS contains `@layer`, conditional local imports, arbitrary external imports, or other constructs named unsupported by current docs.
- Action: scan source independently, record every construct, and choose preprocessing, kept-file mode, reconstruction, or accepted loss before import.
- Does not imply: flattening layers is always correct or all Tailwind sites fail.
- Evidence: historical Carolina Tailwind v4 input lost 62 at-rules and layout. Current docs still list unsupported categories, but importer behavior and stylesheet modes have evolved.
- Verification: current-version fixture plus published visual and cascade comparison.

## Explicitly unresolved

- Fleet-wide WordPress migration success rates. Historical percentages were estimates, not measurements.
- A universal preference for direct capture, Ditto reconstruction, or another producer.
- Automatic inclusion or exclusion of orphan content, attachment pages, tracking code, remote media, or plugin routes.
- A universal script timing rewrite. DOM-ready and shared-config fixes require component-level causal evidence.
- Whether current Instatic internals can share all cross-page runtime assets without expansion. Probe the current build.
