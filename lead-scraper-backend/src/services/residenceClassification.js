'use strict';

const { mergeResidenceClassificationOptions } = require('../config/residenceClassificationDefaults');
const { runSmartyAdapter } = require('../providers/smartyUsStreet');

function classificationValueFromSmarty(lead, smartyEnvelope) {
    if (!smartyEnvelope || smartyEnvelope.status === 'skipped' || smartyEnvelope.status === 'error') {
        return 'unknown';
    }
    const rdi =
        lead.smartyRdi != null && String(lead.smartyRdi).trim() !== ''
            ? String(lead.smartyRdi).trim()
            : null;
    if (!rdi) return 'unknown';
    const normalized = rdi.toLowerCase();
    if (normalized === 'commercial') return 'commercial';
    if (normalized === 'residential') return 'residential';
    return 'unknown';
}

function buildAddressClassification(lead, steps) {
    const ev = steps.find(s => s.provider === 'smarty');
    const rdi =
        lead.smartyRdi != null && String(lead.smartyRdi).trim() !== ''
            ? String(lead.smartyRdi).trim()
            : null;

    const value = classificationValueFromSmarty(lead, ev);

    if (ev?.status === 'skipped') {
        return {
            value,
            rdi: null,
            source: 'smarty_us_street',
            skippedReason: ev.skipReason || 'skipped'
        };
    }

    if (ev?.status === 'error') {
        return {
            value,
            rdi: null,
            source: 'smarty_us_street',
            error: ev.message || 'smarty_error'
        };
    }

    if (!rdi) {
        return {
            value,
            rdi: null,
            source: 'smarty_us_street',
            message: ev?.message === 'no_match' ? 'no_usps_match_or_rdi' : null
        };
    }

    return {
        value,
        rdi,
        source: 'smarty_us_street',
        dpvMatchCode: lead.smartyDpvMatchCode || null
    };
}

/**
 * @param {*} lead Plain lead object from discovery
 * @param {*} options Partial options; merged with defaults (see `residenceClassificationDefaults`)
 */
async function classifyResidenceForLead(lead, options = {}) {
    const opts = mergeResidenceClassificationOptions(options);
    const ctx = { opts };

    const { envelope: evSmarty, lead: afterSmarty } = await runSmartyAdapter({ ...lead }, ctx);
    const steps = [evSmarty];

    return {
        ...afterSmarty,
        residenceClassificationSteps: steps,
        addressClassification: buildAddressClassification(afterSmarty, steps),
        residenceClassificationConfigApplied: { smarty: opts.smarty }
    };
}

async function classifyResidenceBatch(leads, options = {}) {
    const out = [];
    for (const lead of leads) {
        try {
            out.push(await classifyResidenceForLead(lead, options));
        } catch (e) {
            out.push({
                ...lead,
                residenceClassificationSteps: [
                    {
                        provider: 'residence_classification',
                        status: 'error',
                        message: e.message,
                        durationMs: 0
                    }
                ],
                addressClassification: {
                    value: 'unknown',
                    rdi: null,
                    source: 'smarty_us_street',
                    error: e.message
                },
                residenceClassificationConfigApplied: { smarty: false }
            });
        }
    }
    return out;
}

module.exports = {
    classifyResidenceForLead,
    classifyResidenceBatch,
    classificationValueFromSmarty,
    buildAddressClassification
};
