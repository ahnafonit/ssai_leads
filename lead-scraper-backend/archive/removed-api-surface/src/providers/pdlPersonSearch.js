'use strict';

const axios = require('axios');
const { step, classifyHttpError } = require('../utils/providerEnvelope');

function buildSql(companyName, city, state, country) {
    let sqlQuery = `SELECT * FROM person WHERE job_company_name LIKE '%${companyName.replace(/'/g, "''")}%'`;

    if (city) {
        sqlQuery += ` AND location_locality LIKE '%${city.replace(/'/g, "''")}%'`;
    }
    if (state) {
        sqlQuery += ` AND location_region LIKE '%${state.replace(/'/g, "''")}%'`;
    }
    if (country) {
        sqlQuery += ` AND location_country LIKE '%${country.replace(/'/g, "''")}%'`;
    }

    sqlQuery += ` AND (job_title LIKE '%CEO%' OR job_title LIKE '%Owner%' OR job_title LIKE '%Founder%' OR job_title LIKE '%President%' OR job_title LIKE '%Partner%')`;

    return sqlQuery;
}

function mapPdlPrimary(primaryOwner, allContacts) {
    let bestEmail = null;
    if (primaryOwner.emails && primaryOwner.emails.length > 0) {
        const professionalEmail = primaryOwner.emails.find(e => e.type === 'professional');
        const currentEmail = primaryOwner.emails.find(e => e.current === true);
        bestEmail = professionalEmail?.address || currentEmail?.address || primaryOwner.emails[0]?.address;
    }

    let bestPhone = null;
    if (primaryOwner.phone_numbers && primaryOwner.phone_numbers.length > 0) {
        bestPhone = primaryOwner.phone_numbers[0];
    }

    return {
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
        facebookUrl: primaryOwner.facebook_url,
        twitterUrl: primaryOwner.twitter_url,
        githubUrl: primaryOwner.github_url,
        jobCompanyName: primaryOwner.job_company_name,
        jobCompanyWebsite: primaryOwner.job_company_website,
        jobCompanyIndustry: primaryOwner.job_company_industry,
        jobCompanySize: primaryOwner.job_company_size,
        pdlPersonId: primaryOwner.id,
        confidence: 90,
        source: 'People Data Labs Person Search',
        allContacts: allContacts || []
    };
}

/**
 * Legacy-friendly full owner object from PDL (used by /api/pdl/find-owner).
 */
async function findCompanyOwnerWithPDL(companyName, city = null, state = null, country = null, size = 10) {
    const apiKey = process.env.PDL_API_KEY;
    if (!apiKey) return null;

    const sql = buildSql(companyName, city, state, country);
    const response = await axios.get(
        'https://api.peopledatalabs.com/v5/person/search',
        {
            params: { sql, size, dataset: 'all', pretty: true },
            headers: {
                'X-Api-Key': apiKey,
                'Content-Type': 'application/json'
            }
        }
    );

    if (response.data.data && response.data.data.length > 0) {
        const primaryOwner = response.data.data[0];
        return mapPdlPrimary(primaryOwner, response.data.data);
    }
    return null;
}

async function runPdlAdapter(lead, ctx) {
    const t0 = Date.now();

    try {
        if (!ctx.opts.pdl) {
            return {
                envelope: step('pdl', { status: 'skipped', skipReason: 'disabled', durationMs: Date.now() - t0 }),
                lead
            };
        }

        const apiKey = process.env.PDL_API_KEY;
        if (!apiKey || apiKey.includes('your_pdl')) {
            return {
                envelope: step('pdl', { status: 'skipped', skipReason: 'no_api_key', durationMs: Date.now() - t0 }),
                lead
            };
        }

        if (!lead.companyName || lead.companyName === 'N/A') {
            return {
                envelope: step('pdl', { status: 'skipped', skipReason: 'no_company', durationMs: Date.now() - t0 }),
                lead
            };
        }

        const size = ctx.opts.pdlMaxResults || 1;
        const sql = buildSql(
            lead.companyName,
            lead.city !== 'N/A' ? lead.city : null,
            lead.state || null,
            lead.country !== 'N/A' ? lead.country : null
        );

        const response = await axios.get(
            'https://api.peopledatalabs.com/v5/person/search',
            {
                params: { sql, size, dataset: 'all', pretty: true },
                headers: {
                    'X-Api-Key': apiKey,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.data.data || response.data.data.length === 0) {
            return {
                envelope: step('pdl', {
                    status: 'ok',
                    message: 'no_matches',
                    durationMs: Date.now() - t0
                }),
                lead
            };
        }

        const merged = mapPdlPrimary(response.data.data[0], response.data.data);

        if (lead.ownerVerified && lead.ownerName) {
            const nextLead = {
                ...lead,
                pdlEnriched: true,
                secondaryContacts: merged.allContacts || []
            };
            if (merged.email && !lead.primaryEmail) {
                nextLead.primaryEmail = merged.email;
            }
            return {
                envelope: step('pdl', { status: 'ok', message: 'supplement_only', durationMs: Date.now() - t0 }),
                lead: nextLead
            };
        }

        const nextLead = {
            ...lead,
            ...merged,
            pdlEnriched: true,
            ownerDataSource: 'People Data Labs (Verified)',
            ownerVerified: true
        };

        return {
            envelope: step('pdl', {
                status: 'ok',
                message: merged.ownerName ? 'owner_found' : 'no_name',
                data: { ownerName: merged.ownerName },
                durationMs: Date.now() - t0
            }),
            lead: nextLead
        };
    } catch (err) {
        const http = err.response?.status;
        if (http === 404) {
            return {
                envelope: step('pdl', {
                    status: 'ok',
                    message: 'no_matches',
                    durationMs: Date.now() - t0
                }),
                lead
            };
        }

        const extra = classifyHttpError(err);

        console.error('[pdl]', err.response?.status, err.response?.data || err.message);

        const isQuota = extra.skipReason === 'quota';

        return {
            envelope: step('pdl', {
                status: isQuota ? 'skipped' : 'error',
                ...extra,
                message: extra.message || err.message,
                durationMs: Date.now() - t0
            }),
            lead
        };
    }
}

module.exports = { runPdlAdapter, findCompanyOwnerWithPDL, mapPdlPrimary };
