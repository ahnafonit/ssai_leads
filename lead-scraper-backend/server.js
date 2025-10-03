const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const puppeteer = require('puppeteer');
const axios = require('axios');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

// Initialize AI clients
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors({
    origin: [
        'http://localhost:3000',
        'http://localhost:3001',
        process.env.FRONTEND_URL
    ].filter(Boolean),
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Store for scraped data (in production, use a database)
let scrapedLeads = [];

// Helper function to simulate delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to generate random data for demo purposes
const generateMockLead = (companyName, phone = null, address = null, zipcode = null, country = null) => ({
    id: Date.now() + Math.random(),
    companyName: companyName || `Business ${Math.floor(Math.random() * 1000)}`,
    phone: phone || `+1-${Math.floor(Math.random() * 900 + 100)}-${Math.floor(Math.random() * 900 + 100)}-${Math.floor(Math.random() * 9000 + 1000)}`,
    address: address || `${Math.floor(Math.random() * 999 + 1)} Main St, City, State ${zipcode || Math.floor(Math.random() * 90000 + 10000)}`,
    zipcode: zipcode || Math.floor(Math.random() * 90000 + 10000).toString(),
    city: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix'][Math.floor(Math.random() * 5)],
    country: country || 'USA',
    industry: ['Restaurant', 'Retail', 'Service', 'Technology', 'Healthcare'][Math.floor(Math.random() * 5)],
    ownerName: ['John Smith', 'Jane Doe', 'Mike Johnson', 'Sarah Wilson', 'David Brown'][Math.floor(Math.random() * 5)],
    website: `www.${companyName?.toLowerCase().replace(/\s+/g, '') || 'business'}.com`,
    rating: (Math.random() * 2 + 3).toFixed(1), // 3.0 to 5.0
    reviewCount: Math.floor(Math.random() * 500 + 10)
});

// Google Places API function to get real business data
async function scrapeGoogleMaps(query, location, area = null, zipcode = null, country = null, maxLeads = 10) {
    try {
        const apiKey = process.env.GOOGLE_PLACES_API_KEY;

        if (!apiKey) {
            console.error('Google Places API key not configured');
            throw new Error('Google Places API key not configured');
        }

        // Build search query and location bias parameters
        let searchQuery = query;
        let locationBias = null;

        // If we have an area with coordinates, extract center for locationbias
        if (area && area.type) {
            const center = calculateAreaCenter(area);
            if (center) {
                // Use locationbias with point and radius for better geographic targeting
                const radius = area.radius ? Math.min(area.radius, 50000) : 5000; // Max 50km radius
                locationBias = `point:${center.lat},${center.lng}`;
                console.log(`Using locationbias: ${locationBias} with radius: ${radius}m`);
            }
        }

        // Build search query text
        // Handle "All" or generic queries by using "business" or "establishment"
        let effectiveQuery = query;
        if (query.toLowerCase() === 'all' || query.toLowerCase() === 'any') {
            effectiveQuery = 'business'; // Use generic term that Google understands
        }

        if (location && !area) {
            searchQuery = `${effectiveQuery} in ${location}`;
        } else if (location && area) {
            // When we have area, include location in query for better results
            searchQuery = `${effectiveQuery} in ${location}`;
        } else {
            searchQuery = effectiveQuery;
        }

        if (zipcode) {
            searchQuery += ` ${zipcode}`;
        }
        if (country) {
            searchQuery += ` ${country}`;
        }

        console.log(`Searching Google Places: ${searchQuery}, maxLeads: ${maxLeads}`);

        // Step 1: Text Search to find places with pagination support
        const textSearchUrl = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
        const searchParams = {
            query: searchQuery,
            key: apiKey
        };

        // Add locationbias if we have area coordinates
        if (locationBias) {
            searchParams.locationbias = locationBias;
            if (area && area.radius) {
                searchParams.radius = Math.min(area.radius, 50000);
            } else {
                searchParams.radius = 5000; // Default 5km radius
            }
        }

        // Fetch all pages of results until we reach maxLeads or run out of pages
        let allPlaces = [];
        let nextPageToken = null;
        let pageCount = 0;
        const maxPages = 3; // Google allows up to 3 pages (60 results max)

        do {
            pageCount++;
            console.log(`Fetching page ${pageCount}...`);

            const requestParams = { ...searchParams };
            if (nextPageToken) {
                // For pagination, only use pagetoken and key
                delete requestParams.query;
                delete requestParams.locationbias;
                delete requestParams.radius;
                requestParams.pagetoken = nextPageToken;
            }

            const textSearchResponse = await axios.get(textSearchUrl, {
                params: requestParams
            });

            if (textSearchResponse.data.status !== 'OK' && textSearchResponse.data.status !== 'ZERO_RESULTS') {
                console.error('Google Places API error:', textSearchResponse.data.status);
                if (allPlaces.length > 0) {
                    // If we already have some results, return them
                    console.log(`Returning ${allPlaces.length} results from previous pages`);
                    break;
                }
                throw new Error(`Google Places API error: ${textSearchResponse.data.status}`);
            }

            if (textSearchResponse.data.results.length === 0) {
                console.log('No more results found');
                break;
            }

            allPlaces = allPlaces.concat(textSearchResponse.data.results);
            console.log(`Page ${pageCount}: Found ${textSearchResponse.data.results.length} results. Total so far: ${allPlaces.length}`);

            nextPageToken = textSearchResponse.data.next_page_token;

            // Check if we have enough results
            if (allPlaces.length >= maxLeads) {
                console.log(`Reached target of ${maxLeads} leads`);
                break;
            }

            // Check if we've hit the page limit
            if (pageCount >= maxPages) {
                console.log(`Reached maximum page limit (${maxPages})`);
                break;
            }

            // If there's a next page token, wait before requesting it
            // Google requires a short delay before the token becomes valid
            if (nextPageToken) {
                console.log('Waiting for next page token to become valid...');
                await delay(2000); // 2 second delay between pages
            }

        } while (nextPageToken && allPlaces.length < maxLeads);

        if (allPlaces.length === 0) {
            console.log('No results found');
            return [];
        }

        const results = [];
        const places = allPlaces.slice(0, maxLeads); // Use user-specified maxLeads
        console.log(`Processing ${places.length} places out of ${allPlaces.length} total found`);

        // Step 2: Get details for each place
        for (const place of places) {
            try {
                // Get place details
                const detailsUrl = 'https://maps.googleapis.com/maps/api/place/details/json';
                const detailsResponse = await axios.get(detailsUrl, {
                    params: {
                        place_id: place.place_id,
                        fields: 'name,formatted_address,formatted_phone_number,international_phone_number,website,rating,user_ratings_total,types,geometry,address_components',
                        key: apiKey
                    }
                });

                if (detailsResponse.data.status === 'OK') {
                    const details = detailsResponse.data.result;

                    // Extract address components
                    const addressComponents = details.address_components || [];
                    let extractedZipcode = '';
                    let extractedCity = '';
                    let extractedCountry = '';
                    let extractedState = '';

                    addressComponents.forEach(component => {
                        if (component.types.includes('postal_code')) {
                            extractedZipcode = component.long_name;
                        }
                        if (component.types.includes('locality')) {
                            extractedCity = component.long_name;
                        }
                        if (component.types.includes('country')) {
                            extractedCountry = component.long_name;
                        }
                        if (component.types.includes('administrative_area_level_1')) {
                            extractedState = component.short_name;
                        }
                    });

                    // Determine industry from types
                    const types = details.types || [];
                    let industry = 'Business';
                    if (types.includes('restaurant')) industry = 'Restaurant';
                    else if (types.includes('store') || types.includes('retail')) industry = 'Retail';
                    else if (types.includes('hospital') || types.includes('doctor')) industry = 'Healthcare';
                    else if (types.includes('lawyer')) industry = 'Legal Services';
                    else if (types.includes('real_estate_agency')) industry = 'Real Estate';
                    else if (types.includes('cafe') || types.includes('bakery')) industry = 'Food & Beverage';
                    else if (types.includes('gym')) industry = 'Fitness';
                    else if (types.includes('beauty_salon') || types.includes('spa')) industry = 'Beauty & Wellness';
                    else if (types.length > 0) {
                        industry = types[0].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    }

                    const lead = {
                        id: Date.now() + Math.random(),
                        companyName: details.name,
                        phone: details.formatted_phone_number || details.international_phone_number || 'N/A',
                        address: details.formatted_address || 'N/A',
                        zipcode: extractedZipcode || 'N/A',
                        city: extractedCity || 'N/A',
                        country: extractedCountry || 'N/A',
                        state: extractedState || '',
                        industry: industry,
                        website: details.website || 'N/A',
                        rating: details.rating || 'N/A',
                        reviewCount: details.user_ratings_total || 0,
                        latitude: details.geometry?.location?.lat || null,
                        longitude: details.geometry?.location?.lng || null,
                        placeId: place.place_id,
                        types: types,
                        source: 'Google Places API'
                    };

                    results.push(lead);
                    console.log(`✓ Found: ${lead.companyName} - ${lead.phone}`);
                }

                // Small delay to avoid rate limiting
                await delay(100);

            } catch (detailError) {
                console.error('Error fetching place details:', detailError.message);
                // Continue with next place
            }
        }

        console.log(`Successfully retrieved ${results.length} real businesses from Google Places API`);
        return results;

    } catch (error) {
        console.error('Google Places API error:', error.message);
        throw new Error(`Failed to fetch data from Google Places API: ${error.message}`);
    }
}

// AI Verification with ChatGPT
async function verifyWithChatGPT(lead) {
    try {
        if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
            console.log('OpenAI API key not configured, using mock data');
            return null;
        }

        const prompt = `Analyze this business lead and provide detailed information:
Company: ${lead.companyName}
Phone: ${lead.phone}
Address: ${lead.address}
Current Industry: ${lead.industry || 'Unknown'}

Please provide:
1. Verified owner/contact name
2. Industry classification
3. Estimated employee count range
4. Estimated annual revenue range
5. Key business details
6. Confidence score (0-100)

Return as JSON with keys: ownerName, industry, employeeCount, revenue, businessDetails, confidence`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: "You are a business intelligence assistant that verifies and enriches business lead information. Provide accurate, researched data in JSON format."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 500
        });

        let response = completion.choices[0].message.content;

        // Extract JSON from markdown code blocks (ChatGPT often wraps in ```)
        const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            response = jsonMatch[1] || jsonMatch[0];
        }

        const parsed = JSON.parse(response);

        return {
            source: 'ChatGPT',
            ...parsed
        };
    } catch (error) {
        console.error('ChatGPT verification error:', error.message);
        return null;
    }
}

// AI Verification with Claude
async function verifyWithClaude(lead) {
    try {
        if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_claude_api_key_here') {
            console.log('Anthropic API key not configured, using mock data');
            return null;
        }

        const prompt = `Analyze this business lead and provide detailed information:
Company: ${lead.companyName}
Phone: ${lead.phone}
Address: ${lead.address}
Current Industry: ${lead.industry || 'Unknown'}

Please provide:
1. Verified owner/contact name
2. Industry classification
3. Estimated employee count range
4. Estimated annual revenue range
5. Key business details
6. Confidence score (0-100)

Return as JSON with keys: ownerName, industry, employeeCount, revenue, businessDetails, confidence`;

        const message = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1024,
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ]
        });

        let response = message.content[0].text;

        // Extract JSON from response (Claude sometimes adds text before/after)
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            response = jsonMatch[0];
        }

        const parsed = JSON.parse(response);

        // Ensure industry is a string, not an object
        if (parsed.industry && typeof parsed.industry === 'object') {
            parsed.industry = parsed.industry.primary || parsed.industry.NAICS || JSON.stringify(parsed.industry);
        }

        return {
            source: 'Claude',
            ...parsed
        };
    } catch (error) {
        console.error('Claude verification error:', error.message);
        return null;
    }
}

// Combined AI Verification function
async function verifyLeadWithAI(lead, preferredAI = 'both') {
    console.log(`Verifying lead with AI (mode: ${preferredAI})`);

    let chatGPTResult = null;
    let claudeResult = null;

    // Run Claude first (primary), then ChatGPT (secondary)
    if (preferredAI === 'both' || preferredAI === 'claude') {
        claudeResult = await verifyWithClaude(lead);
    }

    if (preferredAI === 'both' || preferredAI === 'chatgpt') {
        chatGPTResult = await verifyWithChatGPT(lead);
    }

    // If both APIs are not configured, use mock data
    if (!chatGPTResult && !claudeResult) {
        console.log('No AI APIs configured, using mock verification data');
        return {
            ...lead,
            verified: true,
            aiConfidence: Math.floor(Math.random() * 20) + 80,
            ownerName: lead.ownerName || ['John Smith', 'Jane Doe', 'Mike Johnson', 'Sarah Wilson', 'David Brown'][Math.floor(Math.random() * 5)],
            industry: lead.industry || ['Technology', 'Healthcare', 'Finance', 'Retail', 'Manufacturing'][Math.floor(Math.random() * 5)],
            employeeCount: `${Math.floor(Math.random() * 500) + 10}-${Math.floor(Math.random() * 500) + 510}`,
            revenue: `$${Math.floor(Math.random() * 10) + 1}M - $${Math.floor(Math.random() * 10) + 11}M`,
            businessDetails: 'Mock verification - Configure API keys for real AI verification',
            aiSource: 'Mock Data',
            socialMedia: {
                linkedin: `linkedin.com/company/${lead.companyName?.toLowerCase().replace(/\s+/g, '-')}`,
                facebook: Math.random() > 0.5 ? `facebook.com/${lead.companyName?.toLowerCase().replace(/\s+/g, '')}` : null
            }
        };
    }

    // Combine results from both AIs (Claude takes priority as primary)
    let finalResult = { ...lead, verified: true };

    if (chatGPTResult && claudeResult) {
        // Both AIs verified - 100% confidence
        finalResult = {
            ...finalResult,
            ownerName: claudeResult.ownerName || chatGPTResult.ownerName || lead.ownerName,
            industry: claudeResult.industry || chatGPTResult.industry || lead.industry,
            employeeCount: claudeResult.employeeCount || chatGPTResult.employeeCount,
            revenue: claudeResult.revenue || chatGPTResult.revenue,
            businessDetails: `Claude (Primary): ${claudeResult.businessDetails}\nChatGPT (Secondary): ${chatGPTResult.businessDetails}`,
            aiConfidence: 100,
            aiSource: 'Claude (Primary) + ChatGPT (Secondary)',
            claudeConfidence: claudeResult.confidence,
            chatGPTConfidence: chatGPTResult.confidence
        };
    } else if (claudeResult) {
        // Claude only - 50% confidence
        finalResult = {
            ...finalResult,
            ...claudeResult,
            aiConfidence: 50,
            aiSource: 'Claude (Primary)'
        };
    } else if (chatGPTResult) {
        // ChatGPT only - 50% confidence
        finalResult = {
            ...finalResult,
            ...chatGPTResult,
            aiConfidence: 50,
            aiSource: 'ChatGPT (Fallback)'
        };
    }

    // Add social media links
    finalResult.socialMedia = {
        linkedin: `linkedin.com/company/${finalResult.companyName?.toLowerCase().replace(/\s+/g, '-')}`,
        facebook: `facebook.com/${finalResult.companyName?.toLowerCase().replace(/\s+/g, '')}`
    };

    return finalResult;
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Text-based scraping endpoint
app.post('/api/scrape', async (req, res) => {
    try {
        const { query, location, zipcode, country, maxLeads } = req.body;

        if (!query || !location) {
            return res.status(400).json({
                error: 'Both query and location are required'
            });
        }

        console.log(`Starting scrape for: ${query} in ${location}${zipcode ? `, zipcode: ${zipcode}` : ''}${country ? `, country: ${country}` : ''}`);

        const results = await scrapeGoogleMaps(query, location, null, zipcode, country, maxLeads || 10);

        res.json({
            success: true,
            results: results,
            count: results.length,
            query: query,
            location: location,
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

// Helper function to calculate center of area
function calculateAreaCenter(area) {
    if (area.type === 'circle') {
        return area.center;
    } else if (area.type === 'rectangle') {
        return {
            lat: (area.bounds.north + area.bounds.south) / 2,
            lng: (area.bounds.east + area.bounds.west) / 2
        };
    } else if (area.type === 'polygon' || area.type === 'polyline') {
        const coords = area.coordinates;
        const sumLat = coords.reduce((sum, c) => sum + c.lat, 0);
        const sumLng = coords.reduce((sum, c) => sum + c.lng, 0);
        return {
            lat: sumLat / coords.length,
            lng: sumLng / coords.length
        };
    } else if (area.type === 'multipolygon') {
        // Calculate center from all polygons
        let totalLat = 0, totalLng = 0, totalPoints = 0;
        area.polygons.forEach(polygon => {
            polygon.forEach(coord => {
                totalLat += coord.lat;
                totalLng += coord.lng;
                totalPoints++;
            });
        });
        return {
            lat: totalLat / totalPoints,
            lng: totalLng / totalPoints
        };
    }
    return null;
}

// Helper function to reverse geocode coordinates to get location string
async function reverseGeocode(lat, lng) {
    try {
        const apiKey = process.env.GOOGLE_PLACES_API_KEY;

        if (!apiKey) {
            console.error('Google API key not available for reverse geocoding');
            return null;
        }

        // Use Google's Geocoding API
        const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
            params: {
                latlng: `${lat},${lng}`,
                key: apiKey
            }
        });

        if (response.data.status === 'OK' && response.data.results.length > 0) {
            const result = response.data.results[0];

            // Extract city, state, country from address components
            let city = '';
            let state = '';
            let country = '';

            result.address_components.forEach(component => {
                if (component.types.includes('locality')) {
                    city = component.long_name;
                } else if (component.types.includes('administrative_area_level_1')) {
                    state = component.short_name;
                } else if (component.types.includes('country')) {
                    country = component.long_name;
                }
            });

            // Build location string
            let locationString = '';
            if (city) locationString += city;
            if (state && locationString) locationString += `, ${state}`;
            if (country && locationString) locationString += `, ${country}`;

            return locationString || result.formatted_address;
        }

        return null;
    } catch (error) {
        console.error('Reverse geocoding error:', error.message);
        return null;
    }
}

// Map area-based scraping endpoint
app.post('/api/scrape-area', async (req, res) => {
    try {
        const { query, area, zipcode, country, maxLeads } = req.body;

        if (!query || !area) {
            return res.status(400).json({
                error: 'Both query and area are required'
            });
        }

        console.log(`Starting area scrape for: ${query}${zipcode ? `, zipcode: ${zipcode}` : ''}${country ? `, country: ${country}` : ''}`);
        console.log('Area:', JSON.stringify(area, null, 2));

        let allResults = [];
        let detectedLocations = [];

        // Check if multipolygon - search each polygon separately
        if (area.type === 'multipolygon' && area.polygons && area.polygons.length > 0) {
            console.log(`Multipolygon detected with ${area.polygons.length} polygons. Searching each separately...`);

            // Calculate leads per polygon (distribute evenly)
            const leadsPerPolygon = Math.ceil(maxLeads / area.polygons.length);

            // Search each polygon area
            for (let i = 0; i < area.polygons.length; i++) {
                const polygon = area.polygons[i];
                console.log(`\nSearching polygon ${i + 1}/${area.polygons.length}...`);

                // Create a single polygon area object
                const singlePolygonArea = {
                    type: 'polygon',
                    coordinates: polygon
                };

                // Calculate center for this polygon
                const center = calculateAreaCenter(singlePolygonArea);
                console.log(`Polygon ${i + 1} center:`, center);

                // Reverse geocode to get location name
                let location = null;
                if (center) {
                    location = await reverseGeocode(center.lat, center.lng);
                    console.log(`Polygon ${i + 1} location: ${location}`);
                    detectedLocations.push(location);
                }

                if (!location) {
                    location = `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
                }

                // Search this polygon area
                const polygonResults = await scrapeGoogleMaps(
                    query,
                    location,
                    singlePolygonArea,
                    zipcode,
                    country,
                    leadsPerPolygon
                );

                console.log(`Polygon ${i + 1} returned ${polygonResults.length} results`);
                allResults = allResults.concat(polygonResults);

                // Small delay between polygon searches to avoid rate limiting
                if (i < area.polygons.length - 1) {
                    await delay(500);
                }
            }

            // Remove duplicates based on placeId
            const uniqueResults = [];
            const seenPlaceIds = new Set();

            for (const result of allResults) {
                if (result.placeId && !seenPlaceIds.has(result.placeId)) {
                    seenPlaceIds.add(result.placeId);
                    uniqueResults.push(result);
                }
            }

            // Limit to maxLeads
            const finalResults = uniqueResults.slice(0, maxLeads);

            console.log(`\nTotal results from all polygons: ${allResults.length}`);
            console.log(`After removing duplicates: ${uniqueResults.length}`);
            console.log(`Final results (limited to ${maxLeads}): ${finalResults.length}`);

            res.json({
                success: true,
                results: finalResults,
                count: finalResults.length,
                query: query,
                area: area,
                detectedLocations: detectedLocations,
                polygonsSearched: area.polygons.length,
                totalResultsBeforeDedup: allResults.length,
                zipcode: zipcode || null,
                country: country || null,
                timestamp: new Date().toISOString()
            });

        } else {
            // Single area search (original behavior)
            const center = calculateAreaCenter(area);
            console.log('Area center:', center);

            let location = null;
            if (center) {
                location = await reverseGeocode(center.lat, center.lng);
                console.log('Reverse geocoded location:', location);
                detectedLocations.push(location);
            }

            if (!location) {
                location = `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
            }

            const results = await scrapeGoogleMaps(query, location, area, zipcode, country, maxLeads || 10);

            res.json({
                success: true,
                results: results,
                count: results.length,
                query: query,
                area: area,
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

// AI verification endpoint
app.post('/api/verify', async (req, res) => {
    try {
        const { lead, aiProvider } = req.body;

        if (!lead) {
            return res.status(400).json({
                error: 'Lead data is required'
            });
        }

        // aiProvider can be: 'both', 'chatgpt', 'claude', or undefined (defaults to 'both')
        const provider = aiProvider || 'both';
        console.log(`Verifying lead: ${lead.companyName} with ${provider}`);

        const verifiedLead = await verifyLeadWithAI(lead, provider);

        res.json(verifiedLead);

    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({
            error: 'Failed to verify lead',
            message: error.message
        });
    }
});

// Manual lead enrichment endpoint
app.post('/api/enrich-manual', async (req, res) => {
    try {
        const manualData = req.body;

        // Check if at least one field is provided
        const hasData = Object.values(manualData).some(value => value && value.trim() !== '');
        if (!hasData) {
            return res.status(400).json({
                error: 'At least one field is required'
            });
        }

        console.log(`Enriching manual lead with data:`, manualData);

        let scrapedResults = [];
        let searchMethod = 'unknown';

        try {
            const apiKey = process.env.GOOGLE_PLACES_API_KEY;

            if (!apiKey) {
                throw new Error('Google Places API key not configured');
            }

            // Strategy 1: Search by phone number if provided
            if (manualData.phone && manualData.phone.trim()) {
                console.log(`Searching by phone number: ${manualData.phone}`);
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
                        // Get place details
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
                            const details = detailsResponse.data.result;
                            scrapedResults.push(convertPlaceDetailsToLead(details, placeId));
                            console.log(`Found business by phone: ${details.name}`);
                        }
                    }
                } catch (phoneError) {
                    console.log('Phone search failed:', phoneError.message);
                }
            }

            // Strategy 2: Search by address if provided and no results yet
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

                console.log(`Searching by address: ${addressQuery}`);
                searchMethod = 'address';

                // Use text search to find businesses at the address
                const textSearchUrl = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
                const addressResponse = await axios.get(textSearchUrl, {
                    params: {
                        query: `business at ${addressQuery}`,
                        key: apiKey
                    }
                });

                if (addressResponse.data.status === 'OK' && addressResponse.data.results.length > 0) {
                    // Get details for top results
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
                            const details = detailsResponse.data.result;
                            scrapedResults.push(convertPlaceDetailsToLead(details, place.place_id));
                        }

                        await delay(100);
                    }

                    console.log(`Found ${scrapedResults.length} businesses at address`);
                }
            }

            // Strategy 3: Search by company name if provided
            if (scrapedResults.length === 0 && manualData.companyName && manualData.companyName.trim()) {
                console.log(`Searching by company name: ${manualData.companyName}`);
                searchMethod = 'company_name';

                // Build location string
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
            console.log('Scraping failed, will use manual data only:', scrapeError.message);
        }

        // Find best match from scraped results
        let enrichedLead = { ...manualData, id: Date.now() };

        if (scrapedResults.length > 0) {
            let bestMatch = scrapedResults[0];

            // If company name was provided, try to find best match
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

            // Merge scraped data with manual data
            enrichedLead = {
                ...bestMatch,
                id: Date.now(),
                // Manual data overrides scraped data only if provided and not empty
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

            console.log(`Found match: ${bestMatch.companyName} (via ${searchMethod})`);
        } else {
            // No results from scraping, use whatever manual data was provided
            console.log('No scraping results, using manual data only');
            enrichedLead.companyName = manualData.companyName || 'Unknown Business';
        }

        // Now verify and enrich with AI
        const verifiedLead = await verifyLeadWithAI(enrichedLead, 'both');

        // Add metadata about enrichment
        verifiedLead.enrichmentSource = scrapedResults.length > 0 ? `Google Maps (${searchMethod}) + AI` : 'Manual + AI';
        verifiedLead.scrapedDataAvailable = scrapedResults.length > 0;
        verifiedLead.searchMethod = searchMethod;

        console.log(`Successfully enriched lead: ${verifiedLead.companyName}`);

        res.json(verifiedLead);

    } catch (error) {
        console.error('Manual enrichment error:', error);
        res.status(500).json({
            error: 'Failed to enrich lead',
            message: error.message
        });
    }
});

// Helper function to convert Google Place Details to Lead format
function convertPlaceDetailsToLead(details, placeId) {
    const addressComponents = details.address_components || [];
    let extractedZipcode = '';
    let extractedCity = '';
    let extractedCountry = '';
    let extractedState = '';

    addressComponents.forEach(component => {
        if (component.types.includes('postal_code')) {
            extractedZipcode = component.long_name;
        }
        if (component.types.includes('locality')) {
            extractedCity = component.long_name;
        }
        if (component.types.includes('country')) {
            extractedCountry = component.long_name;
        }
        if (component.types.includes('administrative_area_level_1')) {
            extractedState = component.short_name;
        }
    });

    const types = details.types || [];
    let industry = 'Business';
    if (types.includes('restaurant')) industry = 'Restaurant';
    else if (types.includes('store') || types.includes('retail')) industry = 'Retail';
    else if (types.includes('hospital') || types.includes('doctor')) industry = 'Healthcare';
    else if (types.includes('lawyer')) industry = 'Legal Services';
    else if (types.includes('real_estate_agency')) industry = 'Real Estate';
    else if (types.includes('cafe') || types.includes('bakery')) industry = 'Food & Beverage';
    else if (types.includes('gym')) industry = 'Fitness';
    else if (types.includes('beauty_salon') || types.includes('spa')) industry = 'Beauty & Wellness';
    else if (types.length > 0) {
        industry = types[0].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    return {
        id: Date.now() + Math.random(),
        companyName: details.name,
        phone: details.formatted_phone_number || details.international_phone_number || 'N/A',
        address: details.formatted_address || 'N/A',
        zipcode: extractedZipcode || 'N/A',
        city: extractedCity || 'N/A',
        country: extractedCountry || 'N/A',
        state: extractedState || '',
        industry: industry,
        website: details.website || 'N/A',
        rating: details.rating || 'N/A',
        reviewCount: details.user_ratings_total || 0,
        latitude: details.geometry?.location?.lat || null,
        longitude: details.geometry?.location?.lng || null,
        placeId: placeId,
        types: types,
        source: 'Google Places API'
    };
}

// Get AI status endpoint (check which APIs are configured)
app.get('/api/ai-status', (req, res) => {
    // Check if OpenAI key is configured and valid (not a placeholder)
    const openaiKey = process.env.OPENAI_API_KEY;
    console.log('OpenAI Key Check:', {
        exists: !!openaiKey,
        length: openaiKey?.length,
        starts: openaiKey?.substring(0, 10),
        startsWithSk: openaiKey?.startsWith('sk-'),
        startsWithSkProj: openaiKey?.startsWith('sk-proj-')
    });

    // Simplified validation - just check if key exists and starts with sk-
    const openaiConfigured = openaiKey &&
        openaiKey.trim().length > 20 &&
        (openaiKey.trim().startsWith('sk-') || openaiKey.trim().startsWith('sk-proj-'));

    // Check if Anthropic key is configured and valid (not a placeholder)
    const claudeKey = process.env.ANTHROPIC_API_KEY;
    const claudeConfigured = claudeKey &&
        claudeKey.trim() !== '' &&
        !claudeKey.includes('your_anthropic') &&
        !claudeKey.includes('api_key_here') &&
        claudeKey.startsWith('sk-ant-');

    res.json({
        openai: {
            configured: openaiConfigured,
            status: openaiConfigured ? 'ready' : 'not configured'
        },
        claude: {
            configured: claudeConfigured,
            status: claudeConfigured ? 'ready' : 'not configured'
        },
        recommendation: !openaiConfigured && !claudeConfigured
            ? 'Configure at least one AI API key in the .env file for enhanced lead verification'
            : 'AI verification is ready'
    });
});

// Get all scraped leads (for admin/debugging)
app.get('/api/leads', (req, res) => {
    res.json({
        leads: scrapedLeads,
        count: scrapedLeads.length
    });
});

// Clear all scraped leads (for admin/debugging)
app.delete('/api/leads', (req, res) => {
    scrapedLeads = [];
    res.json({ message: 'All leads cleared' });
});

// Geocoding endpoint (for location search)
app.post('/api/geocode', async (req, res) => {
    try {
        const { query } = req.body;

        if (!query) {
            return res.status(400).json({
                error: 'Search query is required'
            });
        }

        // Use Nominatim for geocoding (free alternative to Google Geocoding API)
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

// Statistics endpoint
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

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});


// Start server
app.listen(PORT, () => {
    console.log(`🚀 Lead Scraper Backend running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
    console.log(`🔍 Scrape endpoint: http://localhost:${PORT}/api/scrape`);
    console.log(`�️  Area scrape endpoint: http://localhost:${PORT}/api/scrape-area`);
    console.log(`✅ Verify endpoint: http://localhost:${PORT}/api/verify`);
});

module.exports = app;
