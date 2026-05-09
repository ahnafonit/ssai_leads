'use strict';

const { step } = require('../utils/providerEnvelope');
const { searchApolloOrganizations, searchApolloPeople } = require('../../legacy-integrations');
const { hasStrongOwner } = require('./enrichmentOrchestrator');

const OWNER_TITLE_HINTS = [
    'CEO',
    'Owner',
    'President',
    'Founder',
    'Managing Director',
    'Principal',
    'General Manager',
    'Partner',
    'Chairman',
    'Chief Executive'
];

function buildLocationString(location, zipcode, country) {
    const parts = [location, zipcode, country].filter(
        p => p != null && String(p).trim() !== '' && String(p).trim() !== 'N/A'
    );
    return parts.join(', ').trim() || null;
}

/**
 * Paginated Apollo organization discovery (mixed_companies/search).
 */
async function discoverApolloOrganizations(query, location, zipcode, country, maxLeads) {
    const cap = Math.min(Math.max(Number(maxLeads) || 60, 1), 500);
    const locationStr =
        buildLocationString(location, zipcode, country) || String(location || '').trim() || 'United States';

    const keyword = String(query || '').trim();
    if (!keyword) {
        throw new Error('Search query is required for Apollo discovery');
    }

    const perPage = 25;
    const collected = [];
    let page = 1;
    const maxPages = Math.min(40, Math.ceil(cap / perPage) + 3);

    while (collected.length < cap && page <= maxPages) {
        const filters = {
            keywords: [keyword],
            locations: [locationStr],
            page,
            perPage
        };

        const batch = await searchApolloOrganizations(filters);
        if (!batch.length) {
            break;
        }
        collected.push(...batch);
        if (batch.length < perPage) {
            break;
        }
        page += 1;
        await new Promise(r => setTimeout(r, 200));
    }

    return collected.slice(0, cap);
}

function scoreApolloPerson(p) {
    const title = String(p.title || '').toLowerCase();
    let s = 0;
    if (/(chief executive|ceo|c\.e\.o|owner|president|founder|principal|partner|chairman|managing director|general manager)/i.test(title)) {
        s += 12;
    }
    if (p.email && p.email !== 'N/A' && String(p.email).includes('@')) {
        s += 6;
    }
    if (p.phone && p.phone !== 'N/A') {
        s += 1;
    }
    return s;
}

function pickBestApolloContact(people) {
    if (!people || !people.length) {
        return null;
    }
    const ranked = [...people].sort((a, b) => scoreApolloPerson(b) - scoreApolloPerson(a));
    return ranked[0];
}

function mergeApolloPersonIntoLead(lead, person) {
    if (!person) {
        return lead;
    }
    return {
        ...lead,
        ownerName: person.ownerName && person.ownerName !== 'N/A' ? person.ownerName : lead.ownerName,
        email: person.email && person.email !== 'N/A' ? person.email : lead.email,
        title: person.title && person.title !== 'N/A' ? person.title : lead.title,
        phone: person.phone && person.phone !== 'N/A' ? person.phone : lead.phone,
        linkedinUrl: person.linkedinUrl || lead.linkedinUrl,
        apolloPersonId: person.personId ?? lead.apolloPersonId,
        apolloOrganizationId: person.organizationId ?? lead.organizationId,
        industry: person.industry && person.industry !== 'N/A' ? person.industry : lead.industry,
        companyName: person.companyName && person.companyName !== 'N/A' ? person.companyName : lead.companyName,
        source: lead.source || 'Apollo pipeline'
    };
}

/**
 * Resolve organization id via name + location when missing on the lead.
 */
