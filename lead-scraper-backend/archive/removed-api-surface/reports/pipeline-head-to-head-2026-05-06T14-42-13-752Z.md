# Pipeline head-to-head
- Generated: 2026-05-06T14:41:26.802Z
- Query: `electrical contractor`
- Max companies per region (discovery): 12
- Enrichment sample size per path per region: **3**
## Summary
| Metric | Google pipeline | Apollo pipeline |
|--------|-----------------|-----------------|
| Companies discovered (sum of 4 regions) | 48 | 33 |
| Strong owner / DM (3×4 regions max) | 0 / 12 | 0 / 11 |
## By region
### Southern Ontario
- Google discovery: 12 companies
- Apollo discovery: 8 companies
- Name overlap (normalized): 2 | Jaccard 0.11
### Ohio
- Google discovery: 12 companies
- Apollo discovery: 11 companies
- Name overlap (normalized): 1 | Jaccard 0.05
### New York (non-NYC)
- Google discovery: 12 companies
- Apollo discovery: 2 companies
- Name overlap (normalized): 0 | Jaccard 0.00
### Texas
- Google discovery: 12 companies
- Apollo discovery: 12 companies
- Name overlap (normalized): 1 | Jaccard 0.04
Strong owner = non-empty owner name after full enrich (Google path) or Apollo people merge (Apollo path). Discovery counts sum across regions (not deduped across regions).
Raw JSON: `pipeline-head-to-head-2026-05-06T14-42-13-752Z.json`