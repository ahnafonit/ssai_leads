'use strict';

const axios = require('axios');
const { step, classifyHttpError } = require('../utils/providerEnvelope');

const DEFAULT_SMARTY_URL = 'https://us-street.api.smarty.com/street-address';

function isLikelyUnitedStates(lead) {
    const c = String(lead.country || '')
        .trim()
        .toLowerCase();
    if (c && c !== 'n/a') {
        return (
            c.includes('united states') ||
            c === 'usa' ||
            c === 'us' ||
            c.includes('u.s.a') ||
            c.includes('u.s.')
        );
    }
    const st = String(lead.state || '').trim();
    return /^[A-Za-z]{2}$/.test(st);
}

function streetLineFromLead(lead) {
    const raw = String(lead.address || '').trim();
    if (!raw || raw === 'N/A') return '';
    const first = raw.split(',')[0].trim();
    return first || raw;
}

async function fetchSmartyRdi(lead) {
    const authId = process.env.SMARTY_AUTH_ID;
    const authToken = process.env.SMARTY_AUTH_TOKEN;
    const baseUrl = process.env.SMARTY_BASE_URL || DEFAULT_SMARTY_URL;

    if (!authId || !authToken) return null;

    const street = streetLineFromLead(lead);
    if (!street) return null;

    const params = {
        'auth-id': authId,
        'auth-token': authToken,
        street,
        city: lead.city && lead.city !== 'N/A' ? String(lead.city).trim() : '',
        state: lead.state ? String(lead.state).trim() : '',
        zipcode: lead.zipcode ? String(lead.zipcode).trim() : ''
    };

    const response = await axios.get(baseUrl, {
        params,
        timeout: Math.min(120000, Math.max(3000, Number(process.env.SMARTY_TIMEOUT_MS) || 15000))
    });

    const rows = Array.isArray(response.data) ? response.data : [];
    if (rows.length === 0) return { rdi: null, metadata: null, analysis: null };

    const first = rows[0];
    const rdi = first.metadata?.rdi ?? null;
    return {
        rdi,
        metadata: first.metadata || null,
        analysis: first.analysis || null,
        deliveryLine1: first.delivery_line_1 || null
    };
}

function applySmartyToLead(lead, result) {
    if (!result) return { ...lead };
    return {
        ...lead,
        smartyEnriched: true,
        smartyRdi: result.rdi ?? null,
        smartyDeliveryLine1: result.deliveryLine1 ?? null,
        smartyDpvMatchCode: result.analysis?.dpv_match_code ?? null
    };
}

async function runSmartyAdapter(lead, ctx) {
    const t0 = Date.now();

    try {
        if (!ctx.opts.smarty) {
            return {
                envelope: step('smarty', { status: 'skipped', skipReason: 'disabled', durationMs: Date.now() - t0 }),
                lead
            };
        }

        const authId = process.env.SMARTY_AUTH_ID;
        const authToken = process.env.SMARTY_AUTH_TOKEN;
        if (!authId || !authToken) {
            return {
                envelope: step('smarty', { status: 'skipped', skipReason: 'no_api_key', durationMs: Date.now() - t0 }),
                lead
            };
        }

        if (!isLikelyUnitedStates(lead)) {
            return {
                envelope: step('smarty', { status: 'skipped', skipReason: 'non_us_address', durationMs: Date.now() - t0 }),
                lead
            };
        }

        const street = streetLineFromLead(lead);
        if (!street) {
            return {
                envelope: step('smarty', { status: 'skipped', skipReason: 'no_street', durationMs: Date.now() - t0 }),
                lead
            };
        }

        const result = await fetchSmartyRdi(lead);
        const next = applySmartyToLead(lead, result);

        const rdi = result?.rdi;
        const message = rdi ? 'classified' : 'no_match';

        return {
            envelope: step('smarty', {
                status: 'ok',
                message,
                data: rdi ? { rdi } : {},
                durationMs: Date.now() - t0
            }),
            lead: next
        };
    } catch (err) {
        const extra = err.response?.status >= 400 ? classifyHttpError(err) : { skipReason: 'timeout', message: err.message };

        console.error('[smarty]', err.response?.status, err.response?.data || err.message);

        const isQuota = extra.skipReason === 'quota';

        return {
            envelope: step('smarty', {
                status: isQuota ? 'skipped' : 'error',
                ...extra,
                message: extra.message || err.message,
                durationMs: Date.now() - t0
            }),
            lead
        };
    }
}

module.exports = {
    runSmartyAdapter,
    isLikelyUnitedStates,
    streetLineFromLead,
    fetchSmartyRdi
};
