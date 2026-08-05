# Detailed Workflow

## 1. Establish the current contract

Read `docs/features/site-import.md` for whole-site static import and `docs/features/html-import.md` for body mapping. Read `docs/features/site-transfer.md` only for Instatic backup, restore, or Instatic-to-Instatic transfer. Load template, media, form, publisher, agent, or data-model docs when those branches are in scope.

Inspect current tests and code when a historical lesson may be stale. Historical plans and task summaries are not product contracts.

## 2. Create an isolated run

Use a unique datastore, uploads directory, port, and process. Record repository SHA and dirty state. Load local Instatic admin credentials from `/Users/da1/.codex/secrets/instatic-default-admin.env` when needed, without printing, copying, or committing the password.

Store customer binaries and raw evidence outside Git. Use a run record under a disposable or access-controlled directory. Preserve original inputs before correction.

## 3. Inventory and choose a lane

Follow `source-audit.md`. Reconcile route sources and decide editorial scope explicitly. Classify the migration as static presentation, structured content, or hybrid.

For every capability, record:

```text
source capability -> destination model -> capture/rebuild/adapter/retain/degrade -> verification
```

Do not equate a static page tree with migrated WordPress data or plugin semantics.

## 4. Prepare and preflight

Capture complete rendered HTML for each static route rather than an SPA shell that requires hydration to reveal content. Bundle required local CSS, media, and fonts. For external browser dependencies, choose intentionally between localization and retained remote loading; preserve source order, tag attributes, inline configuration, and dependency priority.

Validate:

- exact route and archive paths
- every HTML and CSS local reference
- unresolved remote URLs
- CSS imports and unsupported at-rules
- internal links and redirect targets
- route, slug, class, token, and stylesheet conflicts
- executable script inventory and backend dependencies
- archive hash and preparation transformations

Asset count and ZIP integrity alone do not prove references are correct.

## 5. Analyze and import

Use the canonical Site Import modal and its plan, Review, Conflicts, and Import stages. Choose stylesheet mode per top-level sheet:

- `convert` for editable rules when the authored cascade can be represented and reviewed
- `file` for page-scoped source fidelity or leakage isolation when conversion would be lossy

Neither mode is a universal default. Kept files reduce semantic extraction; conversion can create collisions or expose CSS-engine limitations.

Treat warnings as work items. Independently scan for unsupported constructs because parser exposure can vary. Remember that store writes are one undo entry while uploads are best-effort and not part of the reversible transaction.

## 6. Reconstruct missing semantics

Build deliberate Instatic models for structured content, templates, reusable chrome, redirects, forms, search, and plugin-backed capabilities included in scope. Choose a static dataset, native replacement, adapter, retained WordPress service, or accepted degradation for backend-fed widgets.

Never bypass Instatic sanitization or archive safety checks to gain fidelity.

## 7. Verify and repair

Run every applicable gate in `verification.md`. Use browser evidence for user-visible acceptance. Separate Design mode settings from importer defects, and compare Design, Live, and anonymous published output.

Diagnose the failure category before editing. Make site-specific compatibility changes outside the generic importer unless the root cause is an importer invariant. Add a focused regression test when changing importer behavior, then reimport into a clean or known-safe target and repeat affected gates.

For large sites, checkpoint before persistence, estimate serialized document size, and reduce save or validation concurrency when request limits or memory pressure appear. Do not copy historical batch sizes or memory thresholds without measuring the current run.

## 8. Capture learning

Complete the run log. Add candidates to `known-patterns.md` only after applying `learning-policy.md`. State predicates and non-implications directly. Version-stamp behavior and demote stale or contradicted entries.
