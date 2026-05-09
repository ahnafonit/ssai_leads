#!/usr/bin/env node

/**
 * Head-to-Head API Comparison Script
 *
 * Reads businesses from an Excel file, runs every configured API against each row,
 * and writes a side-by-side results Excel + console summary.
 *
 * INPUT Excel columns (all optional, use what you have):
 *   business | industry | location | phone | website | owner
 *
 * Usage:
 *   node api-comparison.js --input test-businesses.xlsx
 *   node api-comparison.js --input test-businesses.xlsx --skip numverify,openai
 *   node api-comparison.js --input test-businesses.xlsx --only google,yelp
 *   node api-comparison.js --input test-businesses.xlsx --output my-results.xlsx
 *   node api-comparison.js --generate-sample            # creates a sample input file
 */

const path = require('path');
const XLSX = require('xlsx');
const axios = require('axios');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

// ─── CLI Argument Parsing ───────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2);
            const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
            parsed[key] = val;
            if (val !== true) i++;
        }
    }
    return parsed;
}

const args = parseArgs();

if (args.help) {
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║              API Head-to-Head Comparison Script                 ║
╚══════════════════════════════════════════════════════════════════╝

Usage:
  node api-comparison.js --input <file.xlsx>  [options]
  node api-comparison.js --generate-sample

Options:
  --input             Path to input Excel file (required unless --generate-sample)
  --output            Path for output Excel file (default: api-comparison-results.xlsx)
  --skip              Comma-separated APIs to skip (e.g. "numverify,yelp")
  --only              Comma-separated APIs to run (e.g. "google,apollo")
  --max               Max leads for search APIs per row (default: 3)
  --generate-sample   Create a sample input Excel file and exit

Input Excel columns (header row required, all optional):
  business   - Company name (e.g. "Joe's Pizza")
  industry   - Industry/category (e.g. "restaurants")
  location   - City/region (e.g. "New York, NY")
  phone      - Phone number (e.g. "+12125551234")
  website    - Website domain (e.g. "joespizza.com")
  owner      - Known owner name (for comparison / ground truth)

Examples:
  node api-comparison.js --generate-sample
  node api-comparison.js --input test-businesses.xlsx
  node api-comparison.js --input test-businesses.xlsx --only google,yelp --max 3
  node api-comparison.js --input test-businesses.xlsx --skip openai,anthropic
`);
    process.exit(0);
}

// ─── Sample File Generator ──────────────────────────────────────────────────

if (args['generate-sample']) {
    const sampleData = [
        { business: 'Starbucks',              industry: 'Coffee Shop',  location: 'Seattle, WA',      phone: '+12062821700', website: 'starbucks.com',        owner: 'Laxman Narasimhan' },
        { business: "Joe's Pizza",            industry: 'Restaurant',   location: 'New York, NY',     phone: '+12123661182', website: 'joespizzanyc.com',      owner: '' },
        { business: 'Walmart',                industry: 'Retail',       location: 'Bentonville, AR',  phone: '+14792734000', website: 'walmart.com',           owner: 'Doug McMillon' },
        { business: "Bob's Discount Furniture",industry: 'Furniture',   location: 'Manchester, CT',   phone: '+18607454851', website: 'mybobs.com',            owner: '' },
        { business: 'Sweetgreen',             industry: 'Restaurant',   location: 'Los Angeles, CA',  phone: '',             website: 'sweetgreen.com',        owner: 'Jonathan Neman' },
        { business: '',                       industry: 'dentists',     location: 'Chicago, IL',      phone: '',             website: '',                      owner: '' },
        { business: '',                       industry: 'plumbers',     location: 'Houston, TX',      phone: '',             website: '',                      owner: '' },
    ];

    const ws = XLSX.utils.json_to_sheet(sampleData);
    const colWidths = [
        { wch: 28 }, // business
        { wch: 15 }, // industry
        { wch: 20 }, // location
        { wch: 16 }, // phone
        { wch: 22 }, // website
        { wch: 20 }, // owner
    ];
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Test Businesses');

    const outPath = 'test-businesses.xlsx';
    XLSX.writeFile(wb, outPath);
    console.log(`\n  ✓ Sample input file created: ${outPath}`);
    console.log(`  Edit it with your own businesses, then run:`);
    console.log(`    node api-comparison.js --input ${outPath}\n`);
    process.exit(0);
}

// ─── Config ─────────────────────────────────────────────────────────────────

const API_KEYS = {
    google:    process.env.GOOGLE_PLACES_API_KEY,
    googleNew: process.env.GOOGLE_PLACES_NEW_API_KEY || process.env.GOOGLE_PLACES_API_KEY,
    openai:    process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    apollo:    process.env.APOLLO_API_KEY,
    pdl:       process.env.PDL_API_KEY,
    hunter:    process.env.HUNTER_API_KEY,
    numverify: process.env.NUMVERIFY_API_KEY,
    yelp:      process.env.YELP_API_KEY,
};

const skipSet = new Set((args.skip || '').split(',').filter(Boolean).map(s => s.toLowerCase()));
const onlySet = new Set((args.only || '').split(',').filter(Boolean).map(s => s.toLowerCase()));

function shouldRun(apiName) {
    if (onlySet.size > 0) return onlySet.has(apiName.toLowerCase());
    return !skipSet.has(apiName.toLowerCase());
}

function hasKey(apiName) {
    const key = API_KEYS[apiName];
    return key && !key.includes('your_') && key.length > 5;
}

const MAX_LEADS = parseInt(args.max) || 3;

// ─── Formatting Helpers (console) ───────────────────────────────────────────

const COLORS = {
    reset: '\x1b[0m', bright: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', cyan: '\x1b[36m',
};
function c(color, text) { return `${COLORS[color]}${text}${COLORS.reset}`; }

function divider(char = '─', len = 90) { console.log(c('dim', char.repeat(len))); }

// ─── Timer Wrapper ──────────────────────────────────────────────────────────

async function timed(fn) {
    const start = Date.now();
    try {
        const result = await fn();
        return { status: 'success', data: result, ms: Date.now() - start, error: null };
    } catch (err) {
        return { status: 'error', data: null, ms: Date.now() - start, error: err.message || String(err) };
    }
}

// ─── API Callers ────────────────────────────────────────────────────────────
// Each returns a standardised shape or array of shapes

async function callGooglePlacesLegacy(query, location, maxLeads) {
    const apiKey = API_KEYS.google;
    const textResp = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
        params: { query: `${query} in ${location}`, key: apiKey }
    });
    if (textResp.data.status !== 'OK') throw new Error(`Google: ${textResp.data.status}`);

    const results = [];
    for (const place of textResp.data.results.slice(0, maxLeads)) {
        const d = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
            params: {
                place_id: place.place_id,
                fields: 'name,formatted_address,formatted_phone_number,international_phone_number,website,rating,user_ratings_total,types,address_components',
                key: apiKey
            }
        });
        if (d.data.status === 'OK') {
            const r = d.data.result;
            results.push({
                companyName: r.name || '', phone: r.formatted_phone_number || r.international_phone_number || '',
                address: r.formatted_address || '', website: r.website || '',
                rating: r.rating || '', reviewCount: r.user_ratings_total || 0,
                types: (r.types || []).slice(0, 3).join(', '),
            });
        }
    }
    return results;
}

async function callGooglePlacesNew(query, location, maxLeads) {
    const apiKey = API_KEYS.googleNew;
    const resp = await axios.post('https://places.googleapis.com/v1/places:searchText', {
        textQuery: `${query} in ${location}`, pageSize: Math.min(maxLeads, 20),
    }, {
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.types'
        }
    });
    return (resp.data.places || []).map(p => ({
        companyName: p.displayName?.text || '', phone: p.nationalPhoneNumber || p.internationalPhoneNumber || '',
        address: p.formattedAddress || '', website: p.websiteUri || '',
        rating: p.rating || '', reviewCount: p.userRatingCount || 0,
        types: (p.types || []).slice(0, 3).join(', '),
    }));
}

async function callApolloOrgSearch(query, location) {
    const resp = await axios.post('https://api.apollo.io/api/v1/mixed_companies/search', {
        q_organization_keyword_tags: [query], organization_locations: [location], page: 1, per_page: 5,
    }, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': API_KEYS.apollo } });

    return (resp.data.organizations || []).map(org => ({
        companyName: org.name || '', phone: org.phone || org.primary_phone?.number || '',
        address: org.raw_address || '', website: org.website_url || '',
        industry: org.industry || '', employeeCount: org.estimated_num_employees || '',
        revenue: org.annual_revenue_printed || '', linkedinUrl: org.linkedin_url || '',
    }));
}

async function callApolloEnrich(business, website, extras = {}) {
    const body = { organization_name: business };
    if (website) body.domain = website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (extras.email) body.email = extras.email;
    if (extras.firstName) body.first_name = extras.firstName;
    if (extras.lastName) body.last_name = extras.lastName;
    if (extras.linkedinUrl) body.linkedin_url = extras.linkedinUrl;

    const resp = await axios.post('https://api.apollo.io/api/v1/people/match', body, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': API_KEYS.apollo }
    });
    const p = resp.data.person;
    if (!p) return null;
    return {
        ownerName: p.name || '', title: p.title || '', email: p.email || '',
        emailStatus: p.email_status || '', phone: p.sanitized_phone || '',
        company: p.organization?.name || '', industry: p.organization?.industry || '',
        linkedinUrl: p.linkedin_url || '', seniority: p.seniority || '',
    };
}

async function callPDL(business, city) {
    let sql = `SELECT * FROM person WHERE job_company_name LIKE '%${business.replace(/'/g, "''")}%'`;
    if (city) sql += ` AND location_locality LIKE '%${city.replace(/'/g, "''")}%'`;
    sql += ` AND (job_title LIKE '%CEO%' OR job_title LIKE '%Owner%' OR job_title LIKE '%Founder%' OR job_title LIKE '%President%')`;

    try {
        const resp = await axios.get('https://api.peopledatalabs.com/v5/person/search', {
            params: { sql, size: 5, dataset: 'all' },
            headers: { 'X-Api-Key': API_KEYS.pdl, 'Content-Type': 'application/json' }
        });
        return (resp.data.data || []).map(p => ({
            ownerName: p.full_name || '', title: p.job_title || '', email: p.emails?.[0]?.address || '',
            phone: p.phone_numbers?.[0] || '', linkedinUrl: p.linkedin_url || '',
            company: p.job_company_name || '', companyIndustry: p.job_company_industry || '',
        }));
    } catch (err) {
        const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        throw new Error(`PDL ${err.response?.status}: ${detail}`);
    }
}

