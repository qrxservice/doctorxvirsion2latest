---
name: Production GeoIP startup
description: Bundled geoip-lite needs an explicit data directory when the API is published.
---

The published API must set `GEODATADIR` to the installed geoip-lite data directory before starting the bundled server; otherwise esbuild's runtime path points at a nonexistent artifact data folder and the health probe fails before the server listens.

**Why:** The local development command already supplied this environment value, which hid the production-only startup failure.

**How to apply:** Keep the production API start command responsible for resolving the package-local GeoIP data path, and verify `/api/healthz` with the production bundle before republishing.