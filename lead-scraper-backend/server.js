/**
 * Thin HTTP shell: Phase 1 pipeline uses modular providers under ./src/.
 */

'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config({ override: true });

const {
    scrapeGoogleMaps,
    reverseGeocode,
    calculateAreaCenter,
    delay,
    convertPlaceDetailsToLead
} = require('./src/services/googlePlaces');

const { enrichLead, enrichLeadBatch, hasStrongOwner } = require('./src/services/enrichmentOrchestrator');
const { findCompanyOwnerWithPDL } = require('./src/providers/pdlPersonSearch');
const { pingOpenAI, pingAnthropic } = require('./src/providers/aiStrictOwner');
const { registerLegacyRoutes } = require('./legacy-integrations');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const enrichmentClients = { openai, anthropic };

const app = express();
const PORT = process.env.PORT || 5000;

let scrapedLeads = [];

app.use(helmet());
app.use(cors({
    origin: function(origin, callback) {
        const allowed = [
            'http://localhost:3005',
            'https://lead-scraper-frontend-372172131227.us-central1.run.app',
            process.env.FRONTEND_URL
        ].filter(Boolean);

        if (!origin || allowed.includes(origin) || origin.endsWith('.run.app')) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    },
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use('/api/', limiter);

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.post('/api/scrape', async (req, res) => {
    try {
        const {
            query,
            location,
            zipcode,
            country,
            maxLeads,
            enrichContacts,
            enrichWithApollo,
            useApolloSearch,
            enrichmentOptions: bodyEnrichmentOptions
        } = req.body;

        if (!query || !location) {
            return res.status(400).json({
                error: 'Both query and location are required'
            });
        }

        const ignoredFlags = [];

        if (useApolloSearch) {
            ignoredFlags.push('useApolloSearch');
            console.warn('[Phase1] Ignored useApolloSearch — discovery is Google Places only.');
        }

        console.log(`[Scrape] ${query} @ ${location}`);

        const results = await scrapeGoogleMaps(query, location, null, zipcode, country, maxLeads || 60);

        const enrichContactFlag = enrichContacts ?? enrichWithApollo ?? false;

        let enrichedResults = results;

        if (enrichContactFlag) {
            enrichedResults = await enrichLeadBatch(
                results,
                bodyEnrichmentOptions || {},
                enrichmentClients,
                { includeAI: false }
            );
        }

        res.json({
            success: true,
            results: enrichedResults,
            count: enrichedResults.length,
            searchSource: 'Google Places',
            phase1DiscoveryOnly: true,
            ignoredFlags,
            enrichmentRan: enrichContactFlag,
            enrichmentApplied: enrichContactFlag ? enrichedResults.map(r => r.enrichmentConfigApplied).filter(Boolean)[0] || null : null,
            deprecations: enrichWithApollo && !enrichContacts
                ? ['enrichWithApollo is deprecated; use enrichContacts for Hunter+PDL (no bulk AI).']
                : [],
            query,
            location,
            zipcode: zipcode || null,
            country: country || null,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Scrape error:', error);
        res.status(500).json({
            error: 'Failed to scrape data',
            message: error.message
        });
    }
});

app.post('/api/scrape-area', async (req, res) => {
    try {
        const {
            query,
            area,
            zipcode,
            country,
            maxLeads,
            enrichContacts,
            enrichWithApollo,
            useApolloSearch,
            enrichmentOptions: bodyEnrichmentOptions
        } = req.body;

        if (!query || !area) {
            return res.status(400).json({
                error: 'Both query and area are required'
            });
        }

        const ignoredFlags = [];

        if (useApolloSearch) ignoredFlags.push('useApolloSearch');

        const enrichContactFlag = enrichContacts ?? enrichWithApollo ?? false;

        let allResults = [];

        let detectedLocations = [];

        async function finalizeAndSend(uniqueSlice, polygonsSearched, totalBeforeDedup) {

            let enrichedResults = uniqueSlice;

            if (enrichContactFlag) {
                enrichedResults = await enrichLeadBatch(
                    uniqueSlice,
                    bodyEnrichmentOptions || {},
                    enrichmentClients,
                    { includeAI: false }
                );
            }

            res.json({
                success: true,
                results: enrichedResults,
                count: enrichedResults.length,
                searchSource: 'Google Places',
                phase1DiscoveryOnly: true,
                ignoredFlags,
                enrichmentRan: enrichContactFlag,
                query,
                area,
                detectedLocations,
                polygonsSearched,
                totalResultsBeforeDedup: totalBeforeDedup,
                zipcode: zipcode || null,
                country: country || null,
                timestamp: new Date().toISOString()
            });
        }

        if (area.type === 'multipolygon' && area.polygons && area.polygons.length > 0) {
            const leadsPerPolygon = Math.ceil((maxLeads * 1.5) / area.polygons.length);

            for (let i = 0; i < area.polygons.length; i++) {
                const polygon = area.polygons[i];
                const singlePolygonArea = {
                    type: 'polygon',
                    coordinates: polygon
                };

                const center = calculateAreaCenter(singlePolygonArea);

                if (!center || center.lat == null || center.lng == null) {
                    continue;
                }

                let location = await reverseGeocode(center.lat, center.lng);
                if (location) detectedLocations.push(location);

                if (!location) {
                    location = `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
                }

                const polygonResults = await scrapeGoogleMaps(
                    query,
                    location,
                    singlePolygonArea,
                    zipcode,
                    country,
                    leadsPerPolygon
                );

                allResults = allResults.concat(polygonResults);

                if (allResults.length >= maxLeads * 1.2) {
                    break;
                }

                if (i < area.polygons.length - 1) {
                    await delay(1000);
                }
            }

            const uniqueResults = [];
            const seenPlaceIds = new Set();

            for (const result of allResults) {
                if (result.placeId && !seenPlaceIds.has(result.placeId)) {
                    seenPlaceIds.add(result.placeId);
                    uniqueResults.push(result);
                }
            }

            const finalResults = uniqueResults.slice(0, maxLeads);

            await finalizeAndSend(finalResults, area.polygons.length, allResults.length);

        } else {
            const center = calculateAreaCenter(area);

            if (!center || (center.lat == null || center.lng == null)) {
                return res.status(400).json({
                    error: 'Could not compute center for the given area'
                });
            }

            let location = null;
            location = await reverseGeocode(center.lat, center.lng);
            if (location) detectedLocations.push(location);

            if (!location) {
                location = `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
            }

            const results = await scrapeGoogleMaps(query, location, area, zipcode, country, maxLeads || 60);

            let enrichedResults = results;

            if (enrichContactFlag) {
                enrichedResults = await enrichLeadBatch(
                    results,
                    bodyEnrichmentOptions || {},
                    enrichmentClients,
                    { includeAI: false }
                );
            }

            res.json({
                success: true,
                results: enrichedResults,
                count: enrichedResults.length,
                searchSource: 'Google Places',
                phase1DiscoveryOnly: true,
                ignoredFlags,
                enrichmentRan: enrichContactFlag,
                query,
                area,
                detectedLocation: location,
                zipcode: zipcode || null,
                country: country || null,
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        console.error('Area scrape error:', error);
        res.status(500).json({
            error: 'Failed to scrape area data',
            message: error.message
        });
    }
});

app.post('/api/verify', async (req, res) => {
    try {
        const { lead, enrichmentOptions: bodyEnrichmentOptions } = req.body;

        if (!lead) {
            return res.status(400).json({
                error: 'Lead data is required'
            });
        }

        const enriched = await enrichLead(
            lead,
            bodyEnrichmentOptions || {},
            enrichmentClients,
            { includeAI: true }
        );

        enriched.verified = hasStrongOwner(enriched);

        res.json(enriched);

    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({
            error: 'Failed to verify lead',
            message: error.message
        });
    }
});

app.post('/api/enrich-manual', async (req, res) => {
    try {
        const manualData = req.body;
        const bodyEnrichmentOptions = req.body.enrichmentOptions || {};

        const hasData = Object.values(manualData).some(value => value && String(value).trim() !== '');
        if (!hasData) {
            return res.status(400).json({
                error: 'At least one field is required'
            });
        }

        let scrapedResults = [];
        let searchMethod = 'unknown';

        try {
            const apiKey = process.env.GOOGLE_PLACES_API_KEY;

            if (!apiKey) {
                throw new Error('Google Places API key not configured');
            }

            if (manualData.phone && manualData.phone.trim()) {
                searchMethod = 'phone';

                try {
                    const phoneSearchUrl = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json';
                    const phoneResponse = await axios.get(phoneSearchUrl, {
                        params: {
                            input: manualData.phone,
                            inputtype: 'phonenumber',
                            fields: 'place_id',
                            key: apiKey
                        }
                    });

                    if (phoneResponse.data.status === 'OK' && phoneResponse.data.candidates.length > 0) {
                        const placeId = phoneResponse.data.candidates[0].place_id;
                        const detailsUrl = 'https://maps.googleapis.com/maps/api/place/details/json';
                        const detailsResponse = await axios.get(detailsUrl, {
                            params: {
                                place_id: placeId,
                                fields: 'name,formatted_address,formatted_phone_number,international_phone_number,website,rating,user_ratings_total,types,geometry,address_components',
                                key: apiKey
                            }
                        });

                        if (detailsResponse.data.status === 'OK') {
                            scrapedResults.push(convertPlaceDetailsToLead(detailsResponse.data.result, placeId));
                        }
                    }
                } catch (phoneError) {
                    console.error('Phone search failed:', phoneError.message);
                }
            }

            if (scrapedResults.length === 0 && (manualData.address || (manualData.city && manualData.zipcode))) {
                let addressQuery = '';

                if (manualData.address) {
                    addressQuery = manualData.address;
                } else if (manualData.city && manualData.zipcode) {
                    addressQuery = `${manualData.city} ${manualData.zipcode}`;
                }

                if (manualData.country) {
                    addressQuery += ` ${manualData.country}`;
                }

                searchMethod = 'address';

                const textSearchUrl = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
                const addressResponse = await axios.get(textSearchUrl, {
                    params: {
                        query: `business at ${addressQuery}`,
                        key: apiKey
                    }
                });

                if (addressResponse.data.status === 'OK' && addressResponse.data.results.length > 0) {
                    for (let i = 0; i < Math.min(3, addressResponse.data.results.length); i++) {
                        const place = addressResponse.data.results[i];
                        const detailsUrl = 'https://maps.googleapis.com/maps/api/place/details/json';
                        const detailsResponse = await axios.get(detailsUrl, {
                            params: {
                                place_id: place.place_id,
                                fields: 'name,formatted_address,formatted_phone_number,international_phone_number,website,rating,user_ratings_total,types,geometry,address_components',
                                key: apiKey
                            }
                        });

                        if (detailsResponse.data.status === 'OK') {
                            scrapedResults.push(convertPlaceDetailsToLead(detailsResponse.data.result, place.place_id));
                        }

                        await delay(100);
                    }
                }
            }

            if (scrapedResults.length === 0 && manualData.companyName && manualData.companyName.trim()) {
                searchMethod = 'company_name';

                let location = null;

                if (manualData.city && manualData.country) {
                    location = `${manualData.city}, ${manualData.country}`;
                } else if (manualData.city) {
                    location = manualData.city;
                } else if (manualData.address) {
                    const addressParts = manualData.address.split(',');

                    if (addressParts.length >= 2) {
                        location = addressParts[addressParts.length - 2].trim();
                    }
                }

                if (location) {
                    scrapedResults = await scrapeGoogleMaps(manualData.companyName, location, null, manualData.zipcode, manualData.country, 5);
                } else {
                    scrapedResults = await scrapeGoogleMaps(manualData.companyName, 'United States', null, manualData.zipcode, manualData.country, 5);
                }
            }

        } catch (scrapeError) {
            console.error('Scraping failed, will use manual data only:', scrapeError.message);
        }

        let enrichedLead = { ...manualData, id: Date.now() };

        if (scrapedResults.length > 0) {
            let bestMatch = scrapedResults[0];

            if (manualData.companyName && manualData.companyName.trim()) {
                const exactMatch = scrapedResults.find(result =>
                    result.companyName.toLowerCase() === manualData.companyName.toLowerCase()
                );

                const partialMatch = scrapedResults.find(result =>
                    result.companyName.toLowerCase().includes(manualData.companyName.toLowerCase()) ||
                    manualData.companyName.toLowerCase().includes(result.companyName.toLowerCase())
                );

                bestMatch = exactMatch || partialMatch || scrapedResults[0];
            }

            enrichedLead = {
                ...bestMatch,
                id: Date.now(),
                companyName: manualData.companyName?.trim() || bestMatch.companyName,
                phone: manualData.phone?.trim() || bestMatch.phone,
                address: manualData.address?.trim() || bestMatch.address,
                zipcode: manualData.zipcode?.trim() || bestMatch.zipcode,
                city: manualData.city?.trim() || bestMatch.city,
                country: manualData.country?.trim() || bestMatch.country,
                industry: manualData.industry?.trim() || bestMatch.industry,
                ownerName: manualData.ownerName?.trim() || bestMatch.ownerName,
                website: bestMatch.website,
                rating: bestMatch.rating,
                reviewCount: bestMatch.reviewCount
            };

        } else {
            enrichedLead.companyName = manualData.companyName || 'Unknown Business';
        }

        const verifiedLead = await enrichLead(
            enrichedLead,
            bodyEnrichmentOptions,
            enrichmentClients,
            { includeAI: true }
        );

        verifiedLead.verified = hasStrongOwner(verifiedLead);
        verifiedLead.enrichmentSource = scrapedResults.length > 0
            ? `Google Maps (${searchMethod}) + Phase1 orchestrator`
            : 'Manual + Phase1 orchestrator';
        verifiedLead.scrapedDataAvailable = scrapedResults.length > 0;
        verifiedLead.searchMethod = searchMethod;

        res.json(verifiedLead);

    } catch (error) {
        console.error('Manual enrichment error:', error);
        res.status(500).json({
            error: 'Failed to enrich lead',
            message: error.message
        });
    }
});

app.get('/api/ai-status', (req, res) => {
    const openaiKey = process.env.OPENAI_API_KEY;

    const openaiConfigured = openaiKey &&
        openaiKey.trim().length > 20 &&
        (openaiKey.trim().startsWith('sk-') || openaiKey.trim().startsWith('sk-proj-'));

    const claudeKey = process.env.ANTHROPIC_API_KEY;
    const claudeConfigured = claudeKey &&
        claudeKey.trim() !== '' &&
        !claudeKey.includes('your_anthropic') &&
        !claudeKey.includes('api_key_here') &&
        claudeKey.startsWith('sk-ant-');

    const apolloKey = process.env.APOLLO_API_KEY;
    const apolloConfigured = apolloKey &&
        apolloKey.trim() !== '' &&
        !apolloKey.includes('your_apollo') &&
        !apolloKey.includes('api_key_here') &&
        apolloKey.trim().length > 10;

    const numverifyKey = process.env.NUMVERIFY_API_KEY;
    const numverifyConfigured = numverifyKey &&
        numverifyKey.trim() !== '' &&
        !numverifyKey.includes('your_numverify') &&
        !numverifyKey.includes('api_key_here') &&
        numverifyKey.trim().length > 10;

    const pdlKey = process.env.PDL_API_KEY;
    const pdlConfigured = pdlKey &&
        pdlKey.trim() !== '' &&
        !pdlKey.includes('your_pdl') &&
        !pdlKey.includes('api_key_here') &&
        pdlKey.trim().length > 20;

    const hunterKey = process.env.HUNTER_API_KEY;
    const hunterConfigured = hunterKey &&
        hunterKey.trim() !== '' &&
        !hunterKey.includes('your_hunter') &&
        !hunterKey.includes('api_key_here') &&
        hunterKey.trim().length > 20;

    const yelpKey = process.env.YELP_API_KEY;
    const yelpConfigured = yelpKey &&
        yelpKey.trim() !== '' &&
        !yelpKey.includes('your_yelp') &&
        !yelpKey.includes('api_key_here') &&
        yelpKey.trim().length > 20;

    res.json({
        openai: {
            configured: openaiConfigured,
            status: openaiConfigured ? 'active' : 'not configured'
        },
        claude: {
            configured: claudeConfigured,
            status: claudeConfigured ? 'active' : 'not configured'
        },
        apollo: {
            configured: apolloConfigured,
            status: apolloConfigured ? 'active' : 'not configured'
        },
        numverify: {
            configured: numverifyConfigured,
            status: numverifyConfigured ? 'active' : 'not configured'
        },
        peopleDataLabs: {
            configured: pdlConfigured,
            status: pdlConfigured ? 'active' : 'not configured'
        },
        hunter: {
            configured: hunterConfigured,
            status: hunterConfigured ? 'active' : 'not configured'
        },
        yelp: {
            configured: yelpConfigured,
            status: yelpConfigured ? 'active' : 'not configured'
        },
        phase1: {
            discovery: 'Google Places only',
            enrichmentOrder: 'Hunter → PDL → strict AI (toggles via enrichmentOptions or ENRICH_DISABLE_*)'
        },
        aiPingEndpoint: 'POST /api/ai-ping with body { "providers": ["openai","anthropic"] }'
    });
});

app.post('/api/ai-ping', async (req, res) => {
    const providers = (req.body && req.body.providers) || ['openai', 'anthropic'];
    const out = {};

    if (providers.includes('openai')) {
        try {
            out.openai = await pingOpenAI(openai);
        } catch (e) {
            out.openai = { ok: false, error: e.message };
        }
    }

    if (providers.includes('anthropic')) {
        try {
            out.anthropic = await pingAnthropic(anthropic);
        } catch (e) {
            out.anthropic = { ok: false, error: e.message };
        }
    }

    res.json({
        success: true,
        results: out,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/leads', (req, res) => {
    res.json({
        leads: scrapedLeads,
        count: scrapedLeads.length
    });
});

app.delete('/api/leads', (req, res) => {
    scrapedLeads = [];
    res.json({ message: 'All leads cleared' });
});

app.post('/api/geocode', async (req, res) => {
    try {
        const { query } = req.body;

        if (!query) {
            return res.status(400).json({
                error: 'Search query is required'
            });
        }

        const response = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
                format: 'json',
                q: query,
                limit: 5
            },
            headers: {
                'User-Agent': 'LeadScraperApp/1.0'
            }
        });

        res.json({
            results: response.data.map(item => ({
                display_name: item.display_name,
                lat: parseFloat(item.lat),
                lon: parseFloat(item.lon),
                type: item.type,
                importance: item.importance
            }))
        });

    } catch (error) {
        console.error('Geocoding error:', error);
        res.status(500).json({
            error: 'Failed to geocode location',
            message: error.message
        });
    }
});

app.get('/api/stats', (req, res) => {
    res.json({
        totalLeads: scrapedLeads.length,
        verifiedLeads: scrapedLeads.filter(l => l.verified).length,
        averageConfidence: scrapedLeads.length > 0
            ? scrapedLeads.reduce((sum, l) => sum + (l.aiConfidence || 0), 0) / scrapedLeads.length
            : 0,
        topIndustries: scrapedLeads.reduce((acc, lead) => {
            if (lead.industry) {
                acc[lead.industry] = (acc[lead.industry] || 0) + 1;
            }
            return acc;
        }, {})
    });
});

registerLegacyRoutes(app, { findCompanyOwnerWithPDL });

app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

app.listen(PORT, () => {
    console.log(`Lead Scraper Backend running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;