async function callHunter(domain) {
    const resp = await axios.get('https://api.hunter.io/v2/domain-search', {
        params: { domain, api_key: API_KEYS.hunter, limit: 5 }
    });
    const d = resp.data.data;
    if (!d?.emails?.length) return null;
    return {
        organization: d.organization || '', domain: d.domain,
        emails: d.emails.map(e => ({
            email: e.value, name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
            position: e.position || '', confidence: e.confidence,
        })),
    };
}

async function callNumverify(phone) {
    let clean = phone.replace(/[\s\-\(\)]/g, '');
    if (clean.startsWith('+')) clean = clean.substring(1);
    const resp = await axios.get('http://apilayer.net/api/validate', {
        params: { access_key: API_KEYS.numverify, number: clean, format: 1 }
    });
    const d = resp.data;
    return {
        valid: d.valid, number: d.number, localFormat: d.local_format || '',
        internationalFormat: d.international_format || '', countryName: d.country_name || '',
        location: d.location || '', carrier: d.carrier || '', lineType: d.line_type || '',
    };
}

async function callYelpSearch(query, location) {
    const resp = await axios.get('https://api.yelp.com/v3/businesses/search', {
        headers: { 'Authorization': `Bearer ${API_KEYS.yelp}` },
        params: { term: query, location, limit: 5 }
    });
    return (resp.data.businesses || []).map(b => ({
        companyName: b.name || '', phone: b.display_phone || b.phone || '',
        address: b.location?.display_address?.join(', ') || '',
        rating: b.rating || '', reviewCount: b.review_count || 0,
        price: b.price || '', categories: b.categories?.map(ct => ct.title).join(', ') || '',
    }));
}

async function callYelpMatch(business, city, state, phone) {
    const params = { name: business, country: 'US' };
    if (city) params.city = city;
    if (state) params.state = state;
    if (phone) params.phone = phone.replace(/[^\d+]/g, '');

    const resp = await axios.get('https://api.yelp.com/v3/businesses/matches', {
        headers: { 'Authorization': `Bearer ${API_KEYS.yelp}` }, params
    });
    if (!resp.data.businesses?.length) return null;
    const match = resp.data.businesses[0];
    const details = await axios.get(`https://api.yelp.com/v3/businesses/${match.id}`, {
        headers: { 'Authorization': `Bearer ${API_KEYS.yelp}` }
    });
    const b = details.data;
    return {
        matched: true, companyName: b.name || '', phone: b.display_phone || b.phone || '',
        address: b.location?.display_address?.join(', ') || '',
        rating: b.rating || '', reviewCount: b.review_count || 0,
        price: b.price || '', categories: b.categories?.map(ct => ct.title).join(', ') || '',
    };
}

async function callChatGPT(business, location, industry) {
    const openai = new OpenAI({ apiKey: API_KEYS.openai });
    const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            { role: "system", content: "You are a business intelligence assistant. Return ONLY valid JSON, no markdown." },
            { role: "user", content: `Find the owner/CEO of this business. Return JSON: {ownerName, title, industry, employeeCount, revenue, confidence (0-100), reasoning}\n\nBusiness: ${business}\nLocation: ${location}\nIndustry: ${industry || 'Unknown'}` }
        ],
        temperature: 0.3, max_tokens: 500
    });
    let text = completion.choices[0].message.content;
    const m = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || text.match(/\{[\s\S]*\}/);
    if (m) text = m[1] || m[0];
    const parsed = JSON.parse(text);
    parsed.model = 'gpt-4o';
    parsed.tokensUsed = completion.usage?.total_tokens || '';
    return parsed;
}

async function callClaude(business, location, industry) {
    const anthropic = new Anthropic({ apiKey: API_KEYS.anthropic });
    const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514", max_tokens: 500,
        messages: [{ role: "user", content: `You are a business intelligence assistant. Find the owner/CEO of this business. Return ONLY valid JSON: {ownerName, title, industry, employeeCount, revenue, confidence (0-100), reasoning}\n\nBusiness: ${business}\nLocation: ${location}\nIndustry: ${industry || 'Unknown'}` }]
    });
    let text = message.content[0].text;
    const m = text.match(/\{[\s\S]*\}/);
    if (m) text = m[0];
    const parsed = JSON.parse(text);
    parsed.model = 'claude-sonnet-4-20250514';
    parsed.tokensUsed = (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0);
    return parsed;
}

// ─── Extract helpers for normalising API results into a flat row ─────────

function firstItem(data) {
    if (!data) return null;
    return Array.isArray(data) ? data[0] || null : data;
}

function extractOwner(data) {
    const d = firstItem(data);
    if (!d) return '';
    return d.ownerName || d.emails?.[0]?.name || '';
}
function extractEmail(data) {
    const d = firstItem(data);
    if (!d) return '';
    return d.email || d.primaryEmail || d.emails?.[0]?.email || '';
}
function extractPhone(data) {
    const d = firstItem(data);
    if (!d) return '';
    return d.phone || d.internationalFormat || '';
}
function extractCompany(data) {
    const d = firstItem(data);
    if (!d) return '';
    return d.companyName || d.company || d.organization || '';
}
function extractAddress(data) {
    const d = firstItem(data);
    if (!d) return '';
    return d.address || '';
}
function resultCount(data) {
    if (!data) return 0;
    if (Array.isArray(data)) return data.length;
    return 1;
}

// ─── Per-row runner ─────────────────────────────────────────────────────────

