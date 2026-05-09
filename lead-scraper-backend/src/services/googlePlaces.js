'use strict';

const axios = require('axios');
const { delay, calculateAreaCenter } = require('../utils/geoHelpers');
const { cleanPhoneNumber, cleanZipcode, cleanAddress } = require('../utils/textCleaners');

async function forwardGeocode(location) {
    try {
        const apiKey = process.env.GOOGLE_PLACES_API_KEY;
        if (!apiKey) return null;
        const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
            params: { address: location, key: apiKey }
        });
        if (response.data.status === 'OK' && response.data.results.length > 0) {
            const loc = response.data.results[0].geometry.location;
            return { lat: loc.lat, lng: loc.lng };
        }
        return null;
    } catch (error) {
        console.error('Forward geocoding error:', error.message);
        return null;
    }
}

function generateSearchGrid(center, numCells) {
    const degPerKm = 1 / 111;
    const lngDegPerKm = degPerKm / Math.cos(center.lat * Math.PI / 180);
    const cellSizeKm = 6;

    if (numCells <= 1) {
        const halfLat = (cellSizeKm / 2) * degPerKm;
        const halfLng = (cellSizeKm / 2) * lngDegPerKm;
        return [{
            south: center.lat - halfLat,
            north: center.lat + halfLat,
            west: center.lng - halfLng,
            east: center.lng + halfLng
        }];
    }

    const side = Math.ceil(Math.sqrt(numCells));
    const totalWidthKm = side * cellSizeKm;
    const startLat = center.lat - ((totalWidthKm / 2) * degPerKm);
    const startLng = center.lng - ((totalWidthKm / 2) * lngDegPerKm);

    const cells = [];
    for (let row = 0; row < side && cells.length < numCells; row++) {
        for (let col = 0; col < side && cells.length < numCells; col++) {
            cells.push({
                south: startLat + (row * cellSizeKm * degPerKm),
                north: startLat + ((row + 1) * cellSizeKm * degPerKm),
                west: startLng + (col * cellSizeKm * lngDegPerKm),
                east: startLng + ((col + 1) * cellSizeKm * lngDegPerKm)
            });
        }
    }

    return cells;
}

async function scrapeGoogleMapsSingle(query, location, area, zipcode, country, maxLeads, restriction = null) {
    const mode = (process.env.GOOGLE_PLACES_MODE || 'legacy').toLowerCase();
    if (mode === 'new') {
        try {
            return await scrapeGoogleMapsNew(query, location, area, zipcode, country, maxLeads, restriction);
        } catch (err) {
            console.warn(`[Places API] New API failed (${err.message}), falling back to legacy`);
            return scrapeGoogleMapsLegacy(query, location, area, zipcode, country, maxLeads);
        }
    }
    return scrapeGoogleMapsLegacy(query, location, area, zipcode, country, maxLeads);
}

async function scrapeGoogleMaps(query, location, area = null, zipcode = null, country = null, maxLeads = 60) {
    const GOOGLE_PAGE_LIMIT = 60;

    if (maxLeads <= GOOGLE_PAGE_LIMIT) {
        console.log(`[Places API] Single search for: "${query}" (maxLeads: ${maxLeads})`);
        return scrapeGoogleMapsSingle(query, location, area, zipcode, country, maxLeads);
    }

    const numCells = Math.ceil((maxLeads * 1.5) / GOOGLE_PAGE_LIMIT);
    console.log(`[Places API] Auto-subdividing: "${query}" into ${numCells} grid cells for ${maxLeads} leads`);

    let center = null;
    if (area && area.type) {
        center = calculateAreaCenter(area);
    }
    if (!center) {
        const geoQuery = [location, zipcode, country].filter(Boolean).join(' ');
        if (geoQuery) {
            center = await forwardGeocode(geoQuery);
        }
    }

    if (!center) {
        console.warn('[Places API] Could not determine center for grid subdivision, falling back to single search');
        return scrapeGoogleMapsSingle(query, location, area, zipcode, country, maxLeads);
    }

    const gridCells = generateSearchGrid(center, numCells);
    const leadsPerCell = GOOGLE_PAGE_LIMIT;
    const allResults = [];
    const seenPlaceIds = new Set();

    for (let i = 0; i < gridCells.length; i++) {
        const cell = gridCells[i];
        try {
            const cellResults = await scrapeGoogleMapsSingle(query, location, area, zipcode, country, leadsPerCell, cell);
            for (const result of cellResults) {
                const id = result.placeId || `${result.companyName}-${result.address}`;
                if (!seenPlaceIds.has(id)) {
                    seenPlaceIds.add(id);
                    allResults.push(result);
                }
            }
        } catch (err) {
            console.error(`[Grid ${i + 1}/${gridCells.length}] Failed: ${err.message}`);
        }

        if (allResults.length >= maxLeads) break;
        if (i < gridCells.length - 1) await delay(500);
    }

    return allResults.slice(0, maxLeads);
}

