# Family Transitions, Inc. (familytransitionsinc.com)

Static website, hosted on Cloudflare Workers (Worker name: `familytransitionsinc`). Replaces the WordPress site.

- All site files live in `public/`.
- Every push to `main` deploys automatically through Cloudflare Workers Builds.
- `public/_redirects` holds the 301 map from the old WordPress URLs (Phase 1 audit).

## Dev vs. launch
The site is currently a **dev site**, hidden from search engines by `public/_headers` (X-Robots-Tag) and `public/robots.txt`.
At launch: remove the dev block in `_headers`, swap `robots.txt` to the launch version in its comments, add `sitemap.xml`, then point the domain at the Worker.

## Forms
Forms are placeholders until the built-in CRM (Phase 4). Do not wire them to third-party form services: they may carry health information (HIPAA).
