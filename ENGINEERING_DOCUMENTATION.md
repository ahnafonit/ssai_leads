# SSAI Lead Scraper Pro - Engineering Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Technology Stack](#technology-stack)
4. [API Documentation](#api-documentation)
5. [Data Flow](#data-flow)
6. [Integration Points](#integration-points)
7. [Database Schema](#database-schema)
8. [Development Setup](#development-setup)
9. [Deployment Architecture](#deployment-architecture)
10. [Security Considerations](#security-considerations)
11. [Error Handling](#error-handling)
12. [Performance & Scalability](#performance--scalability)
13. [Testing Strategy](#testing-strategy)
14. [Monitoring & Logging](#monitoring--logging)

---

## System Overview

### Purpose
SSAI Lead Scraper Pro is an AI-powered lead generation platform that aggregates business information from multiple data sources and enriches it using artificial intelligence. The system supports three primary search methods:
- **Map-based area selection** (circles, polygons, rectangles, lines, multi-polygons)
- **Text-based location search**
- **Manual contact enrichment**

### Key Features
- Multi-source data aggregation (Google Places, Apollo, Yelp, PDL, Hunter.io)
- AI-powered data verification and enrichment (OpenAI GPT-4, Claude)
- Interactive map-based search with custom area drawing
- Phone number validation (Numverify)
- Email discovery and verification (Hunter.io)
- Owner/decision-maker identification (People Data Labs)
- Business verification (Yelp Fusion API)
- Real-time verification status tracking
- CSV/JSON export capabilities
- Auto-pagination for large datasets

### Architecture Principles
- **Microservices**: Separate frontend and backend services
- **API-First Design**: RESTful API architecture
- **Scalability**: Designed for horizontal scaling
- **Resilience**: Graceful degradation when APIs are unavailable
- **Security**: Rate limiting, CORS, helmet middleware

---

## Architecture

### High-Level Architecture

```
┌─────────────────┐
│   Web Browser   │
│  (React SPA)    │
└────────┬────────┘
         │ HTTPS
         │
┌────────▼────────────────────────────────────────┐
│           Google Cloud Platform                 │
│  ┌──────────────────┐  ┌──────────────────┐   │
│  │  Frontend (React)│  │  Backend (Node)  │   │
│  │  Cloud Run       │  │  Cloud Run       │   │
│  └──────────────────┘  └────────┬─────────┘   │
│         Port 3000                │ Port 5000    │
└──────────────────────────────────┼─────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
         │                         │                         │
    ┌────▼─────┐            ┌─────▼──────┐          ┌──────▼──────┐
    │  Google  │            │   Apollo   │          │   OpenAI    │
    │  Places  │            │    API     │          │   GPT-4     │
    │   API    │            │            │          │             │
    └──────────┘            └────────────┘          └─────────────┘
         │                         │                         │
         │                         │                         │
    ┌────▼─────┐            ┌─────▼──────┐          ┌──────▼──────┐
    │   Yelp   │            │    PDL     │          │  Anthropic  │
    │  Fusion  │            │   Person   │          │   Claude    │
    │   API    │            │   Search   │          │             │
    └──────────┘            └────────────┘          └─────────────┘
         │                         │                         │
         │                         │                         │
    ┌────▼─────┐            ┌─────▼──────┐          ┌──────▼──────┐
    │ Hunter.io│            │ Numverify  │          │   In-Memory │
    │  Email   │            │   Phone    │          │    Store    │
    │  Finder  │            │ Validation │          │ (for leads) │
    └──────────┘            └────────────┘          └─────────────┘
```

### Component Architecture

#### Frontend (React)
```
src/
├── App.js              # Main application component
├── index.js            # Application entry point
├── index.css           # Global styles (Tailwind)
└── components/         # (Future modular components)
```

**Key Frontend Features:**
- Single Page Application (SPA)
- Google Maps API integration for drawing tools
- Real-time verification status tracking
- Responsive Tailwind CSS design
- Three main tabs: Map Search, Text Search, Find Contacts

#### Backend (Express.js)
```
lead-scraper-backend/
├── server.js           # Main server file (monolithic)
├── package.json        # Dependencies
└── .env               # Environment variables
```

**Key Backend Components:**
- RESTful API endpoints
- Multiple data source integrations
- AI verification pipeline
- Rate limiting middleware
- Security middleware (helmet, CORS)

---

## Technology Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 19.1.1 | UI framework |
| Tailwind CSS | 3.4.17 | Styling framework |
| Lucide React | 0.544.0 | Icon library |
| Google Maps API | Latest | Interactive map & drawing tools |

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | Latest | Runtime environment |
| Express | 5.1.0 | Web framework |
| Axios | 1.12.2 | HTTP client |
| Puppeteer | 24.22.3 | Web scraping (currently unused) |
| Helmet | 8.1.0 | Security middleware |
| CORS | 2.8.5 | Cross-origin resource sharing |
| Express Rate Limit | 8.1.0 | API rate limiting |

### AI & Data Services
| Service | Purpose | API Version |
|---------|---------|-------------|
| OpenAI GPT-4 | Lead verification & enrichment | 5.23.1 |
| Anthropic Claude | Secondary AI verification | 0.65.0 |
| Google Places API | Primary business data source | v3 |
| Apollo.io | Organization & people search | v1 |
| Yelp Fusion API | Business verification | v3 |
| People Data Labs | Owner/decision-maker search | v5 |
| Hunter.io | Email discovery & verification | v2 |
| Numverify | Phone validation | Latest |

### Infrastructure
| Component | Technology |
|-----------|------------|
| Cloud Platform | Google Cloud Platform |
| Container Runtime | Cloud Run |
| Container Registry | Artifact Registry |
| CI/CD | GitHub Actions |
| Version Control | Git/GitHub |

---

## API Documentation

### Base URL
- **Development**: `http://localhost:5000/api`
- **Production**: `https://lead-scraper-backend-[PROJECT-ID].run.app/api`

### Authentication
Currently, no authentication is required. Future implementation should include:
- API key authentication
- Rate limiting per user/key
- OAuth 2.0 for enterprise customers

### Endpoints

#### 1. Health Check
```http
GET /api/health
```

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2025-10-15T11:00:00.000Z"
}
```

---

#### 2. Text-Based Search
```http
POST /api/scrape
```

**Request Body:**
```json
{
  "query": "restaurants",
  "location": "New York, NY",
  "country": "USA",
  "zipcode": "10001",
  "maxLeads": 25,
  "useApolloSearch": false,
  "enrichWithApollo": false
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "id": 1697123456789.123,
      "companyName": "Joe's Pizza",
      "phone": "+1-212-555-1234",
      "address": "123 Main St, New York, NY 10001",
      "zipcode": "10001",
      "city": "New York",
      "state": "NY",
      "country": "USA",
      "industry": "Restaurant",
      "website": "www.joespizza.com",
      "rating": 4.5,
      "reviewCount": 234,
      "latitude": 40.7128,
      "longitude": -74.0060,
      "placeId": "ChIJ...",
      "source": "Google Places API"
    }
  ],
  "count": 25,
  "searchSource": "Google Places",
  "query": "restaurants",
  "location": "New York, NY",
  "timestamp": "2025-10-15T11:00:00.000Z"
}
```

**Data Sources:**
1. **Google Places API** (Default): Returns up to 60 results via pagination
2. **Apollo Organizations** (Optional): When `useApolloSearch: true`

---

#### 3. Map Area Search
```http
POST /api/scrape-area
```

**Request Body - Circle:**
```json
{
  "query": "restaurants",
  "area": {
    "type": "circle",
    "center": { "lat": 40.7128, "lng": -74.0060 },
    "radius": 5000
  },
  "country": "USA",
  "zipcode": "10001",
  "maxLeads": 25
}
```

**Request Body - Polygon:**
```json
{
  "query": "restaurants",
  "area": {
    "type": "polygon",
    "coordinates": [
      { "lat": 40.7128, "lng": -74.0060 },
      { "lat": 40.7138, "lng": -74.0070 },
      { "lat": 40.7118, "lng": -74.0080 }
    ]
  },
  "maxLeads": 25
}
```

**Request Body - Rectangle:**
```json
{
  "query": "restaurants",
  "area": {
    "type": "rectangle",
    "bounds": {
      "north": 40.7138,
      "south": 40.7118,
      "east": -74.0050,
      "west": -74.0070
    }
  },
  "maxLeads": 25
}
```

**Request Body - Multi-Polygon:**
```json
{
  "query": "restaurants",
  "area": {
    "type": "multipolygon",
    "polygons": [
      [
        { "lat": 40.7128, "lng": -74.0060 },
        { "lat": 40.7138, "lng": -74.0070 },
        { "lat": 40.7118, "lng": -74.0080 }
      ],
      [
        { "lat": 40.7200, "lng": -74.0100 },
        { "lat": 40.7210, "lng": -74.0110 },
        { "lat": 40.7190, "lng": -74.0120 }
      ]
    ]
  },
  "maxLeads": 50
}
```

**Response:** Similar to text-based search with additional fields:
```json
{
  "success": true,
  "results": [...],
  "count": 25,
  "query": "restaurants",
  "area": { "type": "circle", ... },
  "detectedLocation": "New York, NY, USA",
  "timestamp": "2025-10-15T11:00:00.000Z"
}
```

**Special Handling:**
- Multi-polygons are searched individually and results are deduplicated
- Reverse geocoding is performed to determine location names
- Each polygon in a multi-polygon contributes to the total lead count

---

#### 4. AI Verification & Enrichment
```http
POST /api/verify
```

**Request Body:**
```json
{
  "lead": {
    "id": 1697123456789.123,
    "companyName": "Joe's Pizza",
    "phone": "+1-212-555-1234",
    "address": "123 Main St, New York, NY 10001",
    "city": "New York",
    "state": "NY",
    "country": "USA",
    "industry": "Restaurant"
  },
  "aiProvider": "both"
}
```

**Verification Pipeline (Sequential):**
1. **Apollo Enrichment** - Organization data
2. **People Data Labs** - Owner/decision-maker search
3. **Hunter.io Email Finder** - Email discovery
4. **Numverify** - Phone validation
5. **Yelp Verification** - Business verification
6. **Claude AI** - Primary AI verification
7. **ChatGPT** - Secondary AI verification

**Response:**
```json
{
  "id": 1697123456789.123,
  "companyName": "Joe's Pizza",
  "phone": "+1-212-555-1234",
  "phoneFormatted": "+1 212-555-1234",
  "phoneValidation": {
    "valid": true,
    "internationalFormat": "+1 212-555-1234",
    "lineType": "mobile",
    "carrier": "Verizon"
  },
  "address": "123 Main St, New York, NY 10001",
  "zipcode": "10001",
  "city": "New York",
  "state": "NY",
  "country": "USA",
  "industry": "Restaurant",
  "ownerName": "Joseph Smith",
  "email": "joe@joespizza.com",
  "website": "www.joespizza.com",
  "employeeCount": "10-50",
  "revenue": "$1M - $5M",
  "businessDetails": "Family-owned Italian restaurant...",
  "verified": true,
  "aiConfidence": 100,
  "aiSource": "Claude (Primary) + ChatGPT (Secondary)",
  "apolloEnriched": true,
  "pdlEnriched": true,
  "hunterEnriched": true,
  "yelpEnriched": true,
  "socialMedia": {
    "linkedin": "linkedin.com/company/joes-pizza",
    "facebook": "facebook.com/joespizza"
  }
}
```

---

#### 5. Manual Lead Enrichment
```http
POST /api/enrich-manual
```

**Request Body:**
```json
{
  "companyName": "Joe's Pizza",
  "phone": "212-555-1234",
  "address": "123 Main St",
  "city": "New York",
  "zipcode": "10001",
  "country": "USA"
}
```

**Search Strategy:**
1. Search by phone number (if provided)
2. Search by address (if provided)
3. Search by company name + location
4. Apply AI enrichment

**Response:** Same as AI verification endpoint

---

#### 6. Apollo Organization Search
```http
POST /api/apollo/organizations
```

**Request Body:**
```json
{
  "locations": ["New York, NY"],
  "employeeRanges": ["1-10", "11-50"],
  "revenueMin": 1000000,
  "revenueMax": 10000000,
  "keywords": ["restaurant", "food"],
  "page": 1,
  "perPage": 25
}
```

---

#### 7. Apollo People Search
```http
POST /api/apollo/people
```

**Request Body:**
```json
{
  "titles": ["CEO", "Owner", "Founder"],
  "seniorities": ["owner", "c_suite"],
  "locations": ["New York, NY"],
  "organizationIds": ["abc123"],
  "page": 1,
  "perPage": 25
}
```

---

#### 8. PDL Owner Search
```http
POST /api/pdl/find-owner
```

**Request Body:**
```json
{
  "companyName": "Joe's Pizza",
  "city": "New York",
  "state": "NY",
  "country": "USA"
}
```

**Response:**
```json
{
  "success": true,
  "owner": {
    "ownerName": "Joseph Smith",
    "firstName": "Joseph",
    "lastName": "Smith",
    "title": "Owner",
    "email": "joe@joespizza.com",
    "phone": "+1-212-555-1234",
    "linkedinUrl": "linkedin.com/in/josephsmith",
    "confidence": 90,
    "source": "People Data Labs Person Search"
  }
}
```

---

#### 9. Get AI Status
```http
GET /api/ai-status
```

**Response:**
```json
{
  "openai": {
    "configured": true,
    "status": "active"
  },
  "claude": {
    "configured": true,
    "status": "active"
  },
  "apollo": {
    "configured": true,
    "status": "active"
  },
  "numverify": {
    "configured": true,
    "status": "active"
  },
  "peopleDataLabs": {
    "configured": true,
    "status": "active"
  },
  "hunter": {
    "configured": true,
    "status": "active"
  },
  "yelp": {
    "configured": true,
    "status": "active"
  }
}
```

---

#### 10. Location Geocoding
```http
POST /api/geocode
```

**Request Body:**
```json
{
  "query": "New York, NY"
}
```

**Response:**
```json
{
  "results": [
    {
      "display_name": "New York, NY, USA",
      "lat": 40.7128,
      "lon": -74.0060,
      "type": "city",
      "importance": 0.9
    }
  ]
}
```

---

## Data Flow

### Search Flow

```
User Input
    │
    ├─── Map Search
    │    │
    │    ├─ Draw Area (Circle/Polygon/Rectangle/Multi-Polygon)
    │    ├─ Enter Query
    │    └─ Click "Scrape Selected Area"
    │         │
    │         ├─ Calculate Area Center
    │         ├─ Reverse Geocode to Location
    │         ├─ Call Google Places API (with area bounds)
    │         └─ Return Results
    │
    ├─── Text Search
    │    │
    │    ├─ Enter Query + Location
    │    └─ Click "Start Scraping"
    │         │
    │         ├─ Call Google Places API or Apollo API
    │         └─ Return Results
    │
    └─── Manual Entry
         │
         ├─ Enter Partial Data
         └─ Click "Enrich & Add Lead"
              │
              ├─ Search by Phone (Google Places)
              ├─ Search by Address (Google Places)
              ├─ Search by Company Name (Google Places)
              ├─ Apply AI Enrichment
              └─ Return Enriched Lead
```

### Verification Flow

```
Scraped Lead
    │
    ├─ Step 1: Apollo Enrichment
    │    └─ Match by company name, domain, or email
    │         └─ Returns: owner, title, employee count, revenue
    │
    ├─ Step 2: People Data Labs Owner Search
    │    └─ SQL query by company name + location
    │         └─ Returns: owner name, email, phone, LinkedIn
    │
    ├─ Step 3: Hunter.io Email Finder
    │    └─ Domain search for emails
    │         └─ Returns: emails, owner email, confidence
    │
    ├─ Step 4: Numverify Phone Validation
    │    └─ Validate phone number
    │         └─ Returns: validity, format, carrier, line type
    │
    ├─ Step 5: Yelp Verification
    │    └─ Match by name, address, phone
    │         └─ Returns: rating, reviews, categories, photos
    │
    ├─ Step 6: Claude AI Verification (Primary)
    │    └─ Comprehensive AI analysis
    │         └─ Returns: owner, industry, employee count, revenue, details
    │
    └─ Step 7: ChatGPT Verification (Secondary)
         └─ Supplementary AI analysis
              └─ Returns: owner, industry, employee count, revenue, details
                   │
                   └─ Merge All Data
                        └─ Return Enriched Lead (100% confidence if both AIs agree)
```

---

## Integration Points

### Google Places API
**Purpose**: Primary business data source  
**Authentication**: API Key  
**Rate Limits**: Based on API key tier  
**Key Endpoints**:
- Text Search: `/textsearch/json`
- Place Details: `/details/json`
- Find Place: `/findplacefromtext/json`

**Implementation Details**:
```javascript
// Auto-pagination support for up to 60 results (3 pages × 20)
const maxPages = 3;
for (let page = 1; page <= maxPages; page++) {
  const response = await axios.get(textSearchUrl, { params });
  results.push(...response.data.results);
  
  if (!response.data.next_page_token) break;
  await delay(2000); // Required delay for next page token
}
```

### Apollo.io API
**Purpose**: B2B company and people data  
**Authentication**: API Key (X-Api-Key header)  
**Key Endpoints**:
- Organizations Search: `/api/v1/mixed_companies/search`
- People Search: `/api/v1/mixed_people/search`
- Person Match: `/api/v1/people/match`

**Auto-Pagination**:
```javascript
const targetLeads = 100;
const leadsPerPage = 100;
const pagesNeeded = Math.ceil(targetLeads / leadsPerPage);

for (let page = 1; page <= pagesNeeded; page++) {
  const response = await axios.post(url, {
    ...filters,
    page,
    per_page: leadsPerPage
  });
  results.push(...response.data.organizations);
}
```

### People Data Labs (PDL)
**Purpose**: Find company owners/decision-makers  
**Authentication**: API Key (X-Api-Key header)  
**Key Endpoint**: `/v5/person/search`  
**Query Language**: SQL-like syntax

**Example Query**:
```sql
SELECT * FROM person 
WHERE job_company_name='Joe\'s Pizza'
  AND location_locality='New York'
  AND job_title_role IN ('owner', 'ceo', 'founder', 'president')
ORDER BY job_start_date DESC 
LIMIT 10
```

### Hunter.io
**Purpose**: Email discovery and verification  
**Authentication**: API Key (query parameter)  
**Key Endpoints**:
- Domain Search: `/v2/domain-search`
- Email Verifier: `/v2/email-verifier`

### Numverify
**Purpose**: Phone number validation  
**Authentication**: Access Key (query parameter)  
**Endpoint**: `/api/validate`

### Yelp Fusion API
**Purpose**: Business verification and additional data  
**Authentication**: Bearer Token  
**Key Endpoints**:
- Business Search: `/v3/businesses/search`
- Business Details: `/v3/businesses/{id}`
- Business Match: `/v3/businesses/matches`

### OpenAI GPT-4
**Purpose**: Primary AI verification  
**Model**: `gpt-4o`  
**Authentication**: API Key  
**Implementation**:
```javascript
const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "You are a business intelligence assistant..." },
    { role: "user", content: prompt }
  ],
  temperature: 0.7,
  max_tokens: 500
});
```

### Anthropic Claude
**Purpose**: Secondary AI verification  
**Model**: `claude-sonnet-4-20250514`  
**Authentication**: API Key  
**Implementation**:
```javascript
const message = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: prompt }]
});
```

---

## Database Schema

### Current Implementation
Currently uses **in-memory storage** (`scrapedLeads` array). This is suitable for:
- Development/testing
- Small datasets
- Temporary data

### Recommended Production Schema

#### Leads Table
```sql
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) NOT NULL,
  industry VARCHAR(100),
  owner_name VARCHAR(255),
  phone VARCHAR(50),
  phone_formatted VARCHAR(50),
  email VARCHAR(255),
  address TEXT,
  zipcode VARCHAR(20),
  city VARCHAR(100),
  state VARCHAR(50),
  country VARCHAR(100),
  website VARCHAR(255),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  rating DECIMAL(3, 2),
  review_count INTEGER,
  employee_count VARCHAR(50),
  revenue VARCHAR(50),
  business_details TEXT,
  verified BOOLEAN DEFAULT false,
  ai_confidence INTEGER,
  ai_source VARCHAR(100),
  source VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_company_name (company_name),
  INDEX idx_city (city),
  INDEX idx_industry (industry),
  INDEX idx_verified (verified)
);
```

#### Enrichment History Table
```sql
CREATE TABLE enrichment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id),
  service_name VARCHAR(50),
  request_data JSONB,
  response_data JSONB,
  success BOOLEAN,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_lead_id (lead_id),
  INDEX idx_service_name (service_name)
);
```

#### API Usage Tracking
```sql
CREATE TABLE api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name VARCHAR(50),
  endpoint VARCHAR(255),
  request_count INTEGER DEFAULT 1,
  date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(service_name, endpoint, date)
);
```

---

## Development Setup

### Prerequisites
- Node.js 18+ and npm
- Google Cloud CLI (for deployment)
- Git

### Environment Variables

#### Backend (.env)
```bash
PORT=5000

