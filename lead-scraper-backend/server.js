const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const puppeteer = require('puppeteer');
const axios = require('axios');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config({ override: true });

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
        'https://lead-scraper-frontend-372172131227.us-central1.run.app',
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

// Rate limiter removed for faster ChatGPT responses
async function rateLimitedChatGPTCall(fn) {
    return await fn();
}

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

                    // Clean and validate extracted data
                    const cleanedPhone = cleanPhoneNumber(details.formatted_phone_number || details.international_phone_number);
                    const cleanedZipcode = cleanZipcode(extractedZipcode);
                    const cleanedAddress = cleanAddress(details.formatted_address);

                    const lead = {
                        id: Date.now() + Math.random(),
                        companyName: details.name,
                        phone: cleanedPhone,
                        address: cleanedAddress,
                        zipcode: cleanedZipcode,
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

        const prompt = `Your PRIMARY GOAL is to find the OWNER NAME for this business. Search the web, check business registrations, and use all available information to identify the owner/founder.

Business Information:
Company: ${lead.companyName}
Phone: ${lead.phone}
Address: ${lead.address}
Current Industry: ${lead.industry || 'Unknown'}

PRIORITY TASK - Find Owner Name:
- Search for owner, founder, CEO, or proprietor name
- Check business website "About" page
- Look for "Founded by", "Owner:", or "Proprietor:" mentions
- Check social media profiles
- Review business registration records
- Search news articles or press releases
- If found, provide the FULL NAME (first and last)

Also provide:
1. Owner/Founder Full Name (HIGHEST PRIORITY - try multiple sources)
2. Industry classification - USE ONLY these simple categories: Restaurant, Retail, Healthcare, Technology, Finance, Real Estate, Manufacturing, Legal Services, Construction, Education, Transportation, Food & Beverage, Fitness, Beauty & Wellness, Professional Services, or Business
3. Estimated employee count range
4. Estimated annual revenue range
5. Key business details
6. Confidence score (0-100)

Return as JSON with keys: ownerName, industry, employeeCount, revenue, businessDetails, confidence
CRITICAL: Put maximum effort into finding the ownerName. If you find it, include it even if confidence is low. If not found after thorough search, set to "N/A".`;

        // Use rate limiter to prevent too many simultaneous requests
        const completion = await rateLimitedChatGPTCall(async () => {
            return await openai.chat.completions.create({
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

        const prompt = `Your PRIMARY GOAL is to find the OWNER NAME for this business. Search the web, check business registrations, and use all available information to identify the owner/founder.

Business Information:
Company: ${lead.companyName}
Phone: ${lead.phone}
Address: ${lead.address}
Current Industry: ${lead.industry || 'Unknown'}

PRIORITY TASK - Find Owner Name:
- Search for owner, founder, CEO, or proprietor name
- Check business website "About" page
- Look for "Founded by", "Owner:", or "Proprietor:" mentions
- Check social media profiles (LinkedIn, Facebook business pages)
- Review business registration records
- Search news articles or press releases
- Look for state business registry information
- If found, provide the FULL NAME (first and last)

Also provide:
1. Owner/Founder Full Name (HIGHEST PRIORITY - try multiple sources)
2. Industry classification - USE ONLY these simple categories: Restaurant, Retail, Healthcare, Technology, Finance, Real Estate, Manufacturing, Legal Services, Construction, Education, Transportation, Food & Beverage, Fitness, Beauty & Wellness, Professional Services, or Business
3. Estimated employee count range
4. Estimated annual revenue range
5. Key business details
6. Confidence score (0-100)

Return as JSON with keys: ownerName, industry, employeeCount, revenue, businessDetails, confidence
CRITICAL: Put maximum effort into finding the ownerName. If you find it, include it even if confidence is low. If not found after thorough search, set to "N/A".`;

        const message = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
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
            ownerName: claudeResult.ownerName || chatGPTResult.ownerName || lead.ownerName || 'N/A',
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
        // Claude only - accept any name from Claude
        finalResult = {
            ...finalResult,
            ownerName: claudeResult.ownerName || lead.ownerName || 'N/A',
            industry: claudeResult.industry || lead.industry,
            employeeCount: claudeResult.employeeCount || 'N/A',
            revenue: claudeResult.revenue || 'N/A',
            businessDetails: claudeResult.businessDetails || 'Verified by Claude AI',
            aiConfidence: 50,
            aiSource: 'Claude (Primary)',
            confidence: claudeResult.confidence
        };
    } else if (chatGPTResult) {
        // ChatGPT only - accept any name from ChatGPT
        finalResult = {
            ...finalResult,
            ownerName: chatGPTResult.ownerName || lead.ownerName || 'N/A',
            industry: chatGPTResult.industry || lead.industry,
            employeeCount: chatGPTResult.employeeCount || 'N/A',
            revenue: chatGPTResult.revenue || 'N/A',
            businessDetails: chatGPTResult.businessDetails || 'Verified by ChatGPT AI',
            aiConfidence: 50,
            aiSource: 'ChatGPT (Fallback)',
            confidence: chatGPTResult.confidence
        };
    }

    // Add social media links
    finalResult.socialMedia = {
        linkedin: `linkedin.com/company/${finalResult.companyName?.toLowerCase().replace(/\s+/g, '-')}`,
        facebook: `facebook.com/${finalResult.companyName?.toLowerCase().replace(/\s+/g, '')}`
    };

    return finalResult;
}

// Yelp Fusion API Integration Functions

// Yelp Business Search
async function searchYelpBusinesses(query, location, latitude = null, longitude = null, radius = 5000, limit = 50) {
    try {
        const apiKey = process.env.YELP_API_KEY;

        if (!apiKey) {
            console.error('Yelp API key not configured');
            throw new Error('Yelp API key not configured');
        }

        console.log(`Searching Yelp: "${query}" in ${location || `${latitude},${longitude}`}`);

        const searchParams = {
            term: query,
            limit: Math.min(limit, 50) // Yelp max is 50 per request
        };

        // Use coordinates if provided, otherwise use location string
        if (latitude && longitude) {
            searchParams.latitude = latitude;
            searchParams.longitude = longitude;
            searchParams.radius = Math.min(radius, 40000); // Max 40km
        } else if (location) {
            searchParams.location = location;
        } else {
            throw new Error('Either location string or coordinates required');
        }

        const response = await axios.get('https://api.yelp.com/v3/businesses/search', {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            params: searchParams
        });

        console.log(`Yelp returned ${response.data.businesses?.length || 0} businesses`);

        // Transform to our lead format
        const leads = (response.data.businesses || []).map(business => ({
            id: Date.now() + Math.random(),
            companyName: business.name,
            phone: business.phone || business.display_phone || 'N/A',
            address: business.location?.display_address?.join(', ') || 'N/A',
            zipcode: business.location?.zip_code || 'N/A',
            city: business.location?.city || 'N/A',
            state: business.location?.state || 'N/A',
            country: business.location?.country || 'N/A',
            industry: business.categories?.[0]?.title || 'Business',
            rating: business.rating || 'N/A',
            reviewCount: business.review_count || 0,
            latitude: business.coordinates?.latitude || null,
            longitude: business.coordinates?.longitude || null,
            yelpId: business.id,
            yelpUrl: business.url,
            yelpCategories: business.categories?.map(c => c.title) || [],
            imageUrl: business.image_url,
            price: business.price || 'N/A',
            isClosed: business.is_closed || false,
            source: 'Yelp Fusion API'
        }));

        return leads;

    } catch (error) {
        console.error('Yelp search error:', error.response?.data || error.message);
        throw new Error(`Failed to search Yelp: ${error.message}`);
    }
}

// Yelp Business Details (for verification)
async function getYelpBusinessDetails(yelpId) {
    try {
        const apiKey = process.env.YELP_API_KEY;

        if (!apiKey) {
            console.log('Yelp API key not configured');
            return null;
        }

        console.log(`Getting Yelp details for business: ${yelpId}`);

        const response = await axios.get(`https://api.yelp.com/v3/businesses/${yelpId}`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        const business = response.data;

        return {
            companyName: business.name,
            phone: business.phone || business.display_phone,
            address: business.location?.display_address?.join(', '),
            zipcode: business.location?.zip_code,
            city: business.location?.city,
            state: business.location?.state,
            country: business.location?.country,
            industry: business.categories?.[0]?.title,
            rating: business.rating,
            reviewCount: business.review_count,
            yelpCategories: business.categories?.map(c => c.title),
            imageUrl: business.image_url,
            photos: business.photos,
            price: business.price,
            hours: business.hours,
            isClosed: business.is_closed,
            yelpUrl: business.url,
            transactions: business.transactions,
            confidence: 95,
            source: 'Yelp Business Details'
        };

    } catch (error) {
        console.error('Yelp details error:', error.response?.data || error.message);
        return null;
    }
}

// Yelp Business Match (verify business exists)
async function verifyWithYelp(lead) {
    try {
        const apiKey = process.env.YELP_API_KEY;

        if (!apiKey) {
            console.log('Yelp API key not configured, skipping verification');
            return null;
        }

        console.log(`Verifying business with Yelp: ${lead.companyName}`);

        // Build match parameters
        const matchParams = {
            name: lead.companyName
        };

        // Add location data if available
        if (lead.address && lead.address !== 'N/A') {
            matchParams.address1 = lead.address.split(',')[0].trim();
        }
        if (lead.city && lead.city !== 'N/A') {
            matchParams.city = lead.city;
        }
        if (lead.state && lead.state !== 'N/A') {
            matchParams.state = lead.state;
        }
        if (lead.zipcode && lead.zipcode !== 'N/A') {
            matchParams.zip_code = lead.zipcode;
        }
        if (lead.country && lead.country !== 'N/A') {
            // Convert country name to 2-letter ISO code for Yelp
            let countryCode = lead.country;
            if (lead.country === 'United States' || lead.country === 'USA') {
                countryCode = 'US';
            } else if (lead.country === 'Canada') {
                countryCode = 'CA';
            } else if (lead.country === 'United Kingdom' || lead.country === 'UK') {
                countryCode = 'GB';
            } else if (lead.country === 'Australia') {
                countryCode = 'AU';
            } else if (lead.country.length > 2) {
                // If full country name, try to convert (add more mappings as needed)
                countryCode = 'US'; // Default to US if unknown
            }
            matchParams.country = countryCode;
        }
        if (lead.phone && lead.phone !== 'N/A') {
            matchParams.phone = lead.phone.replace(/[^\d+]/g, '');
        }

        // Check if we have enough data for a match
        const hasEnoughData = matchParams.name && (
            matchParams.address1 ||
            (matchParams.city && matchParams.state) ||
            matchParams.phone
        );

        if (!hasEnoughData) {
            console.log('Insufficient data for Yelp match');
            return null;
        }

        const response = await axios.get('https://api.yelp.com/v3/businesses/matches', {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            params: matchParams
        });

        if (response.data.businesses && response.data.businesses.length > 0) {
            const match = response.data.businesses[0];
            console.log(`✓ Yelp match found: ${match.name} (ID: ${match.id})`);

            // Get full details for the matched business
            const details = await getYelpBusinessDetails(match.id);

            return {
                yelpVerified: true,
                yelpId: match.id,
                yelpUrl: match.url || `https://www.yelp.com/biz/${match.id}`,
                ...details,
                confidence: 95
            };
        }

        console.log('No Yelp match found');
        return {
            yelpVerified: false,
            confidence: 0
        };

    } catch (error) {
        console.error('Yelp verification error:', error.response?.data || error.message);
        return null;
    }
}

// Apollo API Integration Functions

// Apollo Organization Search
async function searchApolloOrganizations(filters) {
    try {
        const apiKey = process.env.APOLLO_API_KEY;

        if (!apiKey) {
            console.error('Apollo API key not configured');
            throw new Error('Apollo API key not configured');
        }

        console.log('Searching Apollo organizations with filters:', filters);

        const requestBody = {};

        // Add filters
        if (filters.locations && filters.locations.length > 0) {
            requestBody.organization_locations = filters.locations;
        }
        if (filters.employeeRanges && filters.employeeRanges.length > 0) {
            requestBody.organization_num_employees_ranges = filters.employeeRanges;
        }
        if (filters.revenueMin || filters.revenueMax) {
            requestBody.revenue_range = {};
            if (filters.revenueMin) requestBody.revenue_range.min = filters.revenueMin;
            if (filters.revenueMax) requestBody.revenue_range.max = filters.revenueMax;
        }
        if (filters.technologies && filters.technologies.length > 0) {
            requestBody.currently_using_any_of_technology_uids = filters.technologies;
        }
        if (filters.keywords && filters.keywords.length > 0) {
            requestBody.q_organization_keyword_tags = filters.keywords;
        }
        if (filters.companyName) {
            requestBody.q_organization_name = filters.companyName;
        }

        // Pagination
        requestBody.page = filters.page || 1;
        requestBody.per_page = filters.perPage || 25;

        const response = await axios.post(
            'https://api.apollo.io/api/v1/mixed_companies/search',
            requestBody,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                    'X-Api-Key': apiKey
                }
            }
        );

        console.log(`Found ${response.data.organizations?.length || 0} organizations`);

        // Transform to our lead format
        const leads = (response.data.organizations || []).map(org => ({
            id: Date.now() + Math.random(),
            companyName: org.name,
            phone: org.phone || org.primary_phone?.number || 'N/A',
            address: org.raw_address || 'N/A',
            zipcode: org.postal_code || 'N/A',
            city: org.city || 'N/A',
            country: org.country || 'N/A',
            state: org.state || '',
            industry: org.industry || 'Business',
            website: org.website_url || 'N/A',
            employeeCount: org.estimated_num_employees || 'N/A',
            revenue: org.annual_revenue_printed || 'N/A',
            foundedYear: org.founded_year || 'N/A',
            technologies: org.technology_names || [],
            organizationId: org.id,
            linkedinUrl: org.linkedin_url,
            twitterUrl: org.twitter_url,
            facebookUrl: org.facebook_url,
            logoUrl: org.logo_url,
            source: 'Apollo Organizations'
        }));

        return leads;

    } catch (error) {
        console.error('Apollo Organizations search error:', error.response?.data || error.message);
        throw new Error(`Failed to search Apollo Organizations: ${error.message}`);
    }
}

// People Data Labs Person Search - Find company owners
async function findCompanyOwnerWithPDL(companyName, city = null, state = null, country = null) {
    try {
        const apiKey = process.env.PDL_API_KEY;

        if (!apiKey) {
            console.log('PDL API key not configured, skipping owner search');
            return null;
        }

        console.log(`Searching for owner of: ${companyName}${city ? ` in ${city}` : ''}`);

        // Build SQL query to find owners, CEOs, founders, presidents
        let sqlQuery = `SELECT * FROM person WHERE job_company_name='${companyName.replace(/'/g, "''")}'`;

        // Add location filters if available
        if (city) {
            sqlQuery += ` AND location_locality='${city.replace(/'/g, "''")}'`;
        }
        if (state) {
            sqlQuery += ` AND location_region='${state.replace(/'/g, "''")}'`;
        }
        if (country) {
            sqlQuery += ` AND location_country='${country.replace(/'/g, "''")}'`;
        }

        // Focus on decision-makers and owners
        sqlQuery += ` AND job_title_role IN ('owner', 'ceo', 'founder', 'president', 'partner', 'managing_director')`;

        // Order by most recent and limit results
        sqlQuery += ` ORDER BY job_start_date DESC LIMIT 10`;

        console.log('PDL SQL Query:', sqlQuery);

        const response = await axios.get(
            'https://api.peopledatalabs.com/v5/person/search',
            {
                params: {
                    sql: sqlQuery,
                    size: 10,
                    dataset: 'all',
                    pretty: true
                },
                headers: {
                    'X-Api-Key': apiKey,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data.data && response.data.data.length > 0) {
            console.log(`Found ${response.data.data.length} potential owners/decision-makers`);

            // Get the primary owner (first result, usually most relevant)
            const primaryOwner = response.data.data[0];

            // Extract best email (prefer professional over personal)
            let bestEmail = null;
            if (primaryOwner.emails && primaryOwner.emails.length > 0) {
                const professionalEmail = primaryOwner.emails.find(e => e.type === 'professional');
                const currentEmail = primaryOwner.emails.find(e => e.current === true);
                bestEmail = professionalEmail?.address || currentEmail?.address || primaryOwner.emails[0]?.address;
            }

            // Extract best phone
            let bestPhone = null;
            if (primaryOwner.phone_numbers && primaryOwner.phone_numbers.length > 0) {
                bestPhone = primaryOwner.phone_numbers[0];
            }

            const ownerData = {
                ownerName: primaryOwner.full_name,
                firstName: primaryOwner.first_name,
                lastName: primaryOwner.last_name,
                middleName: primaryOwner.middle_name,
                title: primaryOwner.job_title,
                titleRole: primaryOwner.job_title_role,
                email: bestEmail,
                personalEmails: primaryOwner.emails?.filter(e => e.type === 'personal').map(e => e.address) || [],
                professionalEmails: primaryOwner.emails?.filter(e => e.type === 'professional').map(e => e.address) || [],
                phone: bestPhone,
                allPhones: primaryOwner.phone_numbers || [],
                linkedinUrl: primaryOwner.linkedin_url,
                linkedinUsername: primaryOwner.linkedin_username,
                facebookUrl: primaryOwner.facebook_url,
                twitterUrl: primaryOwner.twitter_url,
                githubUrl: primaryOwner.github_url,
                location: primaryOwner.location_name,
                city: primaryOwner.location_locality,
                state: primaryOwner.location_region,
                country: primaryOwner.location_country,
                jobCompanyName: primaryOwner.job_company_name,
                jobCompanyWebsite: primaryOwner.job_company_website,
                jobCompanyIndustry: primaryOwner.job_company_industry,
                jobCompanySize: primaryOwner.job_company_size,
                jobStartDate: primaryOwner.job_start_date,
                skills: primaryOwner.skills || [],
                interests: primaryOwner.interests || [],
                experience: primaryOwner.experience || [],
                education: primaryOwner.education || [],
                allContacts: response.data.data, // All decision-makers found
                pdlPersonId: primaryOwner.id,
                confidence: 90, // High confidence from PDL
                source: 'People Data Labs Person Search'
            };

            console.log(`✓ Found primary owner: ${ownerData.ownerName} (${ownerData.title})`);
            if (bestEmail) console.log(`  Email: ${bestEmail}`);
            if (bestPhone) console.log(`  Phone: ${bestPhone}`);

            return ownerData;
        }

        console.log('No owners found in PDL database');
        return null;

    } catch (error) {
        console.error('PDL Person Search error:', error.response?.data || error.message);
        return null;
    }
}

// Apollo People Search
async function searchApolloPeople(filters) {
    try {
        const apiKey = process.env.APOLLO_API_KEY;

        if (!apiKey) {
            console.error('Apollo API key not configured');
            throw new Error('Apollo API key not configured');
        }

        console.log('Searching Apollo people with filters:', filters);

        const requestBody = {};

        // Add filters
        if (filters.titles && filters.titles.length > 0) {
            requestBody.person_titles = filters.titles;
        }
        if (filters.seniorities && filters.seniorities.length > 0) {
            requestBody.person_seniorities = filters.seniorities;
        }
        if (filters.locations && filters.locations.length > 0) {
            requestBody.person_locations = filters.locations;
        }
        if (filters.organizationLocations && filters.organizationLocations.length > 0) {
            requestBody.organization_locations = filters.organizationLocations;
        }
        if (filters.organizationIds && filters.organizationIds.length > 0) {
            requestBody.organization_ids = filters.organizationIds;
        }
        if (filters.domains && filters.domains.length > 0) {
            requestBody.q_organization_domains_list = filters.domains;
        }
        if (filters.employeeRanges && filters.employeeRanges.length > 0) {
            requestBody.organization_num_employees_ranges = filters.employeeRanges;
        }

        // Pagination
        requestBody.page = filters.page || 1;
        requestBody.per_page = filters.perPage || 25;

        const response = await axios.post(
            'https://api.apollo.io/api/v1/mixed_people/search',
            requestBody,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                    'X-Api-Key': apiKey
                }
            }
        );

        console.log(`Found ${response.data.contacts?.length || 0} people`);

        // Transform to our lead format
        const leads = (response.data.contacts || []).map(person => ({
            id: Date.now() + Math.random(),
            companyName: person.organization_name || person.organization?.name || 'N/A',
            ownerName: person.name || `${person.first_name} ${person.last_name}`,
            title: person.title || 'N/A',
            phone: person.sanitized_phone || person.phone_numbers?.[0]?.sanitized_number || 'N/A',
            email: person.email || 'N/A',
            emailStatus: person.email_status || 'unknown',
            address: person.organization?.raw_address || 'N/A',
            city: person.city || person.organization?.city || 'N/A',
            state: person.state || person.organization?.state || 'N/A',
            country: person.country || person.organization?.country || 'N/A',
            industry: person.organization?.industry || 'Business',
            linkedinUrl: person.linkedin_url,
            photoUrl: person.photo_url,
            personId: person.person_id || person.id,
            organizationId: person.organization_id,
            seniority: person.seniority,
            departments: person.departments || [],
            employmentHistory: person.employment_history || [],
            isLikelyToEngage: person.is_likely_to_engage || false,
            source: 'Apollo People'
        }));

        return leads;

    } catch (error) {
        console.error('Apollo People search error:', error.response?.data || error.message);
        throw new Error(`Failed to search Apollo People: ${error.message}`);
    }
}

// Hunter.io Email Finder
async function findEmailsWithHunter(lead) {
    try {
        const apiKey = process.env.HUNTER_API_KEY;

        if (!apiKey) {
            console.log('Hunter.io API key not configured, skipping email search');
            return null;
        }

        console.log(`Searching for emails with Hunter.io: ${lead.companyName}`);

        // Extract domain from website if available
        let domain = null;
        if (lead.website && lead.website !== 'N/A') {
            domain = lead.website
                .replace(/^https?:\/\//, '')
                .replace(/^www\./, '')
                .split('/')[0]
                .split('?')[0];
        }

        if (!domain) {
            console.log('No domain available for Hunter.io search');
            return null;
        }

        console.log(`Hunter.io domain search: ${domain}`);

        // Use Domain Search endpoint to find emails
        const response = await axios.get('https://api.hunter.io/v2/domain-search', {
            params: {
                domain: domain,
                api_key: apiKey,
                limit: 10
            }
        });

        const data = response.data.data;

        if (!data || !data.emails || data.emails.length === 0) {
            console.log('No emails found by Hunter.io');
            return null;
        }

        console.log(`Hunter.io found ${data.emails.length} email(s)`);

        // Find the most relevant email (owner, ceo, founder, etc.)
        const ownerEmail = data.emails.find(e =>
            e.position && (
                e.position.toLowerCase().includes('owner') ||
                e.position.toLowerCase().includes('ceo') ||
                e.position.toLowerCase().includes('founder') ||
                e.position.toLowerCase().includes('president') ||
                e.position.toLowerCase().includes('partner')
            )
        );

        const primaryEmail = ownerEmail || data.emails[0];

        return {
            domain: domain,
            organizationName: data.organization || lead.companyName,
            emails: data.emails.map(e => ({
                email: e.value,
                firstName: e.first_name,
                lastName: e.last_name,
                fullName: `${e.first_name} ${e.last_name}`.trim(),
                position: e.position,
                department: e.department,
                type: e.type,
                confidence: e.confidence
            })),
            primaryEmail: primaryEmail.value,
            ownerName: primaryEmail.first_name && primaryEmail.last_name
                ? `${primaryEmail.first_name} ${primaryEmail.last_name}`.trim()
                : null,
            ownerPosition: primaryEmail.position,
            ownerDepartment: primaryEmail.department,
            totalEmails: data.emails.length,
            confidence: primaryEmail.confidence || 0,
            source: 'Hunter.io Domain Search'
        };

    } catch (error) {
        console.error('Hunter.io email search error:', error.response?.data || error.message);
        return null;
    }
}

// Hunter.io Email Verifier
async function verifyEmailWithHunter(email) {
    try {
        const apiKey = process.env.HUNTER_API_KEY;

        if (!apiKey || !email || email === 'N/A') {
            return null;
        }

        console.log(`Verifying email with Hunter.io: ${email}`);

        const response = await axios.get('https://api.hunter.io/v2/email-verifier', {
            params: {
                email: email,
                api_key: apiKey
            }
        });

        const data = response.data.data;

        return {
            email: data.email,
            status: data.status, // valid, invalid, accept_all, webmail, disposable, unknown
            score: data.score, // 0-100
            result: data.result, // deliverable, undeliverable, risky, unknown
            regexp: data.regexp,
            gibberish: data.gibberish,
            disposable: data.disposable,
            webmail: data.webmail,
            mxRecords: data.mx_records,
            smtpServer: data.smtp_server,
            smtpCheck: data.smtp_check,
            acceptAll: data.accept_all,
            block: data.block,
            source: 'Hunter.io Email Verifier'
        };

    } catch (error) {
        console.error('Hunter.io email verification error:', error.response?.data || error.message);
        return null;
    }
}

// Numverify Phone Validation
async function validatePhoneWithNumverify(phoneNumber) {
    try {
        const apiKey = process.env.NUMVERIFY_API_KEY;

        if (!apiKey) {
            console.log('Numverify API key not configured, skipping phone validation');
            return null;
        }

        // Clean phone number - remove spaces, dashes, parentheses
        let cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');

        // Remove leading + or 00
        if (cleanPhone.startsWith('+')) {
            cleanPhone = cleanPhone.substring(1);
        } else if (cleanPhone.startsWith('00')) {
            cleanPhone = cleanPhone.substring(2);
        }

        console.log(`Validating phone with Numverify: ${cleanPhone}`);

        const response = await axios.get('http://apilayer.net/api/validate', {
            params: {
                access_key: apiKey,
                number: cleanPhone,
                format: 1
            }
        });

        const data = response.data;

        if (!data.valid) {
            console.log('Phone number is invalid');
            return {
                valid: false,
                number: phoneNumber,
                internationalFormat: phoneNumber
            };
        }

        console.log(`Phone validation successful: ${data.international_format}`);

        return {
            valid: data.valid,
            number: data.number,
            localFormat: data.local_format,
            internationalFormat: data.international_format,
            countryCode: data.country_code,
            countryName: data.country_name,
            location: data.location || 'N/A',
            carrier: data.carrier || 'N/A',
            lineType: data.line_type || 'N/A'
        };

    } catch (error) {
        console.error('Numverify validation error:', error.response?.data || error.message);
        return null;
    }
}

// Apollo People Enrichment
async function enrichWithApollo(lead) {
    try {
        const apiKey = process.env.APOLLO_API_KEY;

        if (!apiKey) {
            console.log('Apollo API key not configured, skipping enrichment');
            return null;
        }

        console.log(`Enriching lead with Apollo: ${lead.companyName || lead.ownerName}`);

        const requestBody = {};

        // Build enrichment request based on available data
        if (lead.email) {
            requestBody.email = lead.email;
        } else if (lead.ownerName) {
            const nameParts = lead.ownerName.split(' ');
            if (nameParts.length >= 2) {
                requestBody.first_name = nameParts[0];
                requestBody.last_name = nameParts.slice(1).join(' ');
            } else {
                requestBody.name = lead.ownerName;
            }
        }

        if (lead.companyName) {
            requestBody.organization_name = lead.companyName;
        }
        if (lead.website && lead.website !== 'N/A') {
            const domain = lead.website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
            requestBody.domain = domain;
        }
        if (lead.linkedinUrl) {
            requestBody.linkedin_url = lead.linkedinUrl;
        }

        // Check if we have enough data to make a request
        if (!requestBody.email && !requestBody.name && !requestBody.first_name && !requestBody.linkedin_url) {
            console.log('Insufficient data for Apollo enrichment');
            return null;
        }

        const response = await axios.post(
            'https://api.apollo.io/api/v1/people/match',
            requestBody,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                    'X-Api-Key': apiKey
                }
            }
        );

        const person = response.data.person;
        if (!person) {
            console.log('No match found in Apollo');
            return null;
        }

        console.log(`Apollo enrichment successful: ${person.name}`);

        // Return enriched data
        return {
            ownerName: person.name || lead.ownerName,
            title: person.title,
            email: person.email || lead.email,
            emailStatus: person.email_status,
            phone: person.employment_history?.[0]?.phone || lead.phone,
            companyName: person.organization?.name || lead.companyName,
            industry: person.organization?.industry || lead.industry,
            employeeCount: person.organization?.estimated_num_employees,
            revenue: person.organization?.annual_revenue_printed,
            city: person.city || lead.city,
            state: person.state || lead.state,
            country: person.country || lead.country,
            linkedinUrl: person.linkedin_url,
            twitterUrl: person.twitter_url,
            photoUrl: person.photo_url,
            seniority: person.seniority,
            departments: person.departments,
            employmentHistory: person.employment_history,
            confidence: 90,
            source: 'Apollo Enrichment',
            apolloPersonId: person.id,
            apolloOrganizationId: person.organization_id
        };

    } catch (error) {
        console.error('Apollo enrichment error:', error.response?.data || error.message);
        return null;
    }
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Text-based scraping endpoint
app.post('/api/scrape', async (req, res) => {
    try {
        const { query, location, zipcode, country, maxLeads, enrichWithApollo: shouldEnrichWithApollo, useApolloSearch } = req.body;

        if (!query || !location) {
            return res.status(400).json({
                error: 'Both query and location are required'
            });
        }

        console.log(`Starting scrape for: ${query} in ${location}${zipcode ? `, zipcode: ${zipcode}` : ''}${country ? `, country: ${country}` : ''}`);

        let results = [];
        let searchSource = 'Google Places';

        // Use Apollo Search API if requested
        if (useApolloSearch) {
            console.log('Using Apollo Search API as primary source');
            searchSource = 'Apollo Search';

            // Try Apollo Organization Search with auto-pagination
            try {
                const apolloFilters = {
                    locations: [location]
                };

                // Use keywords for generic industry searches, companyName for specific company searches
                if (query.toLowerCase().includes('company') || query.toLowerCase().includes('companies') ||
                    query.toLowerCase().includes('business') || query.toLowerCase().includes('businesses') ||
                    query.toLowerCase().includes('firm') || query.toLowerCase().includes('agency')) {
                    // Generic industry/keyword search
                    const keyword = query.toLowerCase()
                        .replace(/companies|company|businesses|business|firms|firm|agencies|agency/gi, '')
                        .trim();
                    if (keyword) {
                        apolloFilters.keywords = [keyword];
                    }
                } else {
                    // Specific company name search
                    apolloFilters.companyName = query;
                }

                if (zipcode) {
                    apolloFilters.locations.push(zipcode);
                }

                console.log('Apollo filters:', JSON.stringify(apolloFilters, null, 2));

                // Auto-pagination: Fetch multiple pages if needed
                const targetLeads = maxLeads || 25;
                const leadsPerPage = Math.min(100, targetLeads); // Max 100 per page
                const pagesNeeded = Math.ceil(targetLeads / leadsPerPage);

                console.log(`Target: ${targetLeads} leads, ${pagesNeeded} page(s) needed`);

                results = [];
                for (let page = 1; page <= pagesNeeded && results.length < targetLeads; page++) {
                    apolloFilters.page = page;
                    apolloFilters.perPage = leadsPerPage;

                    console.log(`Fetching Apollo page ${page}/${pagesNeeded}...`);
                    const pageResults = await searchApolloOrganizations(apolloFilters);
                    console.log(`Apollo page ${page} returned ${pageResults.length} organizations`);

                    results = results.concat(pageResults);

                    // Stop if we got fewer results than requested (no more available)
                    if (pageResults.length < leadsPerPage) {
                        console.log('Received fewer results than requested, no more pages available');
                        break;
                    }

                    // Add delay between pages to respect rate limits
                    if (page < pagesNeeded && results.length < targetLeads) {
                        await delay(500); // 500ms delay between pages
                    }
                }

                // Trim to exact target
                results = results.slice(0, targetLeads);
                console.log(`Apollo Search completed: ${results.length} organizations (target was ${targetLeads})`);

                // If no results and we used company name, try keywords instead
                if (results.length === 0 && apolloFilters.companyName) {
                    console.log('No results with company name, trying as keyword...');
                    delete apolloFilters.companyName;
                    apolloFilters.keywords = [query];
                    apolloFilters.page = 1;
                    results = await searchApolloOrganizations(apolloFilters);
                    console.log(`Apollo Search with keywords returned ${results.length} organizations`);
                }

            } catch (apolloError) {
                console.error('Apollo Search failed, falling back to Google Places:', apolloError.message);
                searchSource = 'Google Places (Apollo fallback)';
                results = await scrapeGoogleMaps(query, location, null, zipcode, country, maxLeads || 10);
            }
        } else {
            // Use Google Places as default
            results = await scrapeGoogleMaps(query, location, null, zipcode, country, maxLeads || 10);
        }

        // Optionally enrich with Apollo (if enabled and not already from Apollo)
        let enrichedResults = results;
        if (shouldEnrichWithApollo && !useApolloSearch) {
            console.log(`Enriching ${results.length} leads with Apollo...`);
            enrichedResults = await Promise.all(
                results.map(async (lead) => {
                    const apolloData = await enrichWithApollo(lead);
                    if (apolloData) {
                        return { ...lead, ...apolloData, apolloEnriched: true };
                    }
                    return lead;
                })
            );
            const enrichedCount = enrichedResults.filter(r => r.apolloEnriched).length;
            console.log(`Apollo enriched ${enrichedCount}/${results.length} leads`);
        }

        res.json({
            success: true,
            results: enrichedResults,
            count: enrichedResults.length,
            searchSource: searchSource,
            useApolloSearch: useApolloSearch || false,
            apolloEnriched: shouldEnrichWithApollo || false,
            apolloEnrichedCount: shouldEnrichWithApollo ? enrichedResults.filter(r => r.apolloEnriched).length : 0,
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
        const { query, area, zipcode, country, maxLeads, enrichWithApollo: shouldEnrichWithApollo, useApolloSearch } = req.body;

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

            // Optionally enrich with Apollo
            let enrichedResults = finalResults;
            if (shouldEnrichWithApollo) {
                console.log(`Enriching ${finalResults.length} leads with Apollo...`);
                enrichedResults = await Promise.all(
                    finalResults.map(async (lead) => {
                        const apolloData = await enrichWithApollo(lead);
                        if (apolloData) {
                            return { ...lead, ...apolloData, apolloEnriched: true };
                        }
                        return lead;
                    })
                );
                const enrichedCount = enrichedResults.filter(r => r.apolloEnriched).length;
                console.log(`Apollo enriched ${enrichedCount}/${finalResults.length} leads`);
            }

            res.json({
                success: true,
                results: enrichedResults,
                count: enrichedResults.length,
                apolloEnriched: shouldEnrichWithApollo || false,
                apolloEnrichedCount: shouldEnrichWithApollo ? enrichedResults.filter(r => r.apolloEnriched).length : 0,
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

            // Optionally enrich with Apollo
            let enrichedResults = results;
            if (shouldEnrichWithApollo) {
                console.log(`Enriching ${results.length} leads with Apollo...`);
                enrichedResults = await Promise.all(
                    results.map(async (lead) => {
                        const apolloData = await enrichWithApollo(lead);
                        if (apolloData) {
                            return { ...lead, ...apolloData, apolloEnriched: true };
                        }
                        return lead;
                    })
                );
                const enrichedCount = enrichedResults.filter(r => r.apolloEnriched).length;
                console.log(`Apollo enriched ${enrichedCount}/${results.length} leads`);
            }

            res.json({
                success: true,
                results: enrichedResults,
                count: enrichedResults.length,
                apolloEnriched: shouldEnrichWithApollo || false,
                apolloEnrichedCount: shouldEnrichWithApollo ? enrichedResults.filter(r => r.apolloEnriched).length : 0,
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

// AI verification endpoint (now with Apollo enrichment and phone validation)
app.post('/api/verify', async (req, res) => {
    try {
        const { lead, aiProvider } = req.body;

        if (!lead) {
            return res.status(400).json({
                error: 'Lead data is required'
            });
        }

        // Step 1: Try Apollo enrichment first
        console.log(`Enriching lead: ${lead.companyName || lead.ownerName}`);
        const apolloData = await enrichWithApollo(lead);

        // Merge Apollo data with original lead - Accept owner name from Apollo if available
        let enrichedLead = { ...lead };
        if (apolloData) {
            enrichedLead = {
                ...enrichedLead,
                ...apolloData,
                apolloEnriched: true
            };
            console.log('Apollo enrichment successful');
            if (apolloData.ownerName && apolloData.ownerName !== 'N/A') {
                console.log(`Apollo provided owner name: ${apolloData.ownerName}`);
            }
        } else {
            console.log('Apollo enrichment not available, will use AI only');
        }

        // Step 2: Try People Data Labs owner search
        console.log('Searching for company owner with PDL...');
        const pdlData = await findCompanyOwnerWithPDL(
            enrichedLead.companyName,
            enrichedLead.city,
            enrichedLead.state,
            enrichedLead.country
        );

        if (pdlData) {
            enrichedLead = {
                ...enrichedLead,
                ...pdlData,
                pdlEnriched: true
            };
            console.log('PDL enrichment successful');
        }

        // Step 3: Find emails with Hunter.io
        console.log('Searching for emails with Hunter.io...');
        const hunterData = await findEmailsWithHunter(enrichedLead);

        if (hunterData) {
            enrichedLead = {
                ...enrichedLead,
                ...hunterData,
                hunterEnriched: true
            };
            console.log('Hunter.io email search successful');
            if (hunterData.ownerName && hunterData.ownerName !== 'N/A') {
                console.log(`Hunter.io provided owner name: ${hunterData.ownerName}`);
            }
            if (hunterData.primaryEmail) {
                console.log(`Hunter.io found primary email: ${hunterData.primaryEmail}`);
            }
        }

        // Step 4: Validate phone number with Numverify
        if (enrichedLead.phone && enrichedLead.phone !== 'N/A') {
            console.log(`Validating phone number: ${enrichedLead.phone}`);
            const phoneValidation = await validatePhoneWithNumverify(enrichedLead.phone);
            if (phoneValidation) {
                enrichedLead.phoneValidation = phoneValidation;
                // Update phone to international format if valid
                if (phoneValidation.valid && phoneValidation.internationalFormat) {
                    enrichedLead.phoneFormatted = phoneValidation.internationalFormat;
                }
                console.log(`Phone validation complete - Valid: ${phoneValidation.valid}, Type: ${phoneValidation.lineType}`);
            }
        }

        // Step 5: Verify with Yelp
        console.log('Verifying business with Yelp...');
        const yelpData = await verifyWithYelp(enrichedLead);

        if (yelpData && yelpData.yelpVerified) {
            enrichedLead = {
                ...enrichedLead,
                ...yelpData,
                yelpEnriched: true
            };
            console.log('Yelp verification successful');
        }

        // Step 6: Use AI verification to supplement all data
        const provider = aiProvider || 'both';
        console.log(`Verifying lead with AI (mode: ${provider})`);

        const verifiedLead = await verifyLeadWithAI(enrichedLead, provider);

        res.json(verifiedLead);

    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({
            error: 'Failed to verify lead',
            message: error.message
        });
    }
});

// Apollo Organization Search endpoint
app.post('/api/apollo/organizations', async (req, res) => {
    try {
        const filters = req.body;

        console.log('Apollo Organizations search request:', filters);

        const results = await searchApolloOrganizations(filters);

        res.json({
            success: true,
            results: results,
            count: results.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Apollo Organizations search error:', error);
        res.status(500).json({
            error: 'Failed to search Apollo Organizations',
            message: error.message
        });
    }
});

// Apollo People Search endpoint
app.post('/api/apollo/people', async (req, res) => {
    try {
        const filters = req.body;

        console.log('Apollo People search request:', filters);

        const results = await searchApolloPeople(filters);

        res.json({
            success: true,
            results: results,
            count: results.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Apollo People search error:', error);
        res.status(500).json({
            error: 'Failed to search Apollo People',
            message: error.message
        });
    }
});

// People Data Labs - Find Company Owner endpoint
app.post('/api/pdl/find-owner', async (req, res) => {
    try {
        const { companyName, city, state, country } = req.body;

        if (!companyName) {
            return res.status(400).json({
                error: 'Company name is required'
            });
        }

        console.log(`Finding owner for company: ${companyName}`);

        const ownerData = await findCompanyOwnerWithPDL(companyName, city, state, country);

        if (!ownerData) {
            return res.status(404).json({
                error: 'No owner found',
                message: 'Could not find owner/decision-maker for this company in People Data Labs database'
            });
        }

        res.json({
            success: true,
            owner: ownerData,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('PDL find owner error:', error);
        res.status(500).json({
            error: 'Failed to find company owner',
            message: error.message
        });
    }
});

// Apollo Enrichment endpoint (standalone)
app.post('/api/apollo/enrich', async (req, res) => {
    try {
        const { lead } = req.body;

        if (!lead) {
            return res.status(400).json({
                error: 'Lead data is required'
            });
        }

        console.log('Apollo enrichment request:', lead.companyName || lead.ownerName);

        const enrichedData = await enrichWithApollo(lead);

        if (!enrichedData) {
            return res.status(404).json({
                error: 'No enrichment data found',
                message: 'Apollo could not find a match for this lead'
            });
        }

        res.json({
            success: true,
            data: enrichedData,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Apollo enrichment error:', error);
        res.status(500).json({
            error: 'Failed to enrich with Apollo',
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

// Helper function to clean and validate phone number
function cleanPhoneNumber(phone) {
    if (!phone || phone === 'N/A') return 'N/A';

    // Remove any text that's not a phone number
    // Phone numbers should contain digits, spaces, dashes, parentheses, plus signs
    const phonePattern = /[\d\s\-\(\)\+\.]/g;
    const matches = phone.match(phonePattern);

    if (!matches) return 'N/A';

    const cleaned = matches.join('').trim();

    // Check if it looks like a phone number (has at least 7 digits)
    const digitCount = (cleaned.match(/\d/g) || []).length;
    if (digitCount < 7) return 'N/A';

    return cleaned;
}

// Helper function to clean and validate zipcode
function cleanZipcode(zipcode) {
    if (!zipcode || zipcode === 'N/A') return 'N/A';

    // Remove anything that's not digits, letters, spaces, or dashes
    let cleaned = zipcode.replace(/[^0-9A-Za-z\s\-]/g, '').trim();

    // Zipcodes should be short (US: 5 or 9 digits, Canada: 6 chars, UK: 6-8 chars)
    // If longer than 15 characters, it's probably not a zipcode
    if (cleaned.length > 15) return 'N/A';

    // If it contains full words like "United States", it's not a zipcode
    if (cleaned.match(/United|States|America|Canada|Kingdom|City|County|Street|Avenue|Road/i)) {
        return 'N/A';
    }

    return cleaned;
}

// Helper function to clean and validate address
function cleanAddress(address) {
    if (!address || address === 'N/A') return 'N/A';

    const cleaned = address.trim();

    // Check if it looks like a phone number (too many digits relative to length)
    const digitCount = (cleaned.match(/\d/g) || []).length;
    const totalLength = cleaned.length;

    // If more than 40% digits and less than 30 chars, it's probably a phone number
    if (digitCount > 7 && (digitCount / totalLength) > 0.4 && totalLength < 30) {
        return 'N/A';
    }

    // Check for phone number patterns
    const phonePatterns = [
        /^\+?1?\s*\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}$/,  // US phone format
        /^\(\d{3}\)\s*\d{3}[\s\-]?\d{4}$/,  // (555) 555-5555
        /^\d{3}[\s\-]\d{3}[\s\-]\d{4}$/,  // 555-555-5555
        /^\+\d{1,3}[\s\-]?\d{3,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4}$/  // International
    ];

    for (const pattern of phonePatterns) {
        if (pattern.test(cleaned)) {
            return 'N/A';
        }
    }

    // Check if it looks like a person's name (2-3 words, each capitalized, no numbers or street indicators)
    const words = cleaned.split(/\s+/);
    const hasStreetIndicators = /Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Circle|Place|Pl|Square|Sq|Parkway|Pkwy|\d+/i.test(cleaned);

    // If it's 2-4 words, all capitalized, no street indicators and no numbers, it's likely a name
    if (words.length >= 2 && words.length <= 4 && !hasStreetIndicators) {
        const allCapitalized = words.every(word => /^[A-Z][a-z]+$/.test(word));
        if (allCapitalized) {
            return 'N/A';
        }
    }

    // Check if it's too short to be a real address (less than 10 chars)
    if (cleaned.length < 10) {
        return 'N/A';
    }

    return cleaned;
}

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

    // Clean and validate the extracted data
    const cleanedPhone = cleanPhoneNumber(details.formatted_phone_number || details.international_phone_number);
    const cleanedZipcode = cleanZipcode(extractedZipcode);
    const cleanedAddress = cleanAddress(details.formatted_address);

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
        phone: cleanedPhone,
        address: cleanedAddress,
        zipcode: cleanedZipcode,
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

    // Check if Apollo key is configured and valid (not a placeholder)
    const apolloKey = process.env.APOLLO_API_KEY;
    const apolloConfigured = apolloKey &&
        apolloKey.trim() !== '' &&
        !apolloKey.includes('your_apollo') &&
        !apolloKey.includes('api_key_here') &&
        apolloKey.trim().length > 10;

    // Check if Numverify key is configured and valid (not a placeholder)
    const numverifyKey = process.env.NUMVERIFY_API_KEY;
    const numverifyConfigured = numverifyKey &&
        numverifyKey.trim() !== '' &&
        !numverifyKey.includes('your_numverify') &&
        !numverifyKey.includes('api_key_here') &&
        numverifyKey.trim().length > 10;

    // Check if People Data Labs key is configured and valid (not a placeholder)
    const pdlKey = process.env.PDL_API_KEY;
    const pdlConfigured = pdlKey &&
        pdlKey.trim() !== '' &&
        !pdlKey.includes('your_pdl') &&
        !pdlKey.includes('api_key_here') &&
        pdlKey.trim().length > 20;

    // Check if Hunter.io key is configured and valid (not a placeholder)
    const hunterKey = process.env.HUNTER_API_KEY;
    const hunterConfigured = hunterKey &&
        hunterKey.trim() !== '' &&
        !hunterKey.includes('your_hunter') &&
        !hunterKey.includes('api_key_here') &&
        hunterKey.trim().length > 20;

    // Check if Yelp key is configured and valid (not a placeholder)
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
        recommendation: !openaiConfigured && !claudeConfigured
            ? 'Configure at least one AI API key in the .env file for enhanced lead verification'
            : 'All services ready'
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