async function scrapeGoogleMapsLegacy(query, location, area = null, zipcode = null, country = null, maxLeads = 60) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
        console.error('Google Places API key not configured');
        throw new Error('Google Places API key not configured');
    }

    let locationBias = null;
    if (area && area.type) {
        const center = calculateAreaCenter(area);
        if (center) {
            locationBias = `point:${center.lat},${center.lng}`;
        }
    }

    let effectiveQuery = query;
    if (query.toLowerCase() === 'all' || query.toLowerCase() === 'any') {
        effectiveQuery = 'business';
    }

    let searchQuery;
    if (location && !area) {
        searchQuery = `${effectiveQuery} in ${location}`;
    } else if (location && area) {
        searchQuery = `${effectiveQuery} in ${location}`;
    } else {
        searchQuery = effectiveQuery;
    }

    if (zipcode) searchQuery += ` ${zipcode}`;
    if (country) searchQuery += ` ${country}`;

    const textSearchUrl = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
    const searchParams = {
        query: searchQuery,
        key: apiKey
    };

    if (locationBias) {
        searchParams.locationbias = locationBias;
        if (area && area.radius) {
            searchParams.radius = Math.min(area.radius, 100000);
        } else {
            searchParams.radius = 20000;
        }
    }

    let allPlaces = [];
    let nextPageToken = null;
    let pageCount = 0;
    const maxPages = 3;

    do {
        pageCount++;
        const requestParams = { ...searchParams };
        if (nextPageToken) {
            requestParams.pagetoken = nextPageToken;
            delete requestParams.query;
            delete requestParams.locationbias;
            delete requestParams.radius;
        }

        let textSearchResponse;
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            textSearchResponse = await axios.get(textSearchUrl, { params: requestParams });

            if (textSearchResponse.data.status === 'INVALID_REQUEST' && nextPageToken && attempt < maxRetries) {
                await delay(attempt * 2000);
                continue;
            }
            break;
        }

        if (textSearchResponse.data.status !== 'OK' && textSearchResponse.data.status !== 'ZERO_RESULTS') {
            if (allPlaces.length > 0) break;
            throw new Error(`Google Places API error: ${textSearchResponse.data.status}`);
        }

        if (textSearchResponse.data.results.length === 0) break;

        allPlaces = allPlaces.concat(textSearchResponse.data.results);
        nextPageToken = textSearchResponse.data.next_page_token;

        if (allPlaces.length >= maxLeads) break;
        if (pageCount >= maxPages) break;
        if (nextPageToken) await delay(3000);

    } while (nextPageToken && allPlaces.length < maxLeads);

    if (allPlaces.length < maxLeads * 0.3 && locationBias) {
        try {
            const broadResponse = await axios.get(textSearchUrl, {
                params: { query: searchQuery, key: apiKey }
            });

            if (broadResponse.data.status === 'OK' && broadResponse.data.results.length > 0) {
                const existingPlaceIds = new Set(allPlaces.map(p => p.place_id));
                const newPlaces = broadResponse.data.results.filter(p => !existingPlaceIds.has(p.place_id));
                allPlaces = allPlaces.concat(newPlaces);
            }
        } catch (broadError) {
            console.error('Broader search failed:', broadError.message);
        }
    }

    if (allPlaces.length === 0) return [];

    const results = [];
    const places = allPlaces.slice(0, maxLeads);

    for (const place of places) {
        try {
            const detailsUrl = 'https://maps.googleapis.com/maps/api/place/details/json';
            const detailsResponse = await axios.get(detailsUrl, {
                params: {
                    place_id: place.place_id,
                    fields: 'name,formatted_address,formatted_phone_number,international_phone_number,website,rating,user_ratings_total,reviews,types,geometry,address_components',
                    key: apiKey
                }
            });

            if (detailsResponse.data.status === 'OK') {
                results.push(convertPlaceDetailsToLead(detailsResponse.data.result, place.place_id));
            }
            await delay(100);
        } catch (detailError) {
            console.error('Error fetching place details:', detailError.message);
        }
    }

    return results;
}

async function scrapeGoogleMapsNew(query, location, area = null, zipcode = null, country = null, maxLeads = 60, restriction = null) {
    const apiKey = process.env.GOOGLE_PLACES_NEW_API_KEY || process.env.GOOGLE_PLACES_API_KEY;

    if (!apiKey) {
        throw new Error('Google Places API key not configured');
    }

    let effectiveQuery = query;
    if (query.toLowerCase() === 'all' || query.toLowerCase() === 'any') {
        effectiveQuery = 'business';
    }

    let searchQuery;
    if (restriction) {
        searchQuery = effectiveQuery;
    } else if (location && !area) {
        searchQuery = `${effectiveQuery} in ${location}`;
    } else if (location && area) {
        searchQuery = `${effectiveQuery} in ${location}`;
    } else {
        searchQuery = effectiveQuery;
    }

    if (!restriction) {
        if (zipcode) searchQuery += ` ${zipcode}`;
        if (country) searchQuery += ` ${country}`;
    }

    const textSearchUrl = 'https://places.googleapis.com/v1/places:searchText';
    let locationRestriction;
    let locationBias;

    if (restriction) {
        locationRestriction = {
            rectangle: {
                low: { latitude: restriction.south, longitude: restriction.west },
                high: { latitude: restriction.north, longitude: restriction.east }
            }
        };
    } else if (area && area.type) {
        const center = calculateAreaCenter(area);
        if (center) {
            locationBias = {
                circle: {
                    center: { latitude: center.lat, longitude: center.lng },
                    radius: (area.radius ? Math.min(area.radius, 50000) : 20000)
                }
            };
        }
    }

    let allPlaces = [];
    let nextPageToken = null;
    let pageCount = 0;
    const maxPages = 3;
    const pageSize = 20;

    do {
        pageCount++;

        const requestBody = {
            textQuery: searchQuery,
            pageSize
        };

        if (locationRestriction) {
            requestBody.locationRestriction = locationRestriction;
        } else if (locationBias) {
            requestBody.locationBias = locationBias;
        }

        if (nextPageToken) {
            requestBody.pageToken = nextPageToken;
        }

        const response = await axios.post(textSearchUrl, requestBody, {
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': 'places.name,places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.types,places.location,places.addressComponents,nextPageToken'
            }
        });

        const places = response.data.places || [];
        if (places.length === 0) break;

        allPlaces = allPlaces.concat(places);
        nextPageToken = response.data.nextPageToken || null;

        if (allPlaces.length >= maxLeads) break;
        if (pageCount >= maxPages) break;
        if (nextPageToken) await delay(1000);

    } while (nextPageToken && allPlaces.length < maxLeads);

    if (allPlaces.length === 0) return [];

    const slice = allPlaces.slice(0, maxLeads);
    const fetchReviews = newApiFetchReviewsEnabled();
    const results = [];

    for (const place of slice) {
        const lead = convertNewPlaceToLead(place);
        if (!lead) continue;

        if (fetchReviews) {
            const placeRef = place.name || place.id;
            if (placeRef) {
                const excerpts = await fetchNewPlaceReviewExcerpts(placeRef, apiKey);
                if (excerpts.length > 0) {
                    lead.googleReviewExcerpts = excerpts;
                }
                await delay(100);
            }
        }

        results.push(lead);
    }

    return results;
}

/** Max review texts attached to a lead for downstream AI (Places Details returns up to 5). */
const MAX_GOOGLE_REVIEW_EXCERPTS = 5;
const MAX_GOOGLE_REVIEW_CHARS = 600;

function newApiFetchReviewsEnabled() {
    const v = process.env.GOOGLE_PLACES_NEW_FETCH_REVIEWS;
    if (v === undefined || v === '') return true;
    return !/^0|false|no|off$/i.test(String(v).trim());
}

/** Reviews from Place Details (New) JSON body (`reviews[].text.text`). */
function excerptReviewsFromNewApiPlace(placeObj) {
    const reviews = placeObj.reviews;
    if (!Array.isArray(reviews) || reviews.length === 0) return [];
    return reviews.slice(0, MAX_GOOGLE_REVIEW_EXCERPTS).map((r) => {
        const t = r.text && r.text.text != null ? String(r.text.text).trim() : '';
        if (!t) return null;
        return t.length > MAX_GOOGLE_REVIEW_CHARS ? `${t.slice(0, MAX_GOOGLE_REVIEW_CHARS)}…` : t;
    }).filter(Boolean);
}

/**
 * Place Details (New): GET places/{id} with reviews only — supplies googleReviewExcerpts for strict AI
 * (text search alone does not return review bodies).
 */
async function fetchNewPlaceReviewExcerpts(placeResourceId, apiKey) {
    if (!placeResourceId || !apiKey) return [];
    let pid = String(placeResourceId).trim();
    if (pid.startsWith('places/')) {
        pid = pid.slice('places/'.length);
    }
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(pid)}`;
    try {
        const { data } = await axios.get(url, {
            headers: {
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': 'reviews'
            }
        });
        return excerptReviewsFromNewApiPlace(data);
    } catch (e) {
        const st = e.response && e.response.status;
        console.warn(`[Places API New] review excerpts fetch failed (${st || '??'}) for ${pid}: ${e.message}`);
        return [];
    }
}

function excerptGoogleReviews(details) {
    const reviews = details.reviews;
    if (!Array.isArray(reviews) || reviews.length === 0) return [];
    return reviews.slice(0, MAX_GOOGLE_REVIEW_EXCERPTS).map((r) => {
        const t = String(r.text || '').trim();
        if (!t) return null;
        return t.length > MAX_GOOGLE_REVIEW_CHARS ? `${t.slice(0, MAX_GOOGLE_REVIEW_CHARS)}…` : t;
    }).filter(Boolean);
}

function convertNewPlaceToLead(place) {
    const addressComponents = place.addressComponents || [];
    let extractedZipcode = '';
    let extractedCity = '';
    let extractedCountry = '';
    let extractedState = '';

    addressComponents.forEach(component => {
        const types = component.types || [];
        if (types.includes('postal_code')) {
            extractedZipcode = component.longText || component.shortText || '';
        }
        if (types.includes('locality')) {
            extractedCity = component.longText || '';
        }
        if (types.includes('country')) {
            extractedCountry = component.longText || '';
        }
        if (types.includes('administrative_area_level_1')) {
            extractedState = component.shortText || '';
        }
    });

    const types = place.types || [];
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
        companyName: place.displayName?.text || 'N/A',
        phone: cleanPhoneNumber(place.nationalPhoneNumber || place.internationalPhoneNumber),
        address: cleanAddress(place.formattedAddress || ''),
        zipcode: cleanZipcode(extractedZipcode),
        city: extractedCity || 'N/A',
        country: extractedCountry || 'N/A',
        state: extractedState || '',
        industry,
        website: place.websiteUri || 'N/A',
        rating: place.rating || 'N/A',
        reviewCount: place.userRatingCount || 0,
        latitude: place.location?.latitude || null,
        longitude: place.location?.longitude || null,
        placeId: place.id || null,
        types,
        source: 'Google Places API (New)'
    };
}

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
        phone: cleanPhoneNumber(details.formatted_phone_number || details.international_phone_number),
        address: cleanAddress(details.formatted_address),
        zipcode: cleanZipcode(extractedZipcode),
        city: extractedCity || 'N/A',
        country: extractedCountry || 'N/A',
        state: extractedState || '',
        industry,
        website: details.website || 'N/A',
        rating: details.rating || 'N/A',
        reviewCount: details.user_ratings_total || 0,
        latitude: details.geometry?.location?.lat || null,
        longitude: details.geometry?.location?.lng || null,
        placeId: placeId,
        types,
        googleReviewExcerpts: excerptGoogleReviews(details),
        source: 'Google Places API'
    };
}

async function reverseGeocode(lat, lng) {
    try {
        const apiKey = process.env.GOOGLE_PLACES_API_KEY;

        if (!apiKey) {
            console.error('Google API key not available for reverse geocoding');
            return null;
        }

        const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
            params: {
                latlng: `${lat},${lng}`,
                key: apiKey
            }
        });

        if (response.data.status === 'OK' && response.data.results.length > 0) {
            const result = response.data.results[0];

            let city = '';
            let state = '';
            let countryName = '';

            result.address_components.forEach(component => {
                if (component.types.includes('locality')) {
                    city = component.long_name;
                } else if (component.types.includes('administrative_area_level_1')) {
                    state = component.short_name;
                } else if (component.types.includes('country')) {
                    countryName = component.long_name;
                }
            });

            let locationString = '';
            if (city) locationString += city;
            if (state && locationString) locationString += `, ${state}`;
            if (countryName && locationString) locationString += `, ${countryName}`;

            return locationString || result.formatted_address;
        }

        return null;
    } catch (error) {
        console.error('Reverse geocoding error:', error.message);
        return null;
    }
}

/**
 * If lead came from Places API (New) text search, it often has no review text. Fetch reviews once before strict AI.
 */
async function hydrateNewPlaceReviewsIfNeeded(lead) {
    if (!lead || !newApiFetchReviewsEnabled()) return lead;
    if (Array.isArray(lead.googleReviewExcerpts) && lead.googleReviewExcerpts.length > 0) {
        return lead;
    }
    const src = String(lead.source || '');
    if (!src.includes('Google Places API (New)')) return lead;
    const pid = lead.placeId;
    if (!pid || pid === 'N/A') return lead;
    const apiKey = process.env.GOOGLE_PLACES_NEW_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return lead;
    const excerpts = await fetchNewPlaceReviewExcerpts(pid, apiKey);
    if (!excerpts.length) return lead;
    return { ...lead, googleReviewExcerpts: excerpts };
}

module.exports = {
    scrapeGoogleMaps,
    scrapeGoogleMapsLegacy,
    scrapeGoogleMapsNew,
    convertPlaceDetailsToLead,
    convertNewPlaceToLead,
    hydrateNewPlaceReviewsIfNeeded,
    calculateAreaCenter,
    reverseGeocode,
    delay,
    forwardGeocode,
    generateSearchGrid
};
