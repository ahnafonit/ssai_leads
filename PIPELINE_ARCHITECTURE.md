# Lead Extraction Pipeline — Architecture Document

Technical reference for the modular lead extraction pipeline. Covers all APIs, pipeline stages, data flow, merge logic, conflict resolution, and frontend configuration.

---

## Table of Contents

1. [API Inventory](#1-api-inventory)
2. [Pipeline Stages Overview](#2-pipeline-stages-overview)
3. [Stage Details](#3-stage-details)
4. [Endpoint-to-Stage Mapping](#4-endpoint-to-stage-mapping)
5. [Dependencies and Constraints](#5-dependencies-and-constraints)
6. [Data Model](#6-data-model)
7. [Conflict Resolution Rules](#7-conflict-resolution-rules)
8. [Efficiency / Skip Logic](#8-efficiency--skip-logic)
9. [Cooperative Behavior Matrix](#9-cooperative-behavior-matrix)
10. [Frontend Configuration Schema](#10-frontend-configuration-schema)

---

## 1. API Inventory

### 1.1 Google Places

| Endpoint | Method | URL | Access | Cost |
|---|---|---|---|---|
| Text Search (Legacy) | GET | `maps.googleapis.com/maps/api/place/textsearch/json` | YES | ~$17/1K calls |
| Place Details (Legacy) | GET | `maps.googleapis.com/maps/api/place/details/json` | YES | ~$17/1K calls |
| Text Search (New) | POST | `places.googleapis.com/v1/places:searchText` | YES | Session-based |

**Input:** `query` (keyword + location), `key`, optional `locationbias`/`locationRestriction`, pagination tokens  
**Output:** `name`, `phone`, `address`, `city`, `state`, `zipcode`, `country`, `website`, `rating`, `reviewCount`, `types`, `latitude`, `longitude`, `placeId`  
**Does NOT return:** owner name, email, employee count, revenue, social media

### 1.2 Apollo.io

| Endpoint | Method | URL | Access | Cost |
|---|---|---|---|---|
| Organization Search | POST | `api.apollo.io/api/v1/mixed_companies/search` | YES | Free tier |
| Organization Enrich | GET | `api.apollo.io/api/v1/organizations/enrich` | YES | Free tier |
| People Search (NEW) | POST | `api.apollo.io/api/v1/mixed_people/api_search` | YES | Free tier, no credits consumed |
| People Match/Enrich | POST | `api.apollo.io/api/v1/people/match` | YES | Free tier, 1 credit/person |
| Bulk People Enrich | POST | `api.apollo.io/api/v1/people/bulk_match` | YES | Free tier |
| People Search (OLD) | POST | `api.apollo.io/api/v1/mixed_people/search` | DEPRECATED | Do not use |
| Email Accounts | GET | `api.apollo.io/api/v1/email_accounts` | BLOCKED (403) | N/A |

**Organization Search Input:** `q_organization_name`, `organization_locations[]`, `organization_num_employees_ranges[]`, `revenue_range`, `currently_using_any_of_technology_uids[]`, `q_organization_keyword_tags[]`, `page`, `per_page`  
**Organization Search Output:** `name`, `phone`, `raw_address`, `city`, `state`, `country`, `postal_code`, `industry`, `website_url`, `estimated_num_employees`, `annual_revenue_printed`, `founded_year`, `technology_names[]`, `linkedin_url`, `twitter_url`, `facebook_url`, `logo_url`, `id` (org_id)

**Organization Enrich Input:** `domain` (best), or `name` + optional `location`  
**Organization Enrich Output:** Same fields as Org Search, for a single matched organization

**People Search (NEW) Input:** `q_organization_domains_list[]`, `q_organization_name`, `organization_ids[]`, `person_titles[]`, `person_seniorities[]`, `person_locations[]`, `per_page`  
**People Search (NEW) Output:** `id`, `first_name`, `last_name_obfuscated`, `title`, `has_email`, `has_direct_phone`, `organization` (nested). **Does NOT return: email, phone, last name, linkedin.** Must follow up with People Match/Enrich to get full contact.

**People Match/Enrich Input (in order of effectiveness):**

| Input Combination | Accuracy | Example |
|---|---|---|
| `email` alone | Highest | `email: "joe@joesmfg.com"` |
| `first_name` + `last_name` + `domain` | High | `first_name: "Joe", last_name: "Martinez", domain: "joesmfg.com"` |
| `linkedin_url` | High | `linkedin_url: "linkedin.com/in/joemartinez"` |
| `first_name` + `last_name` + `organization_name` | Medium | `first_name: "Joe", last_name: "Martinez", organization_name: "Joe's Mfg"` |
| `name` (full) + `organization_name` | Medium-Low | `name: "Joe Martinez", organization_name: "Joe's Mfg"` |
| `name` + `domain` | Medium | `name: "Joe Martinez", domain: "joesmfg.com"` |
| `organization_name` alone | Does not work | Returns null |
| `domain` alone | Does not work | Returns null |

**People Match/Enrich Output:** `name`, `first_name`, `last_name`, `title`, `email`, `email_status`, `city`, `state`, `country`, `linkedin_url`, `twitter_url`, `photo_url`, `seniority`, `departments[]`, `organization` (nested: name, industry, estimated_num_employees, annual_revenue_printed), `employment_history[]`, `id` (person_id), `organization_id`

### 1.3 People Data Labs (PDL)

| Endpoint | Method | URL | Access | Cost |
|---|---|---|---|---|
| Person Search (SQL) | GET | `api.peopledatalabs.com/v5/person/search` | YES | $0.01-0.10/record |
| Person Enrich | GET | `api.peopledatalabs.com/v5/person/enrich` | YES (limited data on free tier) | $0.01-0.10/record |
| Company Enrich | GET | `api.peopledatalabs.com/v5/company/enrich` | YES | $0.01-0.10/record |
| Company Search (SQL) | GET | `api.peopledatalabs.com/v5/company/search` | YES | $0.01-0.10/record |
| Bulk Person Enrich | POST | `api.peopledatalabs.com/v5/person/bulk` | YES | Batch pricing |
| Autocomplete | GET | `api.peopledatalabs.com/v5/autocomplete` | YES | Free |

**Person Search Input:** `sql` (SQL query against person table), `size` (max results)  
**SQL fields:** `job_company_name`, `job_title`, `job_title_role`, `location_locality`, `location_region`, `location_country`, `job_start_date`  
**Important:** Use `LIKE '%value%'` not exact `=` matching. `LIMIT` and `ORDER BY` are NOT supported — use `size` parameter.  
**Person Search Output:** `full_name`, `first_name`, `last_name`, `middle_name`, `job_title`, `job_title_role`, `job_company_name`, `job_company_website`, `job_company_industry`, `job_company_size`, `job_start_date`, `emails[]` (with type: professional/personal, current flag), `phone_numbers[]`, `linkedin_url`, `linkedin_username`, `facebook_url`, `twitter_url`, `github_url`, `location_name`, `location_locality`, `location_region`, `location_country`, `skills[]`, `interests[]`, `experience[]`, `education[]`, `id`

**Person Enrich Input:** `email`, `profile` (LinkedIn URL), `first_name` + `last_name` + `company`, or combinations  
**Person Enrich Output:** Same fields as Person Search, for a single matched person. Note: returned empty data in testing on free tier — may be plan-limited.

**Company Enrich Input:** `website` (best), or `name` + optional `location`, `locality`, `region`, `country`  
**Company Enrich Output:** `name`, `size` (range string like "11-50"), `industry`, `founded`, `linkedin_url`, `website`  
**Does NOT return:** revenue, tech stack, facebook/twitter

**Company Search Input:** `sql` (SQL query against company table), `size`  
**Company Search Output:** Same fields as Company Enrich, for multiple results

### 1.4 Hunter.io

| Endpoint | Method | URL | Access | Cost |
|---|---|---|---|---|
| Domain Search | GET | `api.hunter.io/v2/domain-search` | YES | Quota-based (~$0.02/call on Starter) |
| Email Verifier | GET | `api.hunter.io/v2/email-verifier` | YES | Quota-based |

**Domain Search Input:** `domain` (REQUIRED), `api_key`, `limit`  
**Domain Search Output:** `domain`, `organization`, `emails[]` (each with: `value`, `type`, `confidence` 0-100, `first_name`, `last_name`, `position`, `department`, `seniority`)  
**Does NOT return:** phone numbers, LinkedIn URLs, employee count

**Email Verifier Input:** `email` (REQUIRED), `api_key`  
**Email Verifier Output:** `email`, `status` (valid/invalid/accept_all/webmail/disposable/unknown), `score` (0-100), `result` (deliverable/undeliverable/risky/unknown), `regexp`, `gibberish`, `disposable`, `webmail`, `mx_records`, `smtp_server`, `smtp_check`, `accept_all`, `block`

### 1.5 Yelp Fusion

| Endpoint | Method | URL | Access | Cost |
|---|---|---|---|---|
| Business Match | GET | `api.yelp.com/v3/businesses/matches` | YES | Free (5K/day) |
| Business Details | GET | `api.yelp.com/v3/businesses/{id}` | YES | Free (5K/day) |
| Business Search | GET | `api.yelp.com/v3/businesses/search` | YES | Free (5K/day) |

**Business Match Input:** `name` (required), `address1`, `city`, `state`, `country` (2-letter ISO), `zip_code`, `phone`  
**Business Match Output:** `id`, `url` (only IDs — must follow up with Details)

**Business Details Output:** `name`, `phone`, `display_phone`, `url`, `rating`, `review_count`, `categories[]`, `location` (display_address, zip_code, city, state, country), `coordinates`, `image_url`, `photos[]`, `price`, `hours[]`, `is_closed`, `transactions[]`

### 1.6 Numverify

| Endpoint | Method | URL | Access | Cost |
|---|---|---|---|---|
| Phone Validation | GET | `apilayer.net/api/validate` | YES | Free: 100/month, paid from $15/month |

**Input:** `access_key`, `number` (digits only, no +), `format`, optional `country_code`  
**Output:** `valid` (bool), `number`, `local_format`, `international_format`, `country_code`, `country_name`, `location`, `carrier`, `line_type` (landline/mobile/voip/toll_free)  
**Note:** Free tier uses HTTP only (no HTTPS)

### 1.7 OpenAI (ChatGPT)

| Endpoint | Method | Access | Cost |
|---|---|---|---|
| Chat Completions (GPT-4o) | POST (via SDK) | YES | ~$2.50/1M input, ~$10/1M output tokens |

**Input (prompt fields):** `companyName`, `city`, `state`, `country`, `industry`  
**Output (parsed JSON):** `ownerName`, `industry`, `employeeCount`, `revenue`, `businessDetails`, `confidence` (0-100)  
**Nature:** Guesses from training data. Not a database lookup. Confidence is self-reported and unreliable.

### 1.8 Anthropic (Claude)

| Endpoint | Method | Access | Cost |
|---|---|---|---|
| Messages (Claude Sonnet) | POST (via SDK) | YES | ~$3/1M input, ~$15/1M output tokens |

**Input/Output:** Same as ChatGPT (identical prompt structure).

---

## 2. Pipeline Stages Overview

### 2.1 The Stages

| Stage | Name | Toggleable? | Sub-toggles | Purpose |
|---|---|---|---|---|
| **A** | Google Discovery | Default ON, can be disabled if A2 is on | None | Find local businesses by keyword + location |
| **A2** | Apollo Org Discovery | Optional | None | Find companies by B2B filters (size, revenue, industry, tech) |
| **B** | Company Enrichment | Optional | Apollo Org Enrich, PDL Company Enrich, PDL Company Search | Add company metadata: size, revenue, industry, org_id |
| **C** | Hunter Email Search | Optional | None | Find emails + contact names from a company's domain |
| **D** | Apollo People | Optional | Apollo People Search, Apollo People Match/Enrich | Find decision-makers and validate/enrich their profiles |
| **E** | PDL Person | Optional | PDL Person Search, PDL Person Enrich | Find owner by company name; richest person data |
| **F** | AI Enrichment | Optional | Claude, ChatGPT | Last-resort name guessing + industry classification |
| **G** | Verification | Optional | Numverify (phone), Hunter Email Verify, Yelp Business Match | Validate phone, email, and business existence |

### 2.2 Execution Order

Stages always execute in fixed order: **A / A2 -> B -> C -> D -> E -> F -> G**

Disabled stages are skipped. The order never changes. When a stage runs, it reads from and writes to a shared `LeadContext` object, so later stages benefit from earlier stages' output.

### 2.3 Core Principle: Independent but Cooperative

Every stage (except A/A2, at least one of which must be on):
- **Works standalone** — given just base lead data, it can do its job
- **Works better cooperatively** — if prior stages ran, it reads richer context for smarter API calls
- **Never breaks if a peer is disabled** — gracefully degrades to solo mode
- **Writes to shared context** — so later stages benefit from its output

### 2.4 Constraint: At Least One Discovery Source

At least one of A or A2 must be enabled. The backend enforces this. If neither is on, there are no leads to process.

---

## 3. Stage Details

### 3.1 Stage A — Google Discovery

**Purpose:** Find local businesses by keyword + geographic location. The primary lead generation source.

**APIs used:** Google Places Text Search + Place Details (Legacy or New API)

**Input from frontend:** `query`, `location`, `area`, `zipcode`, `country`, `maxLeads`

**Can be disabled:** Yes, but only if A2 is enabled.

**Solo mode:** N/A — this IS the primary source.

**Writes to context:**

| Field | Value |
|---|---|
| `companyName` | Place name from Google listing |
| `phone` | `international_phone_number` or `formatted_phone_number` |
| `address` | `formatted_address` (cleaned) |
| `city` | From `address_components[locality]` |
| `state` | From `address_components[admin_area_level_1].shortText` |
| `zipcode` | From `address_components[postal_code]` |
| `country` | From `address_components[country]` |
| `website` | From place details |
| `rating` | From place details |
| `reviewCount` | `user_ratings_total` |
| `industry` | Derived from `types[]` (e.g., "restaurant" -> "Restaurant") |
| `latitude` | From `geometry.location.lat` |
| `longitude` | From `geometry.location.lng` |
| `placeId` | Google's `place_id` |
| `source` | `"Google Places"` |

---

### 3.2 Stage A2 — Apollo Org Discovery

**Purpose:** Find companies using B2B filters that Google can't handle (employee count, revenue, tech stack, industry keywords). An ADD-ON to Google, not a replacement. Both run, results are deduplicated and merged.

**APIs used:** Apollo Organization Search

**Input from frontend:** Same search query, plus optional `organizationFilters` (employee ranges, revenue, tech stack, industry keywords)

**Can be disabled:** Yes (independently of A).

**Solo mode (A disabled):** Works, but leads will be missing phone, precise address, rating, reviews since Apollo doesn't return those.

**Writes to context:** Same company-level fields as Stage B (see below), since Apollo Org Search returns company metadata. Leads from A2 arrive with company data already attached.

**Deduplication with A:** Before merging A and A2 results:
1. Match by `domain` — if both have a website for the same domain, it's a duplicate
2. OR fuzzy match by `companyName` + `city` — similar names in the same city
3. Duplicates are merged (see Section 7.1). Unique leads pass through tagged with their source.

---

### 3.3 Stage B — Company Enrichment

**Purpose:** Add company-level metadata to leads that are missing it. Produces `apolloOrgId` that improves Stage D accuracy. Optionally qualifies leads before spending money on person lookups.

**Sub-toggles:**

| Sub-toggle | API Endpoint | Input | When to use |
|---|---|---|---|
| Apollo Org Enrich | `organizations/enrich` | `domain` (best), or `name` | Primary. Richest data, free tier. |
| PDL Company Enrich | `company/enrich` | `website` (best), or `name` + `location` | Fallback if Apollo missed. |
| PDL Company Search | `company/search` | SQL with `name` | Last resort if no domain and name-only lookup. |

**Internal execution order:** Apollo Org Enrich first. If it fails or returns incomplete data, PDL Company Enrich. If that fails, PDL Company Search.

**Solo mode (no prior stages except A):** Works with `companyName` and `website` from Google.

**Cooperative reads from context:**
- `website`/`domain` from A (Google) — used by Apollo Enrich and PDL Company Enrich
- `companyName`, `city`, `state` from A — used for name-based search/enrich

**Optional qualification filter:** If the frontend sends `qualificationFilter` (e.g., `minEmployees: 5`, `industries: ["manufacturing"]`), leads that don't meet criteria are tagged `qualified: false`. Later stages can check this flag and skip unqualified leads.

**Writes to context — Merge Table:**

| Field | Action | Rule |
|---|---|---|
| `companyName` | PROTECTED | Never overwrite — set by A/A2 |
| `phone` | PROTECTED | Never overwrite — set by A |
| `address` | PROTECTED | Never overwrite — set by A |
| `city` | PROTECTED | Never overwrite — set by A |
| `state` | PROTECTED | Never overwrite — set by A |
| `zipcode` | PROTECTED | Never overwrite — set by A |
| `country` | PROTECTED | Never overwrite — set by A |
| `latitude` | PROTECTED | Never overwrite — set by A |
| `longitude` | PROTECTED | Never overwrite — set by A |
| `rating` | PROTECTED | Never overwrite — set by A |
| `reviewCount` | PROTECTED | Never overwrite — set by A |
| `placeId` | PROTECTED | Never overwrite — set by A |
| `website` | FILL GAP | Write only if currently empty/N/A |
| `domain` | FILL GAP | Extracted from website if not already set |
| `industry` | UPGRADE | Overwrite if current value is from Google types (weak). Do NOT overwrite if already set by Apollo Org. Priority: Apollo Org > PDL Company > Google types |
| `employeeCount` | FILL GAP | Write only if empty. Priority: Apollo Org (exact number) > PDL Company (range string) |
| `revenue` | FILL GAP | Write only if empty. Only Apollo returns this. |
| `foundedYear` | FILL GAP | Write only if empty. First non-empty: Apollo > PDL |
| `techStack` | FILL GAP | Write only if empty. Only Apollo returns this. |
| `companyLinkedin` | FILL GAP | Write only if empty. First non-empty: Apollo > PDL |
| `companyFacebook` | FILL GAP | Write only if empty. Only Apollo returns this. |
| `companyTwitter` | FILL GAP | Write only if empty. Only Apollo returns this. |
| `apolloOrgId` | FILL GAP | Write only if empty. Only Apollo returns this. |
| `qualified` | WRITE | Set based on qualification filter. `true`/`false`/`null` (no filter). |
| `qualificationReason` | WRITE | Human-readable reason if unqualified. |

**Sub-toggle skip logic within B:**

| Sub-toggle | Skip if... |
|---|---|
| Apollo Org Enrich | No domain in context AND no company name (nothing to search) |
| PDL Company Enrich | Apollo already returned `employeeCount` AND `industry` |
| PDL Company Search | Apollo AND PDL Enrich both already returned data, OR PDL Enrich already ran |

---

### 3.4 Stage C — Hunter Email Search

**Purpose:** Find email addresses and contact names from a company's website domain. Often the most effective way to discover the owner.

**APIs used:** Hunter.io Domain Search

**Sub-toggles:** None (single endpoint)

**Solo mode (only A before it):** Works if Google provided a website. Extracts domain, finds emails.

**Cooperative reads from context:**
- `website`/`domain` — may come from A (Google) or B (Apollo Org found a domain Google didn't have)

**Hard requirement:** A domain must exist in context. If no website from A and no website from B, Stage C is auto-skipped.

**Writes to context — Merge Table:**

| Field | Action | Rule |
|---|---|---|
| All company fields | PROTECTED | Never touch company-level data |
| `domain` | FILL GAP | Write only if empty (Hunter confirms the domain) |
| `contacts[]` | APPEND | Add new contact entries (see below) |

**Contact entries written:**
For each email found by Hunter, a contact entry is appended to `contacts[]`:

```
{
  name: "Joe Martinez" (firstName + lastName),
  firstName: "Joe",
  lastName: "Martinez",
  email: "joe@joesmfg.com",
  emailConfidence: 91,
  title: "Owner",
  department: "executive",
  seniority: "senior",
  source: "Hunter.io",
  isPrimary: false (set later by primary selection logic)
}
```

Hunter may return multiple contacts (e.g., owner + info@ + sales@). All are appended. The owner/CEO/founder-titled contact is preferred when selecting primary.

---

### 3.5 Stage D — Apollo People

**Purpose:** Find decision-makers at the company and/or validate + enrich people found by earlier stages.

**Sub-toggles:**

| Sub-toggle | API Endpoint | Purpose |
|---|---|---|
| Apollo People Search | `mixed_people/api_search` | Discover people at a company by title/seniority filter |
| Apollo People Match/Enrich | `people/match` | Look up a specific person by email or name+domain and get full profile |

**Solo mode (only A before it):**
- People Search: Searches by `q_organization_name` from Google. Less precise without org_id, but functional.
- People Match: CANNOT work solo — needs at least a person name or email from another stage. Auto-skipped if no person identifier exists.

**Cooperative reads from context:**
- `apolloOrgId` from B — People Search uses `organization_ids` for precise matching instead of name search
- `domain` from A or B — People Match uses `domain` alongside name for better accuracy
- `contacts[].email` from C (Hunter) — People Match uses email for highest-accuracy enrichment
- `contacts[].firstName`, `contacts[].lastName` from C or E — People Match uses name + domain

**How D behaves based on available context:**

| Context state | D-Search behavior | D-Match behavior |
|---|---|---|
| Only `companyName` from A | Search by `q_organization_name` (vague) | SKIP — no person identifier |
| `companyName` + `apolloOrgId` from B | Search by `organization_ids` (precise) | SKIP — no person identifier |
| `companyName` + `contacts[].email` from C | SKIP search — already have a person | Enrich by `email` (highest accuracy) |
| `companyName` + `apolloOrgId` + `contacts[].email` | SKIP search | Enrich by `email` + `organization_id` |
| `companyName` + `contacts[].name` from E (no email) | Search if no contact found yet | Match by `first_name` + `last_name` + `organization_name` (medium accuracy) |
| `companyName` + `domain` + `contacts[].name` | Search if needed | Match by `first_name` + `last_name` + `domain` (high accuracy) |

**Writes to context — Merge Table:**

| Field | Action | Rule |
|---|---|---|
| All company fields | PROTECTED | Never touch |
| `apolloOrgId` | FILL GAP | If Match returns `organization_id` and context doesn't have one |
| `employeeCount` | FILL GAP | From Match's `organization.estimated_num_employees`, only if empty |
| `revenue` | FILL GAP | From Match's `organization.annual_revenue_printed`, only if empty |
| `industry` | UPGRADE | From Match's `organization.industry`, only if current is weaker (Google types) |
| `contacts[]` | APPEND or MERGE | See below |

**Contact handling:**
- **D-Search** finds new people: each is APPENDED to `contacts[]` with fields: `name` (first name only — last name obfuscated on free tier), `title`, `source: "Apollo People Search"`. Note: no email, no phone from Search endpoint.
- **D-Match** enriches a known person: if the person already exists in `contacts[]` (matched by email or name), their entry is MERGED with Apollo's richer data. If it's a new person, APPENDED.

**Contact merge when D-Match enriches an existing contact:**

| Contact field | Existing value (e.g. from Hunter) | Apollo Match value | Rule |
|---|---|---|---|
| `name` | "Joe Martinez" | "Joe Martinez" | Keep existing (already complete) |
| `email` | "joe@joesmfg.com" (confidence: 91) | "joe@joesmfg.com" (status: verified) | Keep existing email, ADD `emailStatus: "verified"` from Apollo |
| `title` | "Owner" | "Owner & CEO" | UPGRADE — take the more specific title (longer non-generic) |
| `phone` | null | "+17135550100" (from employment_history) | FILL GAP |
| `linkedin` | null | "linkedin.com/in/joemartinez" | FILL GAP |
| `photo` | null | "https://..." | FILL GAP |
| `seniority` | null | "owner" | FILL GAP |
| `departments` | null | ["executive"] | FILL GAP |

---

### 3.6 Stage E — PDL Person

**Purpose:** Find the business owner using PDL's person database. Returns the richest person data of all APIs (multiple emails, phones, skills, education, career history).

**Sub-toggles:**

| Sub-toggle | API Endpoint | Purpose |
|---|---|---|
| PDL Person Search | `person/search` (SQL) | Discover people by company name + title filter |
| PDL Person Enrich | `person/enrich` | Look up a specific person by email, LinkedIn URL, or name+company |

**Solo mode (only A before it):**
- Person Search: Works with `companyName` + `city`/`state` from Google. Searches by company name + title filter via SQL.
- Person Enrich: CANNOT work solo — needs an email, LinkedIn URL, or name. Auto-skipped if no person identifier exists.

**Cooperative reads from context:**
- `companyName`, `city`, `state` from A — used in SQL query
- `contacts[].email` from C — Person Enrich can look up by email
- `contacts[].linkedin` from D — Person Enrich can look up by LinkedIn URL
- Existence of contacts from C or D — if owner name + email already found, E-Search can be skipped

**Writes to context — Merge Table:**

| Field | Action | Rule |
|---|---|---|
| All company fields | PROTECTED | Never touch |
| `industry` | UPGRADE | From `job_company_industry`, only if current is weaker |
| `employeeCount` | FILL GAP | From `job_company_size`, only if empty |
| `contacts[]` | APPEND or MERGE | See below |

**Contact handling:**
- **E-Search** may return multiple candidates. Each person whose title matches owner/CEO/founder/president is APPENDED to `contacts[]`. If a person with the same email already exists (from C or D), their entry is MERGED.
- **E-Enrich** enriches a known person — same merge logic as D-Match.

**Contact fields from PDL (unique data not available elsewhere):**

| Contact field | Action | Notes |
|---|---|---|
| `name` / `firstName` / `lastName` / `middleName` | APPEND or MERGE | PDL has the most complete name records |
| `email` | MERGE | PDL distinguishes professional vs personal; prefer professional |
| `personalEmails[]` | FILL GAP | Unique to PDL — personal email addresses |
| `professionalEmails[]` | FILL GAP | Unique to PDL |
| `phone` | FILL GAP | PDL is often the only source for personal phone numbers |
| `allPhones[]` | FILL GAP | Unique to PDL — all known phone numbers |
| `linkedin` | MERGE | First non-empty: Apollo > PDL |
| `facebook` | FILL GAP | Unique to PDL at person level |
| `twitter` | FILL GAP | Unique to PDL at person level |
| `github` | FILL GAP | Unique to PDL |
| `skills[]` | FILL GAP | Unique to PDL |
| `education[]` | FILL GAP | Unique to PDL |
| `experience[]` | MERGE | PDL and Apollo both have employment history; keep the longer/more complete one |
| `title` | UPGRADE | Take the more specific title |
| `source` | SET | `"PDL Person Search"` or `"PDL Person Enrich"` |

**Contact merge when E finds same person as C or D:**

| Contact field | Existing (from C/D) | PDL value | Rule |
|---|---|---|---|
| `name` | "Joe Martinez" | "Joe R. Martinez" | Take PDL (more complete — includes middle name) |
| `email` | "joe@joesmfg.com" (conf: 91) | "joe@joesmfg.com" (type: professional) | Keep existing (has confidence score) |
| `personalEmails` | null | ["joe.martinez@gmail.com"] | FILL GAP |
| `phone` | null | "+17135550100" | FILL GAP |
| `allPhones` | null | ["+17135550100", "+17135550200"] | FILL GAP |
| `linkedin` | "linkedin.com/in/joemartinez" (from D) | "linkedin.com/in/joe-martinez" | Keep existing (Apollo's tends to be more accurate) |
| `skills` | null | ["plumbing", "project management"] | FILL GAP |
| `education` | null | [{school: "Houston CC"}] | FILL GAP |

---

### 3.7 Stage F — AI Enrichment

**Purpose:** Last-resort owner name guessing and industry/business classification. All AI-sourced fields are explicitly tagged as estimates.

**Sub-toggles:**

| Sub-toggle | API | Role |
|---|---|---|
| Claude | Anthropic Messages API | Primary AI (runs first) |
| ChatGPT | OpenAI Chat Completions | Secondary AI (fallback if Claude fails) |

**Solo mode (only A before it):** Works with just `companyName`, `city`, `state`, `industry` from Google. Guesses everything.

**Cooperative reads from context:**
- `contacts[]` — if any contacts exist, AI skips name guessing
- `industry` from B — if set by Apollo/PDL, AI skips industry guess
- `employeeCount` from B — if set, AI skips estimate
- `revenue` from B — if set, AI skips estimate

**Writes to context — Merge Table:**

| Field | Action | Rule |
|---|---|---|
| All company fields | PROTECTED | Never touch |
| `industry` | UPGRADE | Only if current industry is from Google types (e.g. "Point Of Interest") AND no better source set it. Tag as `dataSource: "AI Estimated"` |
| `employeeCount` | FILL GAP | Only if empty. Tag as `dataSource: "AI Estimated"` |
| `revenue` | FILL GAP | Only if empty. Tag as `dataSource: "AI Estimated"` |
| `contacts[]` | APPEND | Only if `contacts[]` is empty (no person found by any prior stage). AI-generated contact is tagged with `source: "AI Estimated"`. |

**AI contact entry (only created if no contacts exist):**

```
{
  name: "Joe Martinez" (guessed),
  title: null,
  email: null,
  phone: null,
  linkedin: null,
  source: "AI Estimated",
  confidence: 35 (AI's self-reported score),
  isPrimary: true (only contact)
}
```

AI confidence threshold: only accept AI-guessed name if confidence >= 60. Below that, set name to `null` (no guess is better than a bad guess). The confidence value is still stored for reference.

**Execution within F:**
1. Run Claude (primary)
2. If Claude fails or returns null, run ChatGPT (fallback)
3. If both return results, Claude's result takes priority
4. Never run both and merge — pick one winner

---

### 3.8 Stage G — Verification

**Purpose:** Validate the data collected by all prior stages. Does not discover or enrich — only confirms/denies.

**Sub-toggles:**

| Sub-toggle | API | Purpose |
|---|---|---|
| Phone validation | Numverify | Is the business phone valid? What type of line? |
| Email verification | Hunter Email Verifier | Is the primary contact's email deliverable? |
| Business verification | Yelp Business Match + Details | Does this business still exist on Yelp? |

**Solo mode:** Works with whatever fields exist in context. Missing fields cause the relevant sub-check to be auto-skipped.

**Writes to context — Merge Table:**

| Field | Action | Rule |
|---|---|---|
| All company fields | PROTECTED | Never touch |
| `contacts[]` | PROTECTED | Never touch |
| `verification.phoneValid` | WRITE | Boolean from Numverify |
| `verification.phoneLineType` | WRITE | "landline" / "mobile" / "voip" / "toll_free" |
| `verification.phoneCarrier` | WRITE | Carrier name string |
| `verification.emailVerified` | WRITE | Boolean — is primary contact's email deliverable? |
| `verification.emailStatus` | WRITE | "valid" / "invalid" / "risky" / "unknown" |
| `verification.emailScore` | WRITE | 0-100 from Hunter |
| `verification.businessVerified` | WRITE | Boolean — Yelp found a match? |
| `verification.yelpId` | WRITE | Yelp business ID if matched |
| `verification.yelpCategories` | WRITE | Category list from Yelp |
| `verification.yelpPrice` | WRITE | Price tier ("$", "$$", "$$$") |
| `verification.yelpHours` | WRITE | Hours data if available |

Verification writes to its own `verification` namespace. Zero conflicts with any other stage.

**Sub-toggle skip logic within G:**

| Sub-toggle | Auto-skip if... |
|---|---|
| Numverify | No phone in context |
| Hunter Email Verify | No email in any contact, OR primary contact's `emailConfidence >= 90`, OR primary contact's `emailStatus === "verified"` (from Apollo) |
| Yelp Match | No `address` + `city` to match on |

---

## 4. Endpoint-to-Stage Mapping

| API Endpoint | Stage | Sub-toggle | Reads from context | Writes to context |
|---|---|---|---|---|
| Google Places Text Search | A | — | Frontend query | companyName, phone, address, city, state, zip, country, website, rating, reviewCount, industry, lat, lng, placeId |
| Google Places Details | A | — | placeId from Text Search | Same (enriches Text Search results) |
| Apollo Org Search | A2 | — | Frontend filters | companyName, industry, employeeCount, revenue, website, social links, apolloOrgId |
| Apollo Org Enrich | B | Apollo Org Enrich | domain or companyName | industry, employeeCount, revenue, foundedYear, techStack, social links, apolloOrgId |
| PDL Company Enrich | B | PDL Company Enrich | website or companyName + location | industry, employeeCount (size), foundedYear, linkedin |
| PDL Company Search | B | PDL Company Search | companyName (SQL) | Same as PDL Company Enrich |
| Hunter Domain Search | C | — | domain (from A or B) | contacts[] (email, name, title, confidence) |
| Apollo People Search (new) | D | Apollo People Search | apolloOrgId or companyName or domain | contacts[] (firstName, title — no email/phone) |
| Apollo People Match/Enrich | D | Apollo People Match | email or name+domain or linkedin from C/D/E | contacts[] (full: email, title, linkedin, seniority, photo) |
| PDL Person Search | E | PDL Person Search | companyName + city/state (SQL) | contacts[] (full: name, emails, phones, linkedin, skills, education) |
| PDL Person Enrich | E | PDL Person Enrich | email or linkedin or name+company from C/D | contacts[] (same as Person Search, for one person) |
| Claude | F | Claude | companyName, city, industry | contacts[] (name guess), industry, employeeCount, revenue — all tagged "AI Estimated" |
| ChatGPT | F | ChatGPT | Same as Claude | Same as Claude |
| Numverify | G | Phone validation | phone from context | verification.phoneValid, .phoneLineType, .phoneCarrier |
| Hunter Email Verify | G | Email verification | primary contact's email | verification.emailVerified, .emailStatus, .emailScore |
| Yelp Business Match | G | Business verification | companyName + address + city | verification.businessVerified, .yelpId, .yelpCategories, .yelpPrice |
| Yelp Business Details | G | Business verification | yelpId from Match | verification.yelpHours (follow-up to Match) |

---

## 5. Dependencies and Constraints

### 5.1 Hard Dependencies

These endpoints REQUIRE specific data that can only come from another source:

| Endpoint | Hard requirement | Where it comes from | If missing |
|---|---|---|---|
| Hunter Domain Search (C) | A website/domain | A (Google), B (Apollo Org), or A2 | Stage C auto-skips |
| Apollo People Match (D) | A person identifier: email, OR (first_name + last_name), OR linkedin_url | C (Hunter), D-Search, or E (PDL) | D-Match auto-skips |
| PDL Person Enrich (E) | A person identifier: email, OR linkedin_url, OR (name + company) | C (Hunter), D (Apollo), or E-Search | E-Enrich auto-skips |
| Hunter Email Verify (G) | An email address | C (Hunter), D (Apollo), or E (PDL) | Email verify sub-check auto-skips |

### 5.2 Soft Dependencies (works alone but better with)

| Endpoint | Benefits from | Why | Without it |
|---|---|---|---|
| Apollo People Search (D) | `apolloOrgId` from B | Searches by exact org_id instead of fuzzy name | Searches by company name — less precise, may match wrong company |
| Apollo People Match (D) | `domain` from A/B | name + domain is more accurate than name + org_name | name + org_name still works, medium accuracy |
| Apollo People Match (D) | `email` from C | Email is the highest-accuracy identifier | Falls back to name-based matching |
| PDL Person Search (E) | `city`, `state` from A | Narrows SQL query to correct location | Searches nationwide — more results, may include wrong locations |
| Stage F (AI) | `industry` from B | Skips industry guessing (already accurate) | AI guesses industry from company name (less reliable) |
| Stage F (AI) | `contacts[]` from C/D/E | Skips name guessing entirely | AI guesses owner name (unreliable) |

### 5.3 Frontend Enforcement Rules

| Rule | Reason |
|---|---|
| At least one of A or A2 must be enabled | No leads without a discovery source |
| If D-Match is enabled but C, D-Search, and E are all disabled | Warn user: "Apollo Enrich needs a person name or email — enable Hunter, Apollo Search, or PDL to find one first" |
| If G-Email is enabled but C, D, and E are all disabled | Warn user: "Email verification needs an email — enable at least one contact-finding stage" |
| If only A2 is enabled (no Google) | Warn user: "Leads will be missing phone numbers and precise addresses" |

### 5.4 Minimum Viable Configurations

| Configuration | What you get | Limitations |
|---|---|---|
| A only | Business name, phone, address, website, rating | No owner, no email, no company intel |
| A + B | Above + employee count, revenue, industry | No owner, no email |
| A + C | Business data + owner email/name (if website exists) | No company intel, no enrichment |
| A + B + C | Business + company intel + owner email/name | Missing: linkedin, seniority, phone validation |
| A + B + C + D | Above + validated contact with linkedin, seniority | Best balance of cost and data |
| A + B + C + D + E | Above + skills, education, personal emails/phones | Maximum contact data, higher cost |
| A + B + C + D + E + F + G | Everything | Maximum cost, maximum data |
| A2 only | Company name, industry, size, revenue, social links | No phone, no precise address, no rating |
| A + A2 + B + C + D + E + F + G | Full pipeline, both discovery sources | Maximum everything |

---

## 6. Data Model

### 6.1 LeadContext (Shared Object)

```js
{
  // ── Company Data (one value per field, merged across A/A2/B) ──
  companyName: "Joe's Manufacturing LLC",
  phone: "+1 713-555-0100",
  address: "123 Main St, Houston, TX 77001",
  city: "Houston",
  state: "TX",
  zipcode: "77001",
  country: "United States",
  website: "https://joesmanufacturing.com",
  domain: "joesmanufacturing.com",
  rating: 4.3,
  reviewCount: 87,
  industry: "Manufacturing",
  latitude: 29.76,
  longitude: -95.36,
  placeId: "ChIJxyz...",
  employeeCount: 45,
  revenue: "$5M",
  foundedYear: 2005,
  techStack: ["QuickBooks", "Google Analytics"],
  companyLinkedin: "linkedin.com/company/joes-manufacturing",
  companyFacebook: "facebook.com/joesmanufacturing",
  companyTwitter: "twitter.com/joesmfg",
  apolloOrgId: "5f8e6117ab820101120cc9ff",
  qualified: true,
  qualificationReason: null,

  // ── Contacts (array — every person found across C, D, E, F) ──
  contacts: [
    {
      name: "Joe R. Martinez",
      firstName: "Joe",
      lastName: "Martinez",
      middleName: "R.",
      email: "joe@joesmanufacturing.com",
      emailConfidence: 91,
      emailStatus: "verified",
      personalEmails: ["joe.martinez@gmail.com"],
      professionalEmails: ["joe@joesmanufacturing.com"],
      title: "Owner & CEO",
      phone: "+17135550100",
      allPhones: ["+17135550100", "+17135550200"],
      linkedin: "linkedin.com/in/joemartinez",
      facebook: "facebook.com/joe.martinez",
      photo: "https://...",
      seniority: "owner",
      departments: ["executive"],
      skills: ["manufacturing", "project management"],
      education: [{ school: "Houston CC" }],
      experience: [{ title: "Owner", company: "Joe's Manufacturing", startDate: "2005-01" }],
      source: "Hunter.io + Apollo People + PDL Person",
      isPrimary: true
    },
    {
      name: "Maria Garcia",
      firstName: "Maria",
      lastName: "Garcia",
      email: "maria@joesmanufacturing.com",
      emailConfidence: 85,
      title: "Operations Manager",
      source: "Hunter.io",
      isPrimary: false
    }
  ],

  // ── Verification (from G) ──
  verification: {
    phoneValid: true,
    phoneLineType: "landline",
    phoneCarrier: "AT&T",
    emailVerified: true,
    emailStatus: "valid",
    emailScore: 95,
    businessVerified: true,
    yelpId: "joes-manufacturing-houston",
    yelpCategories: ["Manufacturing"],
    yelpPrice: null,
    yelpHours: null
  },

  // ── Metadata ──
  sources: ["Google Places", "Apollo Org", "Hunter.io", "Apollo People", "PDL Person"],
  pipelinesRun: ["A", "B", "C", "D", "E", "G"],
  dataSourceMap: {
    companyName: "Google Places",
    phone: "Google Places",
    address: "Google Places",
    industry: "Apollo Org Enrich",
    employeeCount: "Apollo Org Enrich",
    revenue: "Apollo Org Enrich",
    website: "Google Places",
    apolloOrgId: "Apollo Org Enrich"
  },
  enrichmentScore: 85
}
```

### 6.2 Enrichment Completeness Score

Computed after each stage runs:

| Field present | Points |
|---|---|
| At least 1 contact with name (from data source) | 30 |
| At least 1 contact with name (from AI only) | 10 |
| At least 1 contact with verified email | 25 |
| At least 1 contact with unverified email | 15 |
| Business phone exists | 10 |
| At least 1 contact with title | 5 |
| At least 1 contact with linkedin | 5 |
| employeeCount exists | 5 |
| revenue exists | 5 |
| **Maximum** | **100** |

This score is informational — it does not control stage execution (frontend toggles do that). It tells the user how "complete" a lead is.

### 6.3 Primary Contact Selection

After all contact-finding stages complete, one contact is marked `isPrimary: true` using this ranking:

1. Title contains "Owner" (case-insensitive)
2. Title contains "CEO" or "Chief Executive"
3. Title contains "Founder" or "Co-Founder"
4. Title contains "President"
5. Title contains "Partner" or "Managing Partner"
6. Any other C-suite title (seniority === "c_suite")
7. First contact in the array (insertion order)

If multiple contacts share the same rank, prefer the one with an email.

---

## 7. Conflict Resolution Rules

### 7.1 Discovery Merge (A + A2)

**Duplicate detection:**
1. Same `domain` in both result sets — definite duplicate
2. Fuzzy `companyName` match (normalized: lowercase, strip "LLC"/"Inc"/punctuation) + same `city` — likely duplicate

**Per-field winner for duplicates:**

| Field | Winner | Reason |
|---|---|---|
| `companyName` | A (Google) | Official listing name |
| `phone` | A (Google) | Verified listing phone |
| `address`, `city`, `state`, `zip`, `country` | A (Google) | Google Maps is authoritative |
| `latitude`, `longitude` | A (Google) | Precise from Google Maps |
| `rating`, `reviewCount` | A (Google) | Only Google has these |
| `placeId` | A (Google) | Google-specific |
| `website` | First non-empty (prefer A) | Either is valid |
| `industry` | A2 (Apollo) | Apollo's classification is much better |
| `employeeCount` | A2 (Apollo) | Google doesn't have this |
| `revenue` | A2 (Apollo) | Google doesn't have this |
| `foundedYear` | A2 (Apollo) | Google doesn't have this |
| `techStack` | A2 (Apollo) | Google doesn't have this |
| `social links` | A2 (Apollo) | Google doesn't have these |
| `apolloOrgId` | A2 (Apollo) | Only Apollo has this |

Non-duplicate leads from A2 enter the pipeline with Apollo's data and missing Google fields (no phone, no precise address, no rating). They proceed through B/C/D/E/F/G normally.

**Source tracking:** Every lead's `sources[]` array records where it came from: `["Google Places"]`, `["Apollo Org Search"]`, or `["Google Places", "Apollo Org Search"]` for merged duplicates.

### 7.2 Company Enrichment Conflicts (Stage B)

**Apollo Org Enrich vs PDL Company Enrich — within Stage B:**

| Field | Apollo has | PDL has | Rule |
|---|---|---|---|
| `industry` | "Manufacturing" | "manufacturing" | Apollo wins (better taxonomy) |
| `employeeCount` | 45 (exact) | "11-50" (range) | Apollo wins (exact > range) |
| `revenue` | "$5M" | N/A | Apollo (only source) |
| `foundedYear` | 2005 | 2005 | First non-empty |
| `techStack` | ["QuickBooks"] | N/A | Apollo (only source) |
| `linkedin` | "linkedin.com/..." | "linkedin.com/..." | First non-empty |
| `facebook`, `twitter` | Yes | No | Apollo (only source) |

**Rule:** Apollo Org Enrich is always primary. PDL Company only fills fields Apollo left empty. PDL never overwrites an Apollo value.

### 7.3 Contact Conflicts (Stages C, D, E)

**Principle:** Contacts are APPENDED to an array, not overwritten. If two stages find the same person, their entries are MERGED into one.

**Same-person detection:**
1. Same email address — definite same person
2. Same `firstName` + `lastName` (normalized) at the same company — likely same person

**When merging two contact records for the same person:**

| Contact field | Priority (highest to lowest) | Rule |
|---|---|---|
| `name` | PDL > Hunter > Apollo People > Apollo Match | PDL has most complete names (includes middle name) |
| `firstName`, `lastName` | PDL > Hunter > Apollo | Same |
| `email` | Highest confidence wins: Hunter (numeric score) > Apollo ("verified" status) > PDL ("professional" type) | If tied: Hunter > Apollo > PDL |
| `emailConfidence` | Keep the numeric score if available | Hunter provides this |
| `emailStatus` | Apollo's "verified"/"unverified" | Apollo provides this |
| `personalEmails[]` | PDL (only source) | |
| `professionalEmails[]` | PDL (only source) | |
| `title` | Most specific wins (longest non-generic) | "Owner & CEO" > "Owner" > "Business Owner" |
| `phone` | First non-empty: PDL > Apollo | Hunter doesn't return phones |
| `allPhones[]` | PDL (only source) | |
| `linkedin` | First non-empty: Apollo > PDL | Apollo's URLs tend to be more accurate |
| `photo` | First non-empty: Apollo > PDL | |
| `seniority` | Apollo (only normalized source) | |
| `departments` | Apollo (only source) | |
| `skills[]` | PDL (only source) | |
| `education[]` | PDL (only source) | |
| `experience[]` | Keep longer list: PDL vs Apollo | Both have employment history |
| `source` | Concatenated: "Hunter.io + Apollo People + PDL Person" | Track all contributing sources |

### 7.4 AI Conflicts (Stage F)

**Rule:** AI is always the lowest priority source. AI never overwrites any field set by any other stage.

| Field | AI writes if... | AI skips if... |
|---|---|---|
| Contact name guess | `contacts[]` is completely empty | Any contact exists from C, D, or E |
| `industry` | Current value is from Google types only | Value set by Apollo Org, PDL Company, or human |
| `employeeCount` | Currently empty | Any value exists from B |
| `revenue` | Currently empty | Any value exists from B |

All AI-sourced values are tagged: `dataSourceMap.fieldName = "AI Estimated"`

### 7.5 Verification (Stage G)

No conflicts. Verification writes to its own `verification` namespace that no other stage touches. Each sub-check writes independent fields.

### 7.6 Immutable Fields

These fields, once set by Google (Stage A), are NEVER overwritten by any later stage:

```
companyName, phone, address, city, state, zipcode, country,
latitude, longitude, rating, reviewCount, placeId
```

Exception: if a lead originated from A2 only (no Google), these fields may be set by Apollo and then enriched (but not overwritten) by later stages.

---

## 8. Efficiency / Skip Logic

### 8.1 Context Checks

After each stage, the orchestrator evaluates these flags:

```
HAS_DOMAIN       = context.domain is not empty/null/"N/A"
HAS_ORG_ID       = context.apolloOrgId exists
HAS_COMPANY_DATA = context.employeeCount AND context.industry are both set (non-Google-types)
HAS_CONTACT      = context.contacts.length > 0
HAS_OWNER_NAME   = any contact has a non-null name
HAS_OWNER_EMAIL  = any contact has a non-null email
HAS_VERIFIED     = any contact has emailConfidence >= 90 OR emailStatus === "verified"
```

### 8.2 Per-Stage Skip Logic

| Stage | Skip entirely if... | Internal sub-skip rules |
|---|---|---|
| **A** | User disabled AND A2 is enabled | Never — always full run |
| **A2** | User disabled | Never — always full run |
| **B** | User disabled | Skip Apollo Org Enrich if: no domain AND no company name. Skip PDL Company Enrich if: Apollo already set employeeCount + industry. Skip PDL Company Search if: any prior B sub-step already returned data. |
| **C** | User disabled, OR `!HAS_DOMAIN` | Never — single API call, always runs if domain exists |
| **D** | User disabled | Skip D-Search if: `HAS_OWNER_NAME && HAS_OWNER_EMAIL`. Skip D-Match if: no person identifier exists (no email, no name, no linkedin from any prior stage). Still run D-Match if: have name but no email (Match can sometimes find email from name+domain). |
| **E** | User disabled | Skip E-Search if: `HAS_OWNER_NAME && HAS_OWNER_EMAIL`. Skip E-Enrich if: no person identifier exists. |
| **F** | User disabled, OR (all target fields already filled) | Skip name guess if: `HAS_CONTACT`. Skip industry if: industry set by Apollo/PDL. Skip employeeCount if: already set. Skip revenue if: already set. |
| **G** | User disabled | Skip phone check if: no phone. Skip email check if: no email OR `HAS_VERIFIED`. Skip Yelp if: no address + city. |

### 8.3 Efficiency Between C, D, E (Contact Stages)

These three stages have the most overlap. Here's the complete decision tree:

**After Stage C (Hunter) runs:**

| Hunter found | Context state | D behavior | E behavior |
|---|---|---|---|
| Owner name + email (conf >= 80) | `HAS_OWNER_NAME`, `HAS_OWNER_EMAIL` | D-Search: SKIP. D-Match: RUN (validate + add linkedin/seniority using email) | E-Search: SKIP. E-Enrich: Optional (adds skills/education if desired) |
| Emails but no owner title | Generic contacts only | D-Search: RUN (find actual owner). D-Match: RUN if search finds someone | E-Search: RUN. E-Enrich: as above |
| Nothing | Empty contacts | D-Search: RUN. D-Match: RUN if search finds someone | E-Search: RUN. E-Enrich: RUN if search finds someone |

**After Stage D (Apollo) runs:**

| Apollo found | Context state | E behavior |
|---|---|---|
| Person with name + verified email | `HAS_OWNER_NAME`, `HAS_OWNER_EMAIL`, `HAS_VERIFIED` | E-Search: SKIP. E-Enrich: Optional (adds skills/education/phones) |
| Person with name + title but NO email | `HAS_OWNER_NAME`, `!HAS_OWNER_EMAIL` | E-Search: RUN (might find email). E-Enrich: RUN if we have linkedin from Apollo |
| Nothing | No new contacts | E-Search: RUN. E-Enrich: only if prior contacts exist with identifiers |

---

## 9. Cooperative Behavior Matrix

What each stage gains when peers are also enabled:

### 9.1 What Each Stage Reads from Prior Stages

| Stage | From A (Google) | From A2 (Apollo Disc.) | From B (Company) | From C (Hunter) | From D (Apollo People) | From E (PDL Person) |
|---|---|---|---|---|---|---|
| **A2** | — | — | — | — | — | — |
| **B** | website, companyName, city, state | apolloOrgId, website (if A2 found one Google didn't) | — | — | — | — |
| **C** | website/domain | website/domain | domain (if Google didn't have one, B may have found it) | — | — | — |
| **D** | companyName | — | apolloOrgId, domain | contacts[].email, contacts[].name | — | contacts[].name, contacts[].linkedin |
| **E** | companyName, city, state | — | — | contacts[].email (skip if found) | contacts[].email, contacts[].linkedin (skip if found) | — |
| **F** | companyName, city, industry | — | industry, employeeCount, revenue (skip guessing if set) | contacts[] (skip name guess if any) | contacts[] (skip name guess if any) | contacts[] (skip name guess if any) |
| **G** | phone | — | — | contacts[].email, contacts[].emailConfidence | contacts[].emailStatus | contacts[].email |

### 9.2 Solo Mode Degradation

| Stage | Solo behavior (only A before it) | What's lost without peers |
|---|---|---|
| **B** | Enriches by companyName/website from Google | Without A2: no pre-existing apolloOrgId (but B creates one) |
| **C** | Uses website from Google | Without B: might miss domain (if Google had no website but Apollo did) |
| **D-Search** | Searches by companyName (vague) | Without B: no org_id for precise search. Without C: no email for Match. |
| **D-Match** | CANNOT RUN (no person identifier) | Without C or E: nothing to enrich. Auto-skips. |
| **E-Search** | Searches by companyName + city (SQL) | Without C/D: runs full search instead of skipping. No efficiency loss, just potential redundancy. |
| **E-Enrich** | CANNOT RUN (no person identifier) | Without C or D: nothing to enrich. Auto-skips. |
| **F** | Guesses everything (name, industry, size, revenue) | Without B: guesses company data. Without C/D/E: guesses owner name. Low quality. |
| **G** | Validates phone from Google | Without C/D/E: no email to verify. Without A: no phone to verify (if A2-only). |

---

## 10. Frontend Configuration Schema

### 10.1 Full Config Object

```js
{
  // Discovery toggles (at least one must be true)
  enableGoogleDiscovery: true,           // Stage A
  enableApolloDiscovery: false,          // Stage A2
  apolloDiscoveryFilters: {              // Only used if A2 is enabled
    employeeRanges: ["11,50", "51,200"],
    revenueMin: null,
    revenueMax: null,
    industries: ["manufacturing"],
    technologies: [],
    keywords: []
  },

  // Enrichment toggles
  enableCompanyEnrichment: true,         // Stage B
  companyEnrichmentOptions: {
    apolloOrgEnrich: true,               //   Apollo Org Enrich
    pdlCompanyEnrich: true,              //   PDL Company Enrich
    pdlCompanySearch: false              //   PDL Company Search (SQL fallback)
  },

  enableHunterEmails: true,              // Stage C

  enableApolloPeople: true,              // Stage D
  apolloPeopleOptions: {
    peopleSearch: true,                  //   Apollo People Search (new endpoint)
    peopleMatch: true                    //   Apollo People Match/Enrich
  },

  enablePDLPerson: true,                 // Stage E
  pdlPersonOptions: {
    personSearch: true,                  //   PDL Person Search (SQL)
    personEnrich: false                  //   PDL Person Enrich (lookup)
  },

  enableAI: false,                       // Stage F
  aiOptions: {
    claude: true,                        //   Claude (primary)
    chatgpt: true                        //   ChatGPT (secondary)
  },

  enableVerification: true,              // Stage G
  verificationOptions: {
    phone: true,                         //   Numverify
    email: true,                         //   Hunter Email Verify
    yelpMatch: false                     //   Yelp Business Match
  },

  // Optional qualification filter (used by Stage B)
  qualificationFilter: {
    minEmployees: 5,
    maxEmployees: null,
    industries: [],                      // empty = no filter
    minRevenue: null,
    maxRevenue: null
  }
}
```

### 10.2 Example Configurations

**"Cheap Discovery Only" — just find businesses:**
```js
{
  enableGoogleDiscovery: true,
  enableApolloDiscovery: false,
  enableCompanyEnrichment: false,
  enableHunterEmails: false,
  enableApolloPeople: false,
  enablePDLPerson: false,
  enableAI: false,
  enableVerification: false
}
// Cost: ~$0.034/lead. Output: name, phone, address, website, rating.
```

**"Find Owner Email" — minimum viable contact finding:**
```js
{
  enableGoogleDiscovery: true,
  enableApolloDiscovery: false,
  enableCompanyEnrichment: false,
  enableHunterEmails: true,
  enableApolloPeople: false,
  enablePDLPerson: false,
  enableAI: false,
  enableVerification: false
}
// Cost: ~$0.054/lead. Output: name, phone, address + owner email/name if website exists.
```

**"Energy Sales Optimized" — recommended for your use case:**
```js
{
  enableGoogleDiscovery: true,
  enableApolloDiscovery: true,
  apolloDiscoveryFilters: {
    employeeRanges: ["11,50", "51,200", "201,500"],
    industries: ["manufacturing", "food_service", "automotive"]
  },
  enableCompanyEnrichment: true,
  companyEnrichmentOptions: { apolloOrgEnrich: true, pdlCompanyEnrich: true, pdlCompanySearch: false },
  enableHunterEmails: true,
  enableApolloPeople: true,
  apolloPeopleOptions: { peopleSearch: true, peopleMatch: true },
  enablePDLPerson: true,
  pdlPersonOptions: { personSearch: true, personEnrich: false },
  enableAI: false,
  enableVerification: true,
  verificationOptions: { phone: true, email: true, yelpMatch: false },
  qualificationFilter: { minEmployees: 5 }
}
// Full pipeline with qualification filter. Skips AI. Verifies phone + email.
```

**"Maximum Enrichment" — every API enabled:**
```js
{
  enableGoogleDiscovery: true,
  enableApolloDiscovery: true,
  enableCompanyEnrichment: true,
  companyEnrichmentOptions: { apolloOrgEnrich: true, pdlCompanyEnrich: true, pdlCompanySearch: true },
  enableHunterEmails: true,
  enableApolloPeople: true,
  apolloPeopleOptions: { peopleSearch: true, peopleMatch: true },
  enablePDLPerson: true,
  pdlPersonOptions: { personSearch: true, personEnrich: true },
  enableAI: true,
  aiOptions: { claude: true, chatgpt: true },
  enableVerification: true,
  verificationOptions: { phone: true, email: true, yelpMatch: true }
}
// Maximum data, maximum cost. Every field filled, every contact found.
```
