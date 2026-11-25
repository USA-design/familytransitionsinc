# Family Transitions, Inc. (familytransitionsinc.com)

Static website, hosted on Cloudflare Workers (Worker name: `familytransitionsinc`). Replaces the WordPress site.

- All site files live in `public/`.
- Every push to `main` deploys automatically through Cloudflare Workers Builds.
- `public/_redirects` holds the 301 map from the old WordPress URLs (Phase 1 audit).

## Dev vs. launch
The site is currently a **dev site**, hidden from search engines by `public/_headers` (X-Robots-Tag) and `public/robots.txt`.
At launch:
1. Remove the dev block in `public/_headers`.
2. Copy `launch/robots.txt` over `public/robots.txt` (allows search engines and AI crawlers, points to the sitemap).
3. Point the domain at the Worker, then submit `https://familytransitionsinc.com/sitemap.xml` in Google Search Console and Bing Webmaster Tools.

`tools/build.py` regenerates every page, `sitemap.xml` and `llms.txt` (the plain-language summary AI assistants read). Run `python3 tools/build.py` after editing content.

## Forms
Forms are placeholders until the built-in CRM (Phase 4). Do not wire them to third-party form services: they may carry health information (HIPAA).