# Google APIs
GOOGLE_PLACES_API_KEY=your_google_api_key_here

# AI Services
OPENAI_API_KEY=sk-proj-your_openai_api_key_here
ANTHROPIC_API_KEY=sk-ant-your_anthropic_api_key_here

# Data Services
APOLLO_API_KEY=your_apollo_api_key_here
PDL_API_KEY=your_pdl_api_key_here
HUNTER_API_KEY=your_hunter_api_key_here
YELP_API_KEY=your_yelp_api_key_here
NUMVERIFY_API_KEY=your_numverify_api_key_here

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3000
```

#### Frontend (.env.local)
```bash
REACT_APP_API_URL=http://localhost:5000
```

### Installation

#### Backend
```bash
cd lead-scraper-backend
npm install
npm run dev  # Development mode with nodemon
npm start    # Production mode
```

#### Frontend
```bash
cd lead-scraper-pro
npm install
npm start    # Development mode (port 3000)
npm run build  # Production build
```

### Development Workflow

1. **Local Development**
   ```bash
   # Terminal 1 - Backend
   cd lead-scraper-backend
   npm run dev
   
   # Terminal 2 - Frontend
   cd lead-scraper-pro
   npm start
   ```

2. **Testing API Endpoints**
   ```bash
   # Health check
   curl http://localhost:5000/api/health
   
   # Test scraping
   curl -X POST http://localhost:5000/api/scrape \
     -H "Content-Type: application/json" \
     -d '{"query":"restaurants","location":"New York"}'
   ```

3. **Code Quality**
   ```bash
   # Lint check
   npm run lint
   
   # Run tests
   npm test
   ```

---

## Deployment Architecture

### Google Cloud Run Architecture

```
GitHub Repository
    │
    ├─ Push to main branch
    │
    └─ GitHub Actions Trigger
         │
         ├─ Build Docker Images
         │    ├─ lead-scraper-backend
         │    └─ lead-scraper-pro
         │
         ├─ Push to Artifact Registry
         │
         └─ Deploy to Cloud Run
              ├─ Backend Service
              │   └─ https://lead-scraper-backend-*.run.app
              │
              └─ Frontend Service
                  └─ https://lead-scraper-frontend-*.run.app
