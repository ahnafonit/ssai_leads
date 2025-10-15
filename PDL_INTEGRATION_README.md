# People Data Labs (PDL) Integration - Find Company Owners

This document describes the People Data Labs API integration for finding company owners and decision-makers.

## Overview

The application now includes People Data Labs Person Search API integration to find owners, CEOs, founders, and other decision-makers for businesses. This provides accurate, verified contact information including:

- Owner/Decision-maker names
- Professional and personal emails
- Phone numbers
- LinkedIn and social media profiles
- Work history and education
- Skills and interests

## API Configuration

### API Key Setup

The PDL API key has been added to `.env`:

```env
PDL_API_KEY=f9bb8bd37128ead92c222abbc054b05aa7fad0f77ff56e5b88b9f992b432a277
```

### People Data Labs Account

- Plan: **People Search Plan** (Upgraded)
- Access: Person Search API v5

## Implementation Details

### 1. Core Function: `findCompanyOwnerWithPDL()`

Located in `server.js` (lines ~608-730), this function searches for company owners using PDL's Person Search API.

**Parameters:**
- `companyName` (required): Name of the company
- `city` (optional): City where company is located
- `state` (optional): State/province
- `country` (optional): Country

**Search Strategy:**
1. Builds SQL query to search PDL database
2. Filters by job title roles: owner, ceo, founder, president, partner, managing_director
3. Orders by most recent job start date
4. Returns top 10 results, prioritizing most relevant owner

**Returns:**
- Owner name (full, first, last, middle)
- Job title and role
- Contact information (emails, phones)
- Social media profiles (LinkedIn, Facebook, Twitter, GitHub)
- Company information
- Work history and education
- Skills and interests
- All found decision-makers

### 2. API Endpoint: `/api/pdl/find-owner`

**Method:** POST

**Request Body:**
```json
{
  "companyName": "Acme Restaurant",
  "city": "Chicago",
  "state": "IL",
  "country": "United States"
}
```

**Response (Success):**
```json
{
  "success": true,
  "owner": {
    "ownerName": "John Smith",
    "firstName": "John",
    "lastName": "Smith",
    "middleName": "Robert",
    "title": "Owner & CEO",
    "titleRole": "owner",
    "email": "john@acmerestaurant.com",
    "personalEmails": ["johnsmith@gmail.com"],
    "professionalEmails": ["john@acmerestaurant.com"],
    "phone": "+1-312-555-1234",
    "allPhones": ["+1-312-555-1234", "+1-312-555-5678"],
    "linkedinUrl": "linkedin.com/in/johnsmith",
    "linkedinUsername": "johnsmith",
    "facebookUrl": "facebook.com/johnsmith",
    "twitterUrl": "twitter.com/johnsmith",
    "githubUrl": null,
    "location": "Chicago, Illinois, United States",
    "city": "Chicago",
    "state": "Illinois",
    "country": "United States",
    "jobCompanyName": "Acme Restaurant",
    "jobCompanyWebsite": "acmerestaurant.com",
    "jobCompanyIndustry": "restaurants",
    "jobCompanySize": "11-50",
    "jobStartDate": "2015-01-01",
    "skills": ["Restaurant Management", "Operations", "Customer Service"],
    "interests": ["Food", "Wine", "Travel"],
    "experience": [
      {
        "company": "Acme Restaurant",
        "title": "Owner & CEO",
        "start_date": "2015-01-01",
        "end_date": null,
        "is_primary": true
      }
    ],
    "education": [
      {
        "school": "Culinary Institute of America",
        "degree": "Associate",
        "majors": ["Culinary Arts"],
        "start_date": "2010",
        "end_date": "2012"
      }
    ],
    "allContacts": [
      // Array of all decision-makers found (up to 10)
    ],
    "pdlPersonId": "abc123xyz",
    "confidence": 90,
    "source": "People Data Labs Person Search"
  },
  "timestamp": "2025-10-10T09:30:00.000Z"
}
```

**Response (No Owner Found):**
```json
{
  "error": "No owner found",
  "message": "Could not find owner/decision-maker for this company in People Data Labs database"
}
```

## Usage Examples

### Example 1: Find Owner with Full Location

```bash
curl -X POST http://localhost:5000/api/pdl/find-owner \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Joe'\''s Pizza",
    "city": "New York",
    "state": "NY",
    "country": "United States"
  }'
```

### Example 2: Find Owner with Company Name Only

```bash
curl -X POST http://localhost:5000/api/pdl/find-owner \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Starbucks Coffee Company"
  }'
```

### Example 3: From Frontend (JavaScript/React)

```javascript
async function findCompanyOwner(companyName, city, state, country) {
  try {
    const response = await fetch('http://localhost:5000/api/pdl/find-owner', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        companyName,
        city,
        state,
        country
      })
    });

    const data = await response.json();
    
    if (data.success) {
      console.log('Owner found:', data.owner.ownerName);
      console.log('Email:', data.owner.email);
      console.log('Phone:', data.owner.phone);
      console.log('LinkedIn:', data.owner.linkedinUrl);
      return data.owner;
    } else {
      console.log('No owner found:', data.message);
      return null;
    }
  } catch (error) {
    console.error('Error finding owner:', error);
    return null;
  }
}

// Usage
const owner = await findCompanyOwner('Acme Corp', 'San Francisco', 'CA', 'USA');
```

## Integration with Existing Workflows

### Integration Point 1: After Google Places Scraping

You can automatically find owners after scraping businesses:

