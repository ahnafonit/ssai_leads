# API Breakdown — All Providers, Endpoints, Inputs & Outputs

Reference document for designing the lead extraction pipeline.

---

## Table of Contents

1. [Google Places](#1-google-places)
2. [Apollo.io](#2-apolloio)
3. [People Data Labs (PDL)](#3-people-data-labs-pdl)
4. [Hunter.io](#4-hunterio)
5. [Yelp Fusion](#5-yelp-fusion)
6. [Numverify](#6-numverify)
7. [OpenAI (ChatGPT)](#7-openai-chatgpt)
8. [Anthropic (Claude)](#8-anthropic-claude)
9. [Field Coverage Matrix](#9-field-coverage-matrix)

---

## 1. Google Places

**Provider:** Google Cloud  
**Auth:** API key (`GOOGLE_PLACES_API_KEY` / `GOOGLE_PLACES_NEW_API_KEY`)  
**Pricing:** $17/1K text searches, $17/1K detail lookups (legacy). New API uses session-based pricing.  
**Rate Limits:** Default project QPS limits, ~60 results max per text search (3 pages × 20)

### 1a. Legacy — Text Search

**Endpoint:** `GET https://maps.googleapis.com/maps/api/place/textsearch/json`  
**Purpose:** Discover businesses by keyword + location. This is the **lead generation** entry point.

| Input Param | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | e.g. `"plumber in Houston, Texas"` |
| `key` | string | yes | API key |
| `locationbias` | string | no | `point:lat,lng` |
| `radius` | number | no | meters (max 50,000) |
| `pagetoken` | string | no | pagination token from previous response |

**Output (per result):**
```json
{
  "place_id": "ChIJ...",
  "name": "Joe's Plumbing",
  "formatted_address": "123 Main St, Houston, TX 77001",
  "geometry": { "location": { "lat": 29.76, "lng": -95.36 } },
  "types": ["plumber", "point_of_interest", "establishment"],
  "rating": 4.3,
  "user_ratings_total": 87,
  "business_status": "OPERATIONAL",
  "opening_hours": { "open_now": true }
}
```

**Does NOT return:** phone, website, owner, email, detailed address components

---

### 1b. Legacy — Place Details

**Endpoint:** `GET https://maps.googleapis.com/maps/api/place/details/json`  
**Purpose:** Enrich a single place with phone, website, address breakdown.

| Input Param | Type | Required | Description |
|---|---|---|---|
| `place_id` | string | yes | from text search results |
| `fields` | string | yes | comma-separated field mask |
| `key` | string | yes | API key |

**Output:**
```json
{
  "name": "Joe's Plumbing",
  "formatted_address": "123 Main St, Houston, TX 77001",
  "formatted_phone_number": "(713) 555-0100",
  "international_phone_number": "+1 713-555-0100",
  "website": "https://joesplumbing.com",
  "rating": 4.3,
  "user_ratings_total": 87,
  "types": ["plumber", "point_of_interest"],
  "geometry": { "location": { "lat": 29.76, "lng": -95.36 } },
  "address_components": [
    { "long_name": "77001", "types": ["postal_code"] },
    { "long_name": "Houston", "types": ["locality"] },
    { "short_name": "TX", "types": ["administrative_area_level_1"] },
    { "long_name": "United States", "types": ["country"] }
  ]
}
```

**Does NOT return:** owner name, email, employee count, revenue, social media

---

### 1c. New API — Text Search

**Endpoint:** `POST https://places.googleapis.com/v1/places:searchText`  
**Purpose:** Same as legacy text search, newer format. Returns more data in one call (no separate details needed).

| Input Param | Type | Required | Description |
|---|---|---|---|
| `textQuery` | string | yes | search query |
| `pageSize` | number | no | max 20 |
| `pageToken` | string | no | pagination |
| `locationBias` | object | no | `{ circle: { center: {latitude, longitude}, radius } }` |
| `locationRestriction` | object | no | `{ rectangle: { low: {lat,lng}, high: {lat,lng} } }` |
| **Headers** | | | |
| `X-Goog-Api-Key` | string | yes | API key |
| `X-Goog-FieldMask` | string | yes | fields to return |

**Output (per place):**
```json
{
  "id": "places/ChIJ...",
  "displayName": { "text": "Joe's Plumbing", "languageCode": "en" },
  "formattedAddress": "123 Main St, Houston, TX 77001",
  "nationalPhoneNumber": "(713) 555-0100",
  "internationalPhoneNumber": "+1 713-555-0100",
  "websiteUri": "https://joesplumbing.com",
  "rating": 4.3,
  "userRatingCount": 87,
  "types": ["plumber"],
  "location": { "latitude": 29.76, "longitude": -95.36 },
  "addressComponents": [
    { "longText": "77001", "shortText": "77001", "types": ["postal_code"] },
    { "longText": "Houston", "types": ["locality"] },
    { "shortText": "TX", "types": ["administrative_area_level_1"] },
    { "longText": "United States", "types": ["country"] }
  ]
}
```

**Does NOT return:** owner name, email, employee count, revenue, social media

---

## 2. Apollo.io

**Provider:** Apollo.io  
**Auth:** API key header (`X-Api-Key`)  
**Pricing:** Free tier: 10K records/month. Paid plans vary.  
**Rate Limits:** ~100 req/min on free tier

### 2a. Organization Search

**Endpoint:** `POST https://api.apollo.io/api/v1/mixed_companies/search`  
**Purpose:** Find companies by name, location, size, tech stack, keywords.

| Input Param | Type | Required | Description |
|---|---|---|---|
| `q_organization_name` | string | no | company name |
| `organization_locations` | string[] | no | e.g. `["Texas, United States"]` |
| `organization_num_employees_ranges` | string[] | no | e.g. `["1,10", "11,50"]` |
| `revenue_range` | object | no | `{ min, max }` |
| `currently_using_any_of_technology_uids` | string[] | no | tech stack filter |
| `q_organization_keyword_tags` | string[] | no | industry keywords |
| `page` | number | no | default 1 |
| `per_page` | number | no | default 25, max 100 |

**Output (per organization):**
```json
{
  "id": "org_abc123",
  "name": "Joe's Plumbing LLC",
  "phone": "+17135550100",
  "primary_phone": { "number": "+17135550100" },
  "raw_address": "123 Main St, Houston, TX",
  "postal_code": "77001",
  "city": "Houston",
  "state": "Texas",
  "country": "United States",
  "industry": "Construction",
  "website_url": "https://joesplumbing.com",
  "estimated_num_employees": 12,
  "annual_revenue_printed": "$1M",
  "founded_year": 2005,
  "technology_names": ["QuickBooks", "Google Analytics"],
  "linkedin_url": "linkedin.com/company/joes-plumbing",
  "twitter_url": "twitter.com/joesplumbing",
  "facebook_url": "facebook.com/joesplumbing",
  "logo_url": "https://..."
}
```

**Does NOT return:** owner/contact name, email, personal phone

---

### 2b. People Search

**Endpoint:** `POST https://api.apollo.io/api/v1/mixed_people/search`  
**Purpose:** Find people by title, seniority, company, location. Good for prospecting when you know the company.

| Input Param | Type | Required | Description |
|---|---|---|---|
| `person_titles` | string[] | no | e.g. `["Owner", "CEO"]` |
| `person_seniorities` | string[] | no | e.g. `["owner", "c_suite"]` |
| `person_locations` | string[] | no | person's location |
| `organization_locations` | string[] | no | company location |
| `organization_ids` | string[] | no | Apollo org IDs |
| `q_organization_domains_list` | string[] | no | e.g. `["joesplumbing.com"]` |
| `organization_num_employees_ranges` | string[] | no | size filter |
| `page` / `per_page` | number | no | pagination |

**Output (per contact):**
```json
{
  "id": "person_xyz",
  "name": "Joe Martinez",
  "first_name": "Joe",
  "last_name": "Martinez",
  "title": "Owner",
  "email": "joe@joesplumbing.com",
  "email_status": "verified",
  "sanitized_phone": "+17135550100",
  "phone_numbers": [{ "sanitized_number": "+17135550100" }],
  "city": "Houston",
  "state": "Texas",
  "country": "United States",
  "linkedin_url": "linkedin.com/in/joemartinez",
  "photo_url": "https://...",
  "seniority": "owner",
  "departments": ["executive"],
  "is_likely_to_engage": true,
  "organization_name": "Joe's Plumbing LLC",
  "organization_id": "org_abc123",
  "organization": {
    "name": "Joe's Plumbing LLC",
    "industry": "Construction",
    "raw_address": "123 Main St, Houston, TX",
    "city": "Houston",
    "state": "Texas",
    "country": "United States"
  },
  "employment_history": [
    { "title": "Owner", "organization_name": "Joe's Plumbing LLC", "start_date": "2005-01" }
  ]
}
```

**Best when:** You already have a domain or Apollo org ID. Without those, results are vague.

---

### 2c. People Match (Enrich)

**Endpoint:** `POST https://api.apollo.io/api/v1/people/match`  
**Purpose:** Given identifying info about a person, return their full profile. This is a **lookup**, not a search.

| Input Param | Type | Required | Description |
|---|---|---|---|
| `email` | string | best | strongest identifier |
| `first_name` | string | good | combine with last_name + domain |
| `last_name` | string | good | combine with first_name + domain |
| `name` | string | ok | full name (less reliable than split) |
| `organization_name` | string | helpful | company name |
| `domain` | string | helpful | company domain |
| `linkedin_url` | string | best | direct profile URL |

**Minimum required:** At least one of: `email`, `first_name`, `linkedin_url`  
**Best results when:** `email` OR (`first_name` + `last_name` + `domain`)

**Output:**
```json
{
  "person": {
    "id": "person_xyz",
    "name": "Joe Martinez",
    "first_name": "Joe",
    "last_name": "Martinez",
    "title": "Owner",
    "email": "joe@joesplumbing.com",
    "email_status": "verified",
    "city": "Houston",
    "state": "Texas",
    "country": "United States",
    "linkedin_url": "linkedin.com/in/joemartinez",
    "twitter_url": null,
    "photo_url": "https://...",
    "seniority": "owner",
    "departments": ["executive"],
    "organization_id": "org_abc123",
    "organization": {
      "name": "Joe's Plumbing LLC",
      "industry": "Construction",
      "estimated_num_employees": 12,
      "annual_revenue_printed": "$1M"
    },
    "employment_history": [
      { "title": "Owner", "organization_name": "Joe's Plumbing LLC", "phone": "+17135550100" }
    ]
  }
}
```

**Returns `null` person when:** Input is too vague (just company name, no email/name/linkedin).

---

## 3. People Data Labs (PDL)

**Provider:** People Data Labs  
**Auth:** API key header (`X-Api-Key`)  
**Pricing:** $0.01–0.10 per record depending on plan. Free tier: 100 records/month.  
**Rate Limits:** 10 req/min on free tier

### 3a. Person Search (SQL)

**Endpoint:** `GET https://api.peopledatalabs.com/v5/person/search`  
**Purpose:** Find people by company, title, location using SQL-like queries. Best for finding decision-makers at a known company.

| Input Param | Type | Required | Description |
|---|---|---|---|
| `sql` | string | yes | SQL query against person table |
| `size` | number | no | max results (default 10) |
| `dataset` | string | no | `"all"` or `"resume"` |

**SQL fields available:**
- `job_company_name` — current employer
- `job_title` — current title
- `job_title_role` — normalized role (e.g. `"owner"`)
- `location_locality` — city
- `location_region` — state/province
- `location_country` — country
- `job_start_date` — when they started current role

**Example SQL:**
```sql
SELECT * FROM person
WHERE job_company_name LIKE '%Joe''s Plumbing%'
AND (job_title LIKE '%CEO%' OR job_title LIKE '%Owner%' OR job_title LIKE '%Founder%' OR job_title LIKE '%President%')
```

**Output (per person in `data[]`):**
```json
{
  "id": "pdl_abc123",
  "full_name": "Joe Martinez",
  "first_name": "Joe",
  "last_name": "Martinez",
  "middle_name": null,
  "job_title": "Owner",
  "job_title_role": "owner",
  "job_company_name": "Joe's Plumbing",
  "job_company_website": "joesplumbing.com",
  "job_company_industry": "Construction",
  "job_company_size": "1-10",
  "job_start_date": "2005-01",
  "emails": [
    { "address": "joe@joesplumbing.com", "type": "professional", "current": true },
    { "address": "joe.martinez@gmail.com", "type": "personal", "current": true }
  ],
  "phone_numbers": ["+17135550100"],
  "linkedin_url": "linkedin.com/in/joemartinez",
  "linkedin_username": "joemartinez",
  "facebook_url": "facebook.com/joe.martinez",
  "twitter_url": null,
  "github_url": null,
  "location_name": "Houston, Texas, United States",
  "location_locality": "Houston",
  "location_region": "Texas",
  "location_country": "united states",
  "skills": ["plumbing", "project management"],
  "interests": [],
  "experience": [
    {
      "company": { "name": "Joe's Plumbing" },
      "title": { "name": "Owner" },
      "start_date": "2005-01"
    }
  ],
  "education": [
    { "school": { "name": "Houston Community College" }, "degrees": [] }
  ]
}
```

**Richest person data of all APIs.** Returns multiple email types, phone numbers, full career history, skills, education.

**Gotcha:** `LIMIT` and `ORDER BY` are NOT supported in the SQL — use `size` param instead.

---

## 4. Hunter.io

**Provider:** Hunter.io  
**Auth:** Query param (`api_key`)  
**Pricing:** Free: 25 searches/month. Paid starts at $49/month for 500.  
**Rate Limits:** Varies by plan

### 4a. Domain Search

**Endpoint:** `GET https://api.hunter.io/v2/domain-search`  
**Purpose:** Given a website domain, find all email addresses associated with it and identify the owner/decision-maker.

| Input Param | Type | Required | Description |
|---|---|---|---|
| `domain` | string | yes | e.g. `"joesplumbing.com"` |
| `api_key` | string | yes | API key |
| `limit` | number | no | max emails to return |
| `type` | string | no | `"personal"` or `"generic"` |

**Requires:** A website/domain. Useless without one.

**Output:**
```json
{
  "data": {
    "domain": "joesplumbing.com",
    "organization": "Joe's Plumbing",
    "emails": [
      {
        "value": "joe@joesplumbing.com",
        "type": "personal",
        "confidence": 91,
        "first_name": "Joe",
        "last_name": "Martinez",
        "position": "Owner",
        "department": "executive",
        "seniority": "senior"
      },
      {
        "value": "info@joesplumbing.com",
        "type": "generic",
        "confidence": 80,
        "first_name": null,
        "last_name": null,
        "position": null,
        "department": null,
        "seniority": null
      }
    ]
  }
}
```

**Uniquely provides:** Email addresses with confidence scores, person names tied to specific emails, position/department per email.

---

### 4b. Email Verifier

**Endpoint:** `GET https://api.hunter.io/v2/email-verifier`  
**Purpose:** Verify if a specific email address is deliverable.

| Input Param | Type | Required | Description |
|---|---|---|---|
| `email` | string | yes | email to verify |
| `api_key` | string | yes | API key |

**Output:**
```json
{
  "data": {
    "email": "joe@joesplumbing.com",
    "status": "valid",
    "score": 91,
    "result": "deliverable",
    "regexp": true,
    "gibberish": false,
    "disposable": false,
    "webmail": false,
    "mx_records": true,
    "smtp_server": true,
    "smtp_check": true,
    "accept_all": false,
    "block": false
  }
}
```

**Status values:** `valid`, `invalid`, `accept_all`, `webmail`, `disposable`, `unknown`  
**Result values:** `deliverable`, `undeliverable`, `risky`, `unknown`

**Currently:** Not called anywhere in the pipeline. Could be used after Hunter domain search to verify the found email.

---

## 5. Yelp Fusion

**Provider:** Yelp  
**Auth:** Bearer token header  
**Pricing:** Free: 5000 calls/day  
**Rate Limits:** 5000/day, varies by endpoint

### 5a. Business Search

**Endpoint:** `GET https://api.yelp.com/v3/businesses/search`  
**Purpose:** Search for businesses by keyword + location. Alternative discovery source to Google.

| Input Param | Type | Required | Description |
|---|---|---|---|
| `term` | string | no | search term |
| `location` | string | conditional | text location (required if no lat/lng) |
| `latitude` | number | conditional | (required if no location) |
| `longitude` | number | conditional | (required if no location) |
| `radius` | number | no | meters, max 40,000 |
| `limit` | number | no | max 50 |
| `categories` | string | no | Yelp category filter |

**Output (per business):**
```json
{
  "id": "joes-plumbing-houston",
  "name": "Joe's Plumbing",
  "phone": "+17135550100",
  "display_phone": "(713) 555-0100",
  "url": "https://www.yelp.com/biz/joes-plumbing-houston",
  "rating": 4.5,
  "review_count": 42,
  "categories": [
    { "alias": "plumbing", "title": "Plumbing" }
  ],
  "location": {
    "display_address": ["123 Main St", "Houston, TX 77001"],
    "zip_code": "77001",
    "city": "Houston",
    "state": "TX",
    "country": "US"
  },
  "coordinates": { "latitude": 29.76, "longitude": -95.36 },
  "image_url": "https://...",
  "price": "$$",
  "is_closed": false,
  "transactions": ["delivery"]
}
```

**Does NOT return:** website, owner, email, employee count, revenue

---

### 5b. Business Match

**Endpoint:** `GET https://api.yelp.com/v3/businesses/matches`  
**Purpose:** Verify a known business exists on Yelp. Input is structured (name + address), not a keyword search.

| Input Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | business name |
| `address1` | string | recommended | street address |
| `city` | string | recommended | city |
| `state` | string | recommended | state |
| `country` | string | recommended | 2-letter ISO code |
| `zip_code` | string | no | postal code |
| `phone` | string | no | phone number |

**Output:**
```json
{
  "businesses": [
    { "id": "joes-plumbing-houston", "url": "https://..." }
  ]
}
```

Returns only IDs — must follow up with Business Details to get full data.

---

### 5c. Business Details

**Endpoint:** `GET https://api.yelp.com/v3/businesses/{id}`  
**Purpose:** Full details for a single Yelp business.

| Input Param | Type | Required | Description |
|---|---|---|---|
| `{id}` | string (path) | yes | Yelp business ID |

**Output:**
```json
{
  "id": "joes-plumbing-houston",
  "name": "Joe's Plumbing",
  "phone": "+17135550100",
  "display_phone": "(713) 555-0100",
  "url": "https://www.yelp.com/biz/joes-plumbing-houston",
  "rating": 4.5,
  "review_count": 42,
  "categories": [{ "alias": "plumbing", "title": "Plumbing" }],
  "location": {
    "display_address": ["123 Main St", "Houston, TX 77001"],
    "zip_code": "77001",
    "city": "Houston",
    "state": "TX",
    "country": "US"
  },
  "coordinates": { "latitude": 29.76, "longitude": -95.36 },
  "image_url": "https://...",
  "photos": ["https://...", "https://..."],
  "price": "$$",
  "hours": [{ "open": [{ "start": "0800", "end": "1800", "day": 0 }] }],
  "is_closed": false,
  "transactions": ["delivery"]
}
```

**Uniquely provides:** Yelp categories, price tier, hours, photos, transactions. No owner/email.

---

## 6. Numverify

**Provider:** APILayer (Numverify)  
**Auth:** Query param (`access_key`)  
**Pricing:** Free: 100 validations/month. Paid from $15/month for 5,000.  
**Rate Limits:** Plan-dependent  
**Note:** Free tier uses HTTP only (no HTTPS)

### 6a. Phone Validation

**Endpoint:** `GET http://apilayer.net/api/validate`  
**Purpose:** Validate a phone number and get carrier/line type info.

| Input Param | Type | Required | Description |
|---|---|---|---|
| `access_key` | string | yes | API key |
| `number` | string | yes | phone number (digits only, no `+`) |
| `format` | number | no | `1` for formatted output |
| `country_code` | string | no | 2-letter ISO to help parsing |

**Output:**
```json
{
  "valid": true,
  "number": "17135550100",
  "local_format": "7135550100",
  "international_format": "+17135550100",
  "country_prefix": "+1",
  "country_code": "US",
  "country_name": "United States of America",
  "location": "Texas",
  "carrier": "T-Mobile",
  "line_type": "mobile"
}
```

**Line type values:** `landline`, `mobile`, `voip`, `toll_free`, `special_services`, `unknown`

**Useful fields:** `valid` (bool), `line_type`, `carrier`  
**Not useful for:** Finding owner, enriching lead data — purely a validation/classification tool.

---

## 7. OpenAI (ChatGPT)

**Provider:** OpenAI  
**Auth:** SDK with API key  
**Pricing:** GPT-4o: ~$2.50/1M input tokens, ~$10/1M output tokens  
**Rate Limits:** Tier-dependent (typically 500 RPM)

### 7a. Chat Completion (Lead Verification)

**Endpoint:** `POST https://api.openai.com/v1/chat/completions` (via SDK)  
**Purpose:** Guess owner name and business details using LLM knowledge.

| Input (prompt fields) | Description |
|---|---|
| `companyName` | business name |
| `city`, `state`, `country` | location |
| `industry` | business category |

**Prompted to return:**
```json
{
  "ownerName": "Joe Martinez",
  "industry": "Plumbing",
  "employeeCount": "5-15",
  "revenue": "$500K - $2M",
  "businessDetails": "Family-owned plumbing business serving Greater Houston...",
  "confidence": 35
}
```

**Nature of data:** Guesses based on training data. Not a database lookup. Confidence scores are self-reported and unreliable.

---

## 8. Anthropic (Claude)

**Provider:** Anthropic  
**Auth:** SDK with API key  
**Pricing:** Claude Sonnet: ~$3/1M input tokens, ~$15/1M output tokens  
**Rate Limits:** Tier-dependent

### 8a. Message (Lead Verification)

**Endpoint:** `POST https://api.anthropic.com/v1/messages` (via SDK)  
**Purpose:** Same as ChatGPT — guess owner name and business details.

| Input (prompt fields) | Description |
|---|---|
| `companyName` | business name |
| `city`, `state`, `country` | location |
| `industry` | business category |

**Prompted to return:** Same JSON shape as ChatGPT (see above).

**Nature of data:** Same caveats. Guesses, not facts.

---

## 9. Field Coverage Matrix

Which API can provide which lead field:

| Field | Google Places | Apollo Org | Apollo People | Apollo Enrich | PDL | Hunter | Yelp | Numverify | AI |
|---|---|---|---|---|---|---|---|---|---|
| **companyName** | ✅ | ✅ | ✅ | ✅ | ✅ (job_company) | ✅ (organization) | ✅ | — | — |
| **phone** | ✅ | ✅ | ✅ | ✅ (via history) | ✅ | — | ✅ | validates only | — |
| **address** | ✅ | ✅ | ✅ (org) | — | — | — | ✅ | — | — |
| **city** | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | — | — |
| **state** | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | — | — |
| **country** | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | — |
| **zipcode** | ✅ | ✅ | — | — | — | — | ✅ | — | — |
| **website** | ✅ | ✅ | — | — | ✅ (job_company) | — | — | — | — |
| **rating** | ✅ | — | — | — | — | — | ✅ | — | — |
| **industry** | ✅ (types) | ✅ | ✅ (org) | ✅ (org) | ✅ (job_company) | — | ✅ (categories) | — | ✅ (guess) |
| **ownerName** | — | — | ✅ | ✅ | ✅ | ✅ | — | — | ✅ (guess) |
| **ownerTitle** | — | — | ✅ | ✅ | ✅ | ✅ (position) | — | — | — |
| **email** | — | — | ✅ | ✅ | ✅ | ✅ | — | — | — |
| **personalEmail** | — | — | — | — | ✅ | — | — | — | — |
| **linkedin** | — | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| **employeeCount** | — | ✅ | — | ✅ (org) | ✅ (company_size) | — | — | — | ✅ (guess) |
| **revenue** | — | ✅ | — | ✅ (org) | — | — | — | — | ✅ (guess) |
| **foundedYear** | — | ✅ | — | — | — | — | — | — | — |
| **techStack** | — | ✅ | — | — | — | — | — | — | — |
| **socialMedia** | — | ✅ (3) | ✅ (linkedin) | ✅ (2) | ✅ (4) | — | — | — | — |
| **phoneValid** | — | — | — | — | — | — | — | ✅ | — |
| **lineType** | — | — | — | — | — | — | — | ✅ | — |
| **carrier** | — | — | — | — | — | — | — | ✅ | — |
| **emailConfidence** | — | — | ✅ | ✅ | — | ✅ | — | — | — |
| **skills** | — | — | — | — | ✅ | — | — | — | — |
| **education** | — | — | — | — | ✅ | — | — | — | — |
| **experience** | — | — | ✅ | ✅ | ✅ | — | — | — | — |
| **yelpData** (price, hours, photos) | — | — | — | — | — | — | ✅ | — | — |

### Key Takeaways

- **Google Places** is the only discovery source that works with just a keyword + location
- **Hunter** is the only way to get emails from just a domain (no person info needed) Will also give potential leads names
- **PDL** returns the richest person data (multiple emails, phones, skills, education, career history)
- **Apollo Enrich** needs good input (email or name+domain) to return anything — useless "cold"
- **Apollo People Search** is the best way to find contacts when you have a domain or org ID
- **Yelp** overlaps heavily with Google Places; unique value is categories, price tier, hours
- **Numverify** only validates — doesn't discover or enrich anything
- **AI (ChatGPT/Claude)** guesses — no factual data source behind it