```

### Dockerfile - Backend
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 5000
CMD ["node", "server.js"]
```

### Dockerfile - Frontend
```dockerfile
FROM node:18-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
```

### Cloud Run Configuration

**Backend Service:**
- **CPU**: 1
- **Memory**: 2 GB
- **Min Instances**: 0
- **Max Instances**: 10
- **Timeout**: 300s
- **Port**: 5000

**Frontend Service:**
- **CPU**: 1
- **Memory**: 512 MB
- **Min Instances**: 0
- **Max Instances**: 5
- **Timeout**: 60s
- **Port**: 8080

### Environment Variables in Cloud Run
Set via Secret Manager or direct environment variables:
```bash
gcloud run services update lead-scraper-backend \
  --set-env-vars="GOOGLE_PLACES_API_KEY=key1" \
  --set-env-vars="OPENAI_API_KEY=key2"
```

### Deployment Commands
```bash
# Build and deploy backend
gcloud run deploy lead-scraper-backend \
  --source ./lead-scraper-backend \
  --region us-central1 \
  --allow-unauthenticated

# Build and deploy frontend
gcloud run deploy lead-scraper-frontend \
  --source ./lead-scraper-pro \
  --region us-central1 \
  --allow-unauthenticated
```

---

## Security Considerations

### API
