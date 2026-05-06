# Legacy API archive (reference)

Phase 1 default behavior:

- Discovery: Google Places only (`src/services/googlePlaces.js`).
- Contact enrichment: Hunter → PDL → strict AI orchestrator (`src/services/enrichmentOrchestrator.js`).

## Where previous integrations live

- **Apollo**, **deprecated `mixed_people/search`**, **Yelp**, **Numverify**, and standalone Hunter email verifier routes are mounted from [`legacy-integrations.js`](legacy-integrations.js) via `registerLegacyRoutes(app)`. See Git history prior to modular refactor if you need the original monolithic `server.js`.

## Deprecated Apollo people search note

Apollo has deprecated `mixed_people/search` for many API callers; use `mixed_people/api_search` for new integrations (documented separately in Apollo docs).
