# WordPress Source Audit

Record evidence before capture or import.

## Provenance and safety

- Source URL, capture/export time, environment, and authorization
- WordPress, theme, builder, and relevant plugin versions when available
- Instatic version, commit, Bun version, capture tools, and preparation script commit
- Sanitized run manifest and hashes for immutable inputs
- Explicit exclusions and data-retention boundaries

Never retain passwords, cookies, authorization headers, application passwords, nonces, raw form values, request bodies, unrestricted HAR files, `wp-config.php`, `.env`, user/order/submission/session data, or bulk private options/meta.

## Route truth

- Every sitemap and sitemap family
- Public crawl results, status codes, redirect chains, canonicals, pagination, feeds, and linked routes
- Authorized WordPress inventory for published pages, posts, custom post types, taxonomies, archives, templates, and orphan objects
- Representative route from every archetype before excluding a family
- Attachment routes retained in inventory and excluded only after content review
- Source paths that Instatic cannot represent exactly and their redirect or alias plan

Existence does not decide editorial inclusion. Keep discovery evidence separate from migration scope.

## Presentation and content

- Desktop, tablet, and mobile baselines for every representative archetype
- Shared header, footer, navigation, templates, and theme parts
- Headings, text, lists, tables, whitespace-sensitive content, images, SVG, video, embeds, downloads, and inline backgrounds
- Media and font inventory, alt text, captions, variants, and origin ownership
- CSS files, imports, custom properties, unsupported at-rules, cascade order, breakpoints, and page scope
- External and inline scripts, order, attributes, dependencies, data attributes, runtime-created classes, and event timing

## WordPress semantics and behavior

- Post types, taxonomies, fields, relationships, authorship, dates, slugs, and status
- Menus, widgets, sidebars, blocks, shortcodes, full-site editing templates/parts, and global styles
- Forms, search, maps, directories, calendars, commerce, membership, booking, gated content, analytics, and consent
- REST, `admin-ajax`, nonces, authenticated endpoints, scheduled jobs, and other backend dependencies
- SEO titles, descriptions, canonical URLs, robots rules, structured data, social metadata, language, redirects, and error behavior

Treat the delivered public runtime as authority for observed behavior. Configuration and database inventory establish what is present or configured, not what successfully reaches users.

## Bounded interaction capture

Capture safe before-and-after evidence for navigation, dialogs, tabs, accordions, sliders, search UI, and dry forms. Avoid submit, purchase, delete, login, logout, and admin mutations unless the user explicitly authorizes them. Store compact sanitized facts and artifact links rather than large raw DOM, source, or network captures.