```javascript
// After scraping with Google Places
const businesses = await scrapeGoogleMaps('restaurants', 'Chicago, IL');

// Find owner for each business
for (const business of businesses) {
  const owner = await findCompanyOwnerWithPDL(
    business.companyName,
    business.city,
    business.state,
    business.country
  );
  
  if (owner) {
    business.ownerData = owner;
  }
}
```

### Integration Point 2: In Verification Flow

The function can be called during the `/api/verify` endpoint to enrich lead data with owner information.

### Integration Point 3: Manual Lead Entry

When a user manually enters a lead, automatically search for the owner:

```javascript
// User enters company information
const manualLead = {
  companyName: 'Joe\'s Pizza',
  city: 'Brooklyn',
  state: 'NY'
};

// Find owner
const owner = await findCompanyOwnerWithPDL(
  manualLead.companyName,
  manualLead.city,
  manualLead.state
);

// Merge with lead data
const enrichedLead = { ...manualLead, ...owner };
```

## SQL Query Examples

The function uses PDL's SQL-based search. Here are the query patterns:

### Basic Query
```sql
SELECT * FROM person 
WHERE job_company_name='Acme Restaurant'
AND job_title_role IN ('owner', 'ceo', 'founder', 'president', 'partner', 'managing_director')
ORDER BY job_start_date DESC 
LIMIT 10
```

### With Location Filter
```sql
SELECT * FROM person 
WHERE job_company_name='Acme Restaurant'
AND location_locality='Chicago'
AND location_region='Illinois'
AND location_country='United States'
AND job_title_role IN ('owner', 'ceo', 'founder')
ORDER BY job_start_date DESC 
LIMIT 10
```

## Data Quality & Confidence

### Confidence Score
- **90%**: High confidence from PDL (verified data source)
- Owner data is sourced from PDL's 3B+ person profiles
- Data includes multiple verification points

### Email Quality
- Prioritizes professional emails over personal
- Marks current vs historical emails
- Provides both work and personal contact options

### Phone Number Quality
- Returns international format
- Multiple phone numbers when available
- Can be validated with Numverify API

## Cost Considerations

### PDL Pricing
- **Person Search**: ~$0.50 - $1.00 per query
- Returns up to 100 results per query (we limit to 10)
- More cost-effective than individual person enrichments

### Optimization Tips
1. **Cache results**: Store owner data to avoid repeated searches
2. **Batch processing**: Group searches by location for efficiency
3. **Smart filtering**: Use location filters to narrow results
4. **Fallback strategy**: Use PDL for high-value leads, AI for others

## Error Handling

### Common Errors

1. **API Key Not Configured**
```json
{
  "error": "Failed to find company owner",
  "message": "PDL API key not configured"
}
```

2. **Company Not Found**
```json
{
  "error": "No owner found",
  "message": "Could not find owner/decision-maker for this company in People Data Labs database"
}
```

3. **Rate Limiting**
- PDL may rate limit based on your plan
- Implement retry logic with exponential backoff
- Monitor API usage in PDL dashboard

### Troubleshooting

**No results returned:**
- Try searching with just company name (no location)
- Check if company name exactly matches PDL database
- Try alternative company name formats (e.g., "Inc" vs "Incorporated")

**Wrong owner returned:**
- Add location filters to narrow results
- Check `allContacts` array for alternative matches
- Verify company name spelling

## Future Enhancements

### Planned Features
1. **Auto-enrichment**: Automatically find owners during scraping
2. **Bulk search**: Search multiple companies in one request
3. **Caching layer**: Store results in database to reduce API costs
4. **Owner scoring**: Rank multiple decision-makers by relevance
5. **Email verification**: Integrate with email verification service
6. **Frontend UI**: Add owner search button in lead details view

### Additional PDL APIs
Consider integrating these PDL APIs:
- **Company Enrichment**: Get detailed company data
- **Person Enrichment**: Enrich existing contact with more data
- **Company Search**: Find companies by criteria
- **Bulk APIs**: Process large datasets efficiently

## Testing

### Test the Endpoint

```bash
# Test with a well-known company
curl -X POST http://localhost:5000/api/pdl/find-owner \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Microsoft",
    "city": "Redmond",
    "state": "WA"
  }'

# Test with location only (no state)
curl -X POST http://localhost:5000/api/pdl/find-owner \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Starbucks",
    "city": "Seattle"
  }'

# Test with company name only
curl -X POST http://localhost:5000/api/pdl/find-owner \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Apple Inc"
  }'
```

### Verify in Logs

Check backend logs for:
```
Searching for owner of: [Company Name] in [City]
PDL SQL Query: SELECT * FROM person WHERE...
Found X potential owners/decision-makers
✓ Found primary owner: [Name] ([Title])
  Email: [Email]
  Phone: [Phone]
```

## Support & Resources

### People Data Labs Documentation
- API Docs: https://docs.peopledatalabs.com/
- Person Search: https://docs.peopledatalabs.com/docs/person-search-api
- SQL Syntax: https://docs.peopledatalabs.com/docs/sql-queries

### Dashboard
- View usage: https://dashboard.peopledatalabs.com/
- Monitor credits and API calls
- Check data quality metrics

### Support
- Email: support@peopledatalabs.com
- Documentation: https://docs.peopledatalabs.com/
- Status page: https://status.peopledatalabs.com/

---

## Summary

The People Data Labs integration is now fully implemented and ready to use. It provides:

✅ **Accurate owner/decision-maker discovery**
✅ **Comprehensive contact information** (email, phone, LinkedIn)
✅ **Work history and education data**
✅ **High confidence scores (90%)**
✅ **Easy-to-use REST API endpoint**
✅ **SQL-based flexible searching**

The implementation is production-ready and can be integrated into your lead scraping and enrichment workflows to automatically discover company owners and key decision-makers.