async function processRow(row, rowIndex, totalRows) {
    const business = (row.business || '').trim();
    const industry = (row.industry || '').trim();
    const location = (row.location || '').trim();
    const phone    = (row.phone || '').toString().trim();
    const website  = (row.website || '').trim();
    const owner    = (row.owner || '').trim();

    const searchQuery = business || industry;
    const city  = location.split(',')[0]?.trim() || '';
    const state = location.split(',')[1]?.trim() || '';

    console.log('');
    divider('═');
    console.log(c('bright', `  Row ${rowIndex + 1}/${totalRows}: ${searchQuery || phone || website}  —  ${location}`));
    divider('═');

    const rowResults = {
        input_business: business, input_industry: industry, input_location: location,
        input_phone: phone, input_website: website, input_owner_truth: owner,
    };

    // ── Search APIs ──────────────────────────────────────────────────────
    if (searchQuery && location) {
        if (shouldRun('google') && hasKey('google')) {
            process.stdout.write(`  Google Legacy...`);
            const r = await timed(() => callGooglePlacesLegacy(searchQuery, location, MAX_LEADS));
            rowResults.google_legacy_status   = r.status;
            rowResults.google_legacy_ms       = r.ms;
            rowResults.google_legacy_count    = resultCount(r.data);
            rowResults.google_legacy_top_name = extractCompany(r.data);
            rowResults.google_legacy_top_phone= extractPhone(r.data);
            rowResults.google_legacy_top_addr = extractAddress(r.data);
            rowResults.google_legacy_error    = r.error || '';
            console.log(` ${r.status === 'success' ? c('green', `OK (${resultCount(r.data)} results, ${r.ms}ms)`) : c('red', r.error)}`);
        }

        if (shouldRun('google') && hasKey('googleNew')) {
            process.stdout.write(`  Google New...`);
            const r = await timed(() => callGooglePlacesNew(searchQuery, location, MAX_LEADS));
            rowResults.google_new_status   = r.status;
            rowResults.google_new_ms       = r.ms;
            rowResults.google_new_count    = resultCount(r.data);
            rowResults.google_new_top_name = extractCompany(r.data);
            rowResults.google_new_top_phone= extractPhone(r.data);
            rowResults.google_new_top_addr = extractAddress(r.data);
            rowResults.google_new_error    = r.error || '';
            console.log(` ${r.status === 'success' ? c('green', `OK (${resultCount(r.data)} results, ${r.ms}ms)`) : c('red', r.error)}`);
        }

        if (shouldRun('apollo') && hasKey('apollo')) {
            process.stdout.write(`  Apollo Orgs...`);
            const r = await timed(() => callApolloOrgSearch(searchQuery, location));
            rowResults.apollo_org_status   = r.status;
            rowResults.apollo_org_ms       = r.ms;
            rowResults.apollo_org_count    = resultCount(r.data);
            rowResults.apollo_org_top_name = extractCompany(r.data);
            rowResults.apollo_org_top_phone= extractPhone(r.data);
            rowResults.apollo_org_error    = r.error || '';
            console.log(` ${r.status === 'success' ? c('green', `OK (${resultCount(r.data)} results, ${r.ms}ms)`) : c('red', r.error)}`);
        }

        if (shouldRun('yelp') && hasKey('yelp')) {
            process.stdout.write(`  Yelp Search...`);
            const r = await timed(() => callYelpSearch(searchQuery, location));
            rowResults.yelp_search_status   = r.status;
            rowResults.yelp_search_ms       = r.ms;
            rowResults.yelp_search_count    = resultCount(r.data);
            rowResults.yelp_search_top_name = extractCompany(r.data);
            rowResults.yelp_search_top_phone= extractPhone(r.data);
            rowResults.yelp_search_error    = r.error || '';
            console.log(` ${r.status === 'success' ? c('green', `OK (${resultCount(r.data)} results, ${r.ms}ms)`) : c('red', r.error)}`);
        }
    }

    // ── Enrichment APIs ──────────────────────────────────────────────────
    // Run Hunter FIRST so we can feed its output into Apollo Enrich
    let hunterData = null;

    if (business) {
        if (shouldRun('hunter') && hasKey('hunter') && website) {
            process.stdout.write(`  Hunter.io...`);
            const domain = website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
            const r = await timed(() => callHunter(domain));
            hunterData = r.data;
            rowResults.hunter_status = r.status;
            rowResults.hunter_ms     = r.ms;
            rowResults.hunter_owner  = extractOwner(r.data);
            rowResults.hunter_email  = extractEmail(r.data);
            rowResults.hunter_org    = firstItem(r.data)?.organization || '';
            rowResults.hunter_error  = r.error || '';
            console.log(` ${r.status === 'success' ? c('green', `OK (${r.data?.emails?.length || 0} emails, ${r.ms}ms)`) : c('red', r.error)}`);
        } else if (shouldRun('hunter') && hasKey('hunter') && !website) {
            console.log(c('dim', `  Hunter.io... SKIPPED (no website)`));
        }

        // Apollo Enrich COLD — just company name + domain (how it runs today)
        if (shouldRun('apollo') && hasKey('apollo')) {
            process.stdout.write(`  Apollo Enrich (cold)...`);
            const r = await timed(() => callApolloEnrich(business, website));
            rowResults.apollo_cold_status = r.status;
            rowResults.apollo_cold_ms     = r.ms;
            rowResults.apollo_cold_owner  = extractOwner(r.data);
            rowResults.apollo_cold_email  = extractEmail(r.data);
            rowResults.apollo_cold_title  = firstItem(r.data)?.title || '';
            rowResults.apollo_cold_error  = r.error || '';
            console.log(` ${r.status === 'success' ? c('green', `OK (${extractOwner(r.data) || 'no match'}, ${r.ms}ms)`) : c('red', r.error)}`);
        }

        // Apollo Enrich WARM — fed with Hunter email + name (proposed fix)
        if (shouldRun('apollo') && hasKey('apollo') && hunterData?.emails?.length) {
            const bestEmail = hunterData.emails[0];
            const nameParts = (bestEmail.name || '').split(' ');
            const extras = {
                email: bestEmail.email,
                firstName: nameParts[0] || '',
                lastName: nameParts.slice(1).join(' ') || '',
            };
            process.stdout.write(`  Apollo Enrich (warm, +Hunter)...`);
            const r = await timed(() => callApolloEnrich(business, website, extras));
            rowResults.apollo_warm_status = r.status;
            rowResults.apollo_warm_ms     = r.ms;
            rowResults.apollo_warm_owner  = extractOwner(r.data);
            rowResults.apollo_warm_email  = extractEmail(r.data);
            rowResults.apollo_warm_title  = firstItem(r.data)?.title || '';
            rowResults.apollo_warm_error  = r.error || '';
            console.log(` ${r.status === 'success' ? c('green', `OK (${extractOwner(r.data) || 'no match'}, ${r.ms}ms)`) : c('red', r.error)}`);
        } else if (shouldRun('apollo') && hasKey('apollo') && !hunterData?.emails?.length) {
            rowResults.apollo_warm_status = 'skipped';
            rowResults.apollo_warm_owner  = '';
            rowResults.apollo_warm_email  = '';
            console.log(c('dim', `  Apollo Enrich (warm)... SKIPPED (Hunter had no emails to feed)`));
        }

        if (shouldRun('pdl') && hasKey('pdl')) {
            process.stdout.write(`  PDL...`);
            const r = await timed(() => callPDL(business, city));
            rowResults.pdl_status = r.status;
            rowResults.pdl_ms     = r.ms;
            rowResults.pdl_count  = resultCount(r.data);
            rowResults.pdl_owner  = extractOwner(r.data);
            rowResults.pdl_email  = extractEmail(r.data);
            rowResults.pdl_title  = firstItem(r.data)?.title || '';
            rowResults.pdl_error  = r.error || '';
            console.log(` ${r.status === 'success' ? c('green', `OK (${resultCount(r.data)} people, ${r.ms}ms)`) : c('red', r.error)}`);
        }

        if (shouldRun('openai') && hasKey('openai')) {
            process.stdout.write(`  ChatGPT...`);
            const r = await timed(() => callChatGPT(business, location, industry));
            rowResults.chatgpt_status     = r.status;
            rowResults.chatgpt_ms         = r.ms;
            rowResults.chatgpt_owner      = r.data?.ownerName || '';
            rowResults.chatgpt_title      = r.data?.title || '';
            rowResults.chatgpt_confidence = r.data?.confidence || '';
            rowResults.chatgpt_reasoning  = r.data?.reasoning || '';
            rowResults.chatgpt_tokens     = r.data?.tokensUsed || '';
            rowResults.chatgpt_error      = r.error || '';
            console.log(` ${r.status === 'success' ? c('green', `OK ("${r.data?.ownerName}", conf:${r.data?.confidence}%, ${r.ms}ms)`) : c('red', r.error)}`);
        }

        if (shouldRun('anthropic') && hasKey('anthropic')) {
            process.stdout.write(`  Claude...`);
            const r = await timed(() => callClaude(business, location, industry));
            rowResults.claude_status     = r.status;
            rowResults.claude_ms         = r.ms;
            rowResults.claude_owner      = r.data?.ownerName || '';
            rowResults.claude_title      = r.data?.title || '';
            rowResults.claude_confidence = r.data?.confidence || '';
            rowResults.claude_reasoning  = r.data?.reasoning || '';
            rowResults.claude_tokens     = r.data?.tokensUsed || '';
            rowResults.claude_error      = r.error || '';
            console.log(` ${r.status === 'success' ? c('green', `OK ("${r.data?.ownerName}", conf:${r.data?.confidence}%, ${r.ms}ms)`) : c('red', r.error)}`);
        }
    }

    // ── Verification APIs ────────────────────────────────────────────────
    if (phone && shouldRun('numverify') && hasKey('numverify')) {
        process.stdout.write(`  Numverify...`);
        const r = await timed(() => callNumverify(phone));
        rowResults.numverify_status   = r.status;
        rowResults.numverify_ms       = r.ms;
        rowResults.numverify_valid    = r.data?.valid ?? '';
        rowResults.numverify_carrier  = r.data?.carrier || '';
        rowResults.numverify_lineType = r.data?.lineType || '';
        rowResults.numverify_country  = r.data?.countryName || '';
        rowResults.numverify_error    = r.error || '';
        console.log(` ${r.status === 'success' ? c('green', `OK (valid:${r.data?.valid}, ${r.data?.lineType}, ${r.ms}ms)`) : c('red', r.error)}`);
    }

    if (business && shouldRun('yelp') && hasKey('yelp')) {
        process.stdout.write(`  Yelp Match...`);
        const r = await timed(() => callYelpMatch(business, city, state, phone));
        rowResults.yelp_match_status = r.status;
        rowResults.yelp_match_ms     = r.ms;
        rowResults.yelp_match_found  = r.data?.matched ? 'YES' : 'NO';
        rowResults.yelp_match_name   = r.data?.companyName || '';
        rowResults.yelp_match_rating = r.data?.rating || '';
        rowResults.yelp_match_error  = r.error || '';
        console.log(` ${r.status === 'success' ? c('green', `OK (matched:${r.data?.matched ? 'YES' : 'NO'}, ${r.ms}ms)`) : c('red', r.error)}`);
    }

    return rowResults;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const inputFile = args.input;
    if (!inputFile) {
        console.error('\n  Error: --input <file.xlsx> is required. Run with --help for usage.\n');
        process.exit(1);
    }

    const inputPath = path.resolve(inputFile);
    console.log('');
    console.log(c('bright', '╔══════════════════════════════════════════════════════════════════╗'));
    console.log(c('bright', '║           API HEAD-TO-HEAD COMPARISON (Excel Mode)               ║'));
    console.log(c('bright', '╚══════════════════════════════════════════════════════════════════╝'));

    // Read input
    const wb = XLSX.readFile(inputPath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);

    console.log(`\n  Input file:  ${inputPath}`);
    console.log(`  Rows found:  ${rows.length}`);
    console.log(`  Max leads:   ${MAX_LEADS}`);

    // Show API key status
    console.log('\n  API Keys:');
    for (const [name, _] of Object.entries(API_KEYS)) {
        const ok = hasKey(name);
        const run = shouldRun(name);
        let badge;
        if (!ok) badge = c('red', '✗ Missing');
        else if (!run) badge = c('yellow', '○ Skipped');
        else badge = c('green', '✓ Ready');
        console.log(`    ${name.padEnd(12)} ${badge}`);
    }

    // Process each row
    const allResults = [];
    for (let i = 0; i < rows.length; i++) {
        const rowResult = await processRow(rows[i], i, rows.length);
        allResults.push(rowResult);
    }

    // ── Write output Excel ───────────────────────────────────────────────
    const outputFile = args.output || 'api-comparison-results.xlsx';
    const outputPath = path.resolve(outputFile);

    const outWs = XLSX.utils.json_to_sheet(allResults);
    const outWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(outWb, outWs, 'Results');

    // Also create a summary sheet
    const summaryRows = buildSummary(allResults);
    const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(outWb, summaryWs, 'Summary');

    XLSX.writeFile(outWb, outputPath);

    // ── Console summary ──────────────────────────────────────────────────
    console.log('');
    divider('═');
    console.log(c('bright', '  AGGREGATE SUMMARY'));
    divider('═');

    for (const s of summaryRows) {
        const statusColor = s.success_rate === '100%' ? 'green' : s.success_rate === '0%' ? 'red' : 'yellow';
        console.log(
            `  ${s.api.padEnd(20)} ` +
            `${c(statusColor, s.success_rate.padEnd(8))} ` +
            `avg ${String(s.avg_ms + 'ms').padEnd(8)} ` +
            `${s.rows_run} rows  ` +
            `${s.note}`
        );
    }

    console.log('');
    console.log(c('green', `  ✓ Results written to: ${outputPath}`));
    console.log(c('dim', `    Sheet 1 "Results"  — one row per input business, all API outputs side-by-side`));
    console.log(c('dim', `    Sheet 2 "Summary"  — aggregate stats per API`));
    console.log('');
}

