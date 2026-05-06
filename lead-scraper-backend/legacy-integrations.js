/**
 * Phase 2+ legacy HTTP routes and integrations (Apollo, Yelp, Numverify,
 * standalone Hunter verifier). Default Phase 1 pipeline does NOT use these.
 */

'use strict';

const axios = require('axios');

async function searchYelpBusinesses(query, location, latitude = null, longitude = null, radius = 5000, limit = 50) {
    const apiKey = process.env.YELP_API_KEY;
    if (!apiKey) throw new Error('Yelp API key not configured');

    const searchParams = {
        term: query,
        limit: Math.min(limit, 50)
    };

    if (latitude && longitude) {
        searchParams.latitude = latitude;
        searchParams.longitude = longitude;
        searchParams.radius = Math.min(radius, 40000);
    } else if (location) {
        searchParams.location = location;
    } else {
        throw new Error('Either location string or coordinates required');
    }

    const response = await axios.get('https://api.yelp.com/v3/businesses/search', {
        headers: { Authorization: `Bearer ${apiKey}` },
        params: searchParams
    });

    return (response.data.businesses || []).map(business => ({
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
}

async function getYelpBusinessDetails(yelpId) {
    const apiKey = process.env.YELP_API_KEY;
    if (!apiKey) return null;

    const response = await axios.get(`https://api.yelp.com/v3/businesses/${yelpId}`, {
        headers: { Authorization: `Bearer ${apiKey}` }
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
}

async function verifyWithYelp(lead) {
    try {
        const apiKey = process.env.YELP_API_KEY;
        if (!apiKey) return null;

        const matchParams = {
            name: lead.companyName
        };

        if (lead.address && lead.address !== 'N/A') {
            matchParams.address1 = lead.address.split(',')[0].trim();
        }
        if (lead.city && lead.city !== 'N/A') matchParams.city = lead.city;
        if (lead.state && lead.state !== 'N/A') matchParams.state = lead.state;
        if (lead.zipcode && lead.zipcode !== 'N/A') matchParams.zip_code = lead.zipcode;
        if (lead.country && lead.country !== 'N/A') {
            let countryCode = lead.country;
            if (lead.country === 'United States' || lead.country === 'USA') countryCode = 'US';
            else if (lead.country === 'Canada') countryCode = 'CA';
            else if (lead.country === 'United Kingdom' || lead.country === 'UK') countryCode = 'GB';
            else if (lead.country === 'Australia') countryCode = 'AU';
            else if (lead.country.length > 2) countryCode = 'US';
            matchParams.country = countryCode;
        }
        if (lead.phone && lead.phone !== 'N/A') {
            matchParams.phone = lead.phone.replace(/[^\d+]/g, '');
        }

        const hasEnoughData = matchParams.name && (
            matchParams.address1 ||
            (matchParams.city && matchParams.state) ||
            matchParams.phone
        );

        if (!hasEnoughData) return null;

        const response = await axios.get('https://api.yelp.com/v3/businesses/matches', {
            headers: { Authorization: `Bearer ${apiKey}` },
            params: matchParams
        });

        if (response.data.businesses && response.data.businesses.length > 0) {
            const match = response.data.businesses[0];
            const details = await getYelpBusinessDetails(match.id);

            return {
                yelpVerified: true,
                yelpId: match.id,
                yelpUrl: match.url || `https://www.yelp.com/biz/${match.id}`,
                ...details,
                confidence: 95
            };
        }

        return { yelpVerified: false, confidence: 0 };
    } catch (error) {
        console.error('Yelp verification error:', error.response?.data || error.message);
        return null;
    }
}

async function validatePhoneWithNumverify(phoneNumber) {
    try {
        const apiKey = process.env.NUMVERIFY_API_KEY;
        if (!apiKey) return null;

        let cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');
        if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
        else if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2);

        const response = await axios.get('http://apilayer.net/api/validate', {
            params: {
                access_key: apiKey,
                number: cleanPhone,
                format: 1
            }
        });

        const data = response.data;

        if (!data.valid) {
            return {
                valid: false,
                number: phoneNumber,
                internationalFormat: phoneNumber
            };
        }

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

async function searchApolloOrganizations(filters) {
    const apiKey = process.env.APOLLO_API_KEY;

    if (!apiKey) {
        console.error('Apollo API key not configured');
        throw new Error('Apollo API key not configured');
    }

    const requestBody = {};

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
}

async function searchApolloPeople(filters) {
    const apiKey = process.env.APOLLO_API_KEY;

    if (!apiKey) {
        console.error('Apollo API key not configured');
        throw new Error('Apollo API key not configured');
    }

    const requestBody = {};

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

    return (response.data.contacts || []).map(person => ({
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
}

async function enrichWithApollo(lead) {
    try {
        const apiKey = process.env.APOLLO_API_KEY;

        if (!apiKey) {
            return null;
        }

        const requestBody = {};

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

        if (!requestBody.email && !requestBody.name && !requestBody.first_name && !requestBody.linkedin_url) {
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
            return null;
        }

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

async function verifyEmailWithHunter(email) {
    try {
        const apiKey = process.env.HUNTER_API_KEY;

        if (!apiKey || !email || email === 'N/A') {
            return null;
        }

        const response = await axios.get('https://api.hunter.io/v2/email-verifier', {
            params: {
                email,
                api_key: apiKey
            }
        });

        const data = response.data.data;

        return {
            email: data.email,
            status: data.status,
            score: data.score,
            result: data.result,
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

/** Register standalone routes not used by Phase 1 default pipeline */
function registerLegacyRoutes(app, { findCompanyOwnerWithPDL }) {
    app.post('/api/apollo/organizations', async (req, res) => {
        try {
            const filters = req.body;
            const results = await searchApolloOrganizations(filters);

            res.json({
                success: true,
                results,
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

    app.post('/api/apollo/people', async (req, res) => {
        try {
            const filters = req.body;
            const results = await searchApolloPeople(filters);

            res.json({
                success: true,
                results,
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

    app.post('/api/apollo/enrich', async (req, res) => {
        try {
            const { lead } = req.body;

            if (!lead) {
                return res.status(400).json({
                    error: 'Lead data is required'
                });
            }

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

    app.post('/api/pdl/find-owner', async (req, res) => {
        try {
            const { companyName, city, state, country } = req.body;

            if (!companyName) {
                return res.status(400).json({
                    error: 'Company name is required'
                });
            }

            const ownerData = await findCompanyOwnerWithPDL(companyName, city, state, country, 10);

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

    app.post('/api/legacy/hunter/email-verifier', async (req, res) => {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({
                    error: 'Email required'
                });
            }

            const data = await verifyEmailWithHunter(email);

            if (!data) {
                return res.status(503).json({ error: 'Hunter verifier unavailable or not configured' });

            }

            res.json({
                success: true,
                data,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Hunter email verification error:', error);
            res.status(500).json({
                error: 'Failed email verification',
                message: error.message
            });
        }
    });

    app.post('/api/legacy/yelp/search', async (req, res) => {
        try {
            const { query, location, latitude, longitude, radius, limit } = req.body;
            const leads = await searchYelpBusinesses(query, location, latitude, longitude, radius || 5000, limit || 50);

            res.json({
                success: true,
                results: leads,
                count: leads.length,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Yelp search error:', error);
            res.status(500).json({
                error: 'Failed Yelp search',
                message: error.message
            });
        }
    });

    app.post('/api/legacy/yelp/match-lead', async (req, res) => {
        try {
            const { lead } = req.body;

            if (!lead) return res.status(400).json({ error: 'lead required' });

            const data = await verifyWithYelp(lead);

            res.json({
                success: true,
                data,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Yelp match error:', error);
            res.status(500).json({
                error: 'Failed Yelp match',
                message: error.message
            });
        }
    });

    app.post('/api/legacy/numverify/validate', async (req, res) => {
        try {
            const { phone } = req.body;

            if (!phone) return res.status(400).json({ error: 'phone required' });

            const data = await validatePhoneWithNumverify(phone);

            if (!data) return res.status(503).json({ error: 'Numverify unavailable' });

            res.json({
                success: true,
                data,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Numverify error:', error);
            res.status(500).json({
                error: 'Failed phone validation',
                message: error.message
            });
        }
    });
}

module.exports = {
    registerLegacyRoutes,
    searchApolloOrganizations,
    searchApolloPeople,
    enrichWithApollo,
    searchYelpBusinesses,
    getYelpBusinessDetails,
    verifyWithYelp,
    validatePhoneWithNumverify,
    verifyEmailWithHunter
};
