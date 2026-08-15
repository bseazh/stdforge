# Module 2: Standards intelligence platform

This directory preserves and deploys the runnable module from
`heyy259/haixin_policy_reseach` as an independent StdForge module. It is
synchronized with upstream `std-crawler` revision `4a605daa` (2026-08-15).

- Frontend: `index.html` and `std-crawler/frontend/`
- Service: `std-crawler/serve-demo.mjs`
- Capabilities: daily collection alerts, collection, alerts, competitor
  analysis, and standards-organization tracking
- Production route: `/module2/index.html`
- Production API: `/module2/api/*`
- Local run: `npm run start:module2`

StdForge-specific changes are limited to navigation, the `/module2` API
prefix, deployment environment loading, the return-to-workspace link, and
the existing recipient-management link.