// ─── Summary builder ────────────────────────────────────────────────────────

function buildSummary(allResults) {
    const apis = [
        { key: 'google_legacy', label: 'Google Places (Legacy)', type: 'search' },
        { key: 'google_new',    label: 'Google Places (New)',    type: 'search' },
        { key: 'apollo_org',    label: 'Apollo Org Search',      type: 'search' },
        { key: 'yelp_search',   label: 'Yelp Search',            type: 'search' },
        { key: 'apollo_cold',   label: 'Apollo Enrich (cold)',    type: 'enrich' },
        { key: 'apollo_warm',   label: 'Apollo Enrich (+Hunter)', type: 'enrich' },
        { key: 'pdl',           label: 'People Data Labs',       type: 'enrich' },
        { key: 'hunter',        label: 'Hunter.io',              type: 'enrich' },
        { key: 'chatgpt',       label: 'ChatGPT (gpt-4o)',       type: 'ai' },
        { key: 'claude',        label: 'Claude (Sonnet)',         type: 'ai' },
        { key: 'numverify',     label: 'Numverify',              type: 'verify' },
        { key: 'yelp_match',    label: 'Yelp Match',             type: 'verify' },
    ];

    return apis.map(api => {
        const statusKey = `${api.key}_status`;
        const msKey = `${api.key}_ms`;
        const ran = allResults.filter(r => r[statusKey]);
        const successes = ran.filter(r => r[statusKey] === 'success');
        const avgMs = ran.length > 0
            ? Math.round(ran.reduce((sum, r) => sum + (r[msKey] || 0), 0) / ran.length)
            : 0;

        let note = '';
        if (api.type === 'search') {
            const countKey = `${api.key}_count`;
            const totalResults = successes.reduce((sum, r) => sum + (r[countKey] || 0), 0);
            note = `${totalResults} total results found`;
        } else if (api.type === 'enrich' || api.type === 'ai') {
            const ownerKey = `${api.key}_owner`;
            const withOwner = successes.filter(r => r[ownerKey] && r[ownerKey].length > 0).length;
            note = `${withOwner}/${successes.length} returned an owner name`;
        } else if (api.key === 'numverify') {
            const validCount = successes.filter(r => r.numverify_valid === true).length;
            note = `${validCount}/${successes.length} phones valid`;
        } else if (api.key === 'yelp_match') {
            const matched = successes.filter(r => r.yelp_match_found === 'YES').length;
            note = `${matched}/${successes.length} businesses matched`;
        }

        return {
            api: api.label,
            type: api.type,
            rows_run: ran.length,
            successes: successes.length,
            failures: ran.length - successes.length,
            success_rate: ran.length > 0 ? Math.round((successes.length / ran.length) * 100) + '%' : 'N/A',
            avg_ms: avgMs,
            note,
        };
    });
}

// ─── Run ────────────────────────────────────────────────────────────────────

main().catch(err => {
    console.error(c('red', `\nFatal error: ${err.message}`));
    console.error(err.stack);
    process.exit(1);
});