async function resolveApolloOrganizationId(lead) {
    if (lead.organizationId) {
        return { orgId: lead.organizationId, orgRow: null };
    }
    const company = String(lead.companyName || '').trim();
    if (!company) {
        return { orgId: null, orgRow: null };
    }

    const loc = buildLocationString(
        [lead.city, lead.state].filter(Boolean).join(', ') || null,
        lead.zipcode,
        lead.country
    );
    const filters = {
        companyName: company,
        locations: loc ? [loc] : [],
        page: 1,
        perPage: 6
    };

    const orgs = await searchApolloOrganizations(filters);
    const top = orgs[0];
    if (!top?.organizationId) {
        return { orgId: null, orgRow: null };
    }
    return { orgId: top.organizationId, orgRow: top };
}

/**
 * Apollo-only verify path: org resolution (if needed) → people by organization_ids → merge best contact.
 */
async function enrichLeadApolloPipeline(lead) {
    const steps = [];
    let current = { ...lead };

    const t0 = Date.now();
    try {
        const { orgId, orgRow } = await resolveApolloOrganizationId(current);
        if (orgRow) {
            current = {
                ...current,
                ...orgRow,
                organizationId: orgId,
                companyName: current.companyName || orgRow.companyName,
                website: current.website !== 'N/A' ? current.website : orgRow.website,
                phone: current.phone !== 'N/A' ? current.phone : orgRow.phone,
                address: current.address !== 'N/A' ? current.address : orgRow.address
            };
        }

        steps.push(
            step('apollo_org_lookup', {
                status: orgId ? 'ok' : 'skipped',
                skipReason: orgId ? undefined : 'no_organization_match',
                durationMs: Date.now() - t0,
                organizationId: orgId || null
            })
        );

        if (!orgId) {
            current.enrichmentSteps = steps;
            current.ownerResolution = hasStrongOwner(current) ? 'resolved' : 'unresolved';
            current.pipeline = 'apollo';
            current.addressClassification = current.addressClassification || null;
            current.enrichmentConfigApplied = {
                pipeline: 'apollo',
                hunter: false,
                smarty: false,
                pdl: false,
                ai: false
            };
            return current;
        }

        const t1 = Date.now();
        let people = await searchApolloPeople({
            organizationIds: [orgId],
            titles: OWNER_TITLE_HINTS,
            page: 1,
            perPage: 25
        });

        if (!people.length) {
            people = await searchApolloPeople({
                organizationIds: [orgId],
                page: 1,
                perPage: 25
            });
        }

        steps.push(
            step('apollo_people', {
                status: 'ok',
                durationMs: Date.now() - t1,
                count: people.length
            })
        );

        const best = pickBestApolloContact(people);
        current = mergeApolloPersonIntoLead(current, best);
    } catch (e) {
        steps.push(
            step('apollo_pipeline', {
                status: 'error',
                message: e.message,
                durationMs: 0
            })
        );
    }

    current.enrichmentSteps = steps;
    current.ownerResolution = hasStrongOwner(current) ? 'resolved' : 'unresolved';
    current.pipeline = 'apollo';
    current.addressClassification = current.addressClassification || null;
    current.enrichmentConfigApplied = {
        pipeline: 'apollo',
        hunter: false,
        smarty: false,
        pdl: false,
        ai: false
    };

    return current;
}

async function enrichLeadBatchApollo(leads) {
    const out = [];
    for (const lead of leads) {
        try {
            out.push(await enrichLeadApolloPipeline(lead));
        } catch (e) {
            out.push({
                ...lead,
                enrichmentSteps: [
                    step('apollo_pipeline', {
                        status: 'error',
                        message: e.message
                    })
                ],
                ownerResolution: 'error',
                pipeline: 'apollo'
            });
        }
    }
    return out;
}

function apolloApiConfigured() {
    const k = process.env.APOLLO_API_KEY;
    return (
        k &&
        String(k).trim() !== '' &&
        !String(k).includes('your_apollo') &&
        !String(k).includes('api_key_here') &&
        String(k).trim().length > 10
    );
}

module.exports = {
    discoverApolloOrganizations,
    enrichLeadApolloPipeline,
    enrichLeadBatchApollo,
    apolloApiConfigured,
    buildLocationString,
    OWNER_TITLE_HINTS
};
