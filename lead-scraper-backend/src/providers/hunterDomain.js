'use strict';

const axios = require('axios');
const { step, classifyHttpError } = require('../utils/providerEnvelope');

function extractDomain(lead) {
    if (!lead.website || lead.website === 'N/A') return null;
    try {
        return lead.website
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .split('/')[0]
            .split('?')[0];
    } catch (_) {
        return null;
    }
}

/**
 * Merge Hunter payload onto lead-like object.
 */
function applyHunterToLead(lead, hunterPayload) {
    if (!hunterPayload) return { ...lead };
    const merged = {
        ...lead,
        hunterEnriched: true,
        primaryEmail: hunterPayload.primaryEmail ?? lead.primaryEmail,
        emails: hunterPayload.emails ?? lead.emails,
        domain: hunterPayload.domain ?? lead.domain,
        hunterTotalEmails: hunterPayload.totalEmails
    };
    const name = hunterPayload.ownerName;
    if (name && name !== 'N/A') {
        merged.ownerName = name;
        merged.ownerPosition = hunterPayload.ownerPosition;
        merged.ownerDataSource = 'Hunter.io Domain Search';
        merged.ownerVerified = true;
    }
    return merged;
}

async function fetchHunterForLead(lead) {
    const apiKey = process.env.HUNTER_API_KEY;

    const domain = extractDomain(lead);
    if (!apiKey || apiKey.includes('your_hunter')) {
        return null;
    }
    if (!domain) {
        return null;
    }

    const response = await axios.get('https://api.hunter.io/v2/domain-search', {
        params: {
            domain,
            api_key: apiKey,
            limit: 10
        }
    });

    const data = response.data.data;
    if (!data || !data.emails || data.emails.length === 0) {
        return null;
    }

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

    const ownerName = primaryEmail.first_name && primaryEmail.last_name
        ? `${primaryEmail.first_name} ${primaryEmail.last_name}`.trim()
        : null;

    return {
        domain,
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
        ownerName,
        ownerPosition: primaryEmail.position,
        ownerDepartment: primaryEmail.department,
        totalEmails: data.emails.length,
        confidence: primaryEmail.confidence || 0,
        source: 'Hunter.io Domain Search'
    };
}

async function runHunterAdapter(lead, ctx) {
    const t0 = Date.now();

    try {
        if (!ctx.opts.hunter) {
            return {
                envelope: step('hunter', { status: 'skipped', skipReason: 'disabled', durationMs: Date.now() - t0 }),
                lead
            };
        }

        const domain = extractDomain(lead);
        if (!domain) {
            return {
                envelope: step('hunter', { status: 'skipped', skipReason: 'no_domain', durationMs: Date.now() - t0 }),
                lead
            };
        }

        const payload = await fetchHunterForLead(lead);

        if (!payload) {
            return {
                envelope: step('hunter', {
                    status: 'ok',
                    message: 'no_emails_found',
                    data: {},
                    durationMs: Date.now() - t0
                }),
                lead: { ...lead, domain: domain || lead.domain }
            };
        }

        const next = applyHunterToLead(lead, payload);

        return {
            envelope: step('hunter', {
                status: 'ok',
                message: payload.ownerName ? 'owner_candidate' : 'emails_only',
                data: { domain: payload.domain, primaryEmail: payload.primaryEmail },
                durationMs: Date.now() - t0
            }),
            lead: next
        };
    } catch (err) {
        const extra = err.response?.status >= 400 ? classifyHttpError(err) : { skipReason: 'timeout', message: err.message };

        console.error('[hunter]', err.response?.status, err.response?.data || err.message);

        const isQuota = extra.skipReason === 'quota';

        return {
            envelope: step('hunter', {
                status: isQuota ? 'skipped' : 'error',
                ...extra,
                message: extra.message || err.message,
                durationMs: Date.now() - t0
            }),
            lead
        };
    }
}

module.exports = { runHunterAdapter, extractDomain, applyHunterToLead, fetchHunterForLead };
