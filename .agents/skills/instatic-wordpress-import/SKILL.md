---
name: instatic-wordpress-import
description: Import or migrate WordPress sites into Instatic with source inventory, static-bundle preparation, structured-content planning, isolated execution, browser verification, and evidence-backed learning capture. Use when asked to capture, clone, migrate, trial, diagnose, validate, or improve a WordPress-to-Instatic import, including full-site routes, assets, CSS, JavaScript, WordPress data, plugin behavior, SEO, redirects, editability, publishing, or accumulated importer lessons.
---

# Instatic WordPress Import

Use the current Instatic import contract and evidence from past runs to produce a migration that is editable, publishable, and explicitly scoped. Treat rendered-site import and WordPress data migration as different workstreams.

## Non-negotiables

- Read the current canonical docs before acting: `docs/features/site-import.md`, `docs/features/html-import.md`, and the feature docs relevant to templates, media, publishing, forms, or structured data.
- Use the shell-level Site Import workflow for a whole static site. Do not substitute Paste HTML, and do not treat a WordPress export as an Instatic `SiteBundle`.
- Work in an isolated target or make a recoverable backup. Never expose local admin secrets or commit customer databases, media, cookies, headers, nonces, form data, or unrestricted browser captures.
- Preserve immutable provenance and validate the prepared bundle before mutating Instatic.
- Review every warning and conflict. Never infer fidelity from import counters or a success screen.
- Verify editor behavior, publish, anonymous public output, routes, responsive rendering, and interactions separately.
- Record new lessons as observations first. Never generalize a site-specific workaround because it succeeded once.

## Choose the migration lane

1. **Static presentation**: preserve rendered routes, CSS, media, fonts, and browser-side behavior.
2. **Structured content**: inventory and deliberately model posts, custom post types, taxonomies, fields, templates, redirects, and relationships.
3. **Hybrid**: use static capture for presentation while rebuilding selected WordPress semantics in Instatic.

Inventory forms, search, maps, commerce, membership, booking, plugin widgets, REST, `admin-ajax`, nonces, and server-side behavior separately. Choose capture, replacement, adapter, retained service, or explicit degradation for each. Static visual success does not prove WordPress semantic parity.

## Run the workflow

1. Read [references/workflow.md](references/workflow.md) and create a run record from [references/run-log-template.md](references/run-log-template.md).
2. Audit the source with [references/source-audit.md](references/source-audit.md). Reconcile sitemaps, crawled routes, redirects, and authorized WordPress inventory rather than trusting one source.
3. Select the lane and map every promised source capability to an Instatic destination or an explicit out-of-scope decision.
4. Prepare a deterministic bundle. Preserve relative paths, script order and attributes, and dependency priority. Resolve every local HTML and CSS reference against exact archive entries before import.
5. Build and review the import plan. Give every conflict, warning, dropped rule, unused stylesheet, and missing dependency an explicit disposition. Select `convert` or `file` per stylesheet, based on editability, fidelity, cascade, and leakage risk.
6. Import into an isolated runtime. Reconcile selected and imported counts, then reload the draft before evaluating it.
7. Run [references/verification.md](references/verification.md). Invoke the repo's `instatic-user-e2e` skill for browser-visible editor, publish, responsive, accessibility, and interaction evidence.
8. Classify failures before repairing them: source defect, bundle defect, importer defect, editor setting, editor-runtime parity, script lifecycle, split plugin configuration, backend dependency, or site-specific content decision.
9. Re-run affected gates after every repair. Keep source fixes, importer fixes, and site compatibility work distinct.
10. Close the run using [references/learning-policy.md](references/learning-policy.md). Compare candidates against [references/known-patterns.md](references/known-patterns.md), add regression coverage where possible, and promote only when the evidence threshold is met.

## Current behavior is versioned

Past runs span different Instatic revisions and capture methods. Re-check any version-sensitive claim against current docs, code, tests, and a small probe. Old plans, task summaries, and trial reports are evidence, not current product contracts.
