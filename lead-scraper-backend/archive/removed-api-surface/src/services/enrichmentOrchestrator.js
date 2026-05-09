'use strict';

const { step } = require('../utils/providerEnvelope');
const { mergeEnrichmentOptions } = require('../config/enrichmentDefaults');
const { runHunterAdapter } = require('../providers/hunterDomain');
const { runSmartyAdapter } = require('../providers/smartyUsStreet');
const { runPdlAdapter } = require('../providers/pdlPersonSearch');
const { runStrictAiAdapter } = require('../providers/aiStrictOwner');

/** Tri-state from Smarty step + lead (same rules as addressClassification.value). */
function classificationValueFromSmarty(lead, smartyEnvelope) {
    if (!smartyEnvelope || smartyEnvelope.status === 'skipped' || smartyEnvelope.status === 'error') {
        return 'unknown';
    }
    const rdi = lead.smartyRdi != null && String(lead.smartyRdi).trim() !== ''
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
    const rdi = lead.smartyRdi != null && String(lead.smartyRdi).trim() !== ''
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

function hasStrongOwner(lead) {
    return Boolean(
        lead.ownerName &&
        lead.ownerName !== 'N/A' &&
        lead.ownerName !== 'Owner Not Found' &&
        String(lead.ownerName).trim().length > 1
    );
}

/**
 * @param {*} lead plain object
 * @param {*} enrichmentOptions Partial flags from caller
 * @param {*} clients { openai, anthropic }
 * @param {{ includeAI?: boolean }} meta includeAI=false for scrape batch path
 */
async function enrichLead(lead, enrichmentOptions = {}, clients, meta = {}) {
    const includeAI = meta.includeAI !== false;
    const baseOpts = mergeEnrichmentOptions(enrichmentOptions);

    const opts = includeAI ? baseOpts : { ...baseOpts, ai: false };

    const steps = [];

    let current = { ...lead };

    const ctx = { opts, clients, aiPreferredOrder: process.env.STRICT_AI_ORDER || 'anthropic_first' };

    let { envelope: evHunter, lead: afterHunter } = await runHunterAdapter(current, ctx);
    current = afterHunter;
    steps.push(evHunter);

    let { envelope: evSmarty, lead: afterSmarty } = await runSmartyAdapter(current, ctx);
    current = afterSmarty;
    steps.push(evSmarty);

    const addressClassValue = classificationValueFromSmarty(current, evSmarty);
    const skipPdlAiForResidential = addressClassValue === 'residential';

    let evPdl;
    let afterPdl;
    if (skipPdlAiForResidential) {
        evPdl = step('pdl', {
            status: 'skipped',
            skipReason: 'residential_address',
            durationMs: 0
        });
        afterPdl = current;
    } else {
        const r = await runPdlAdapter(current, ctx);
        evPdl = r.envelope;
        afterPdl = r.lead;
    }
    current = afterPdl;
    steps.push(evPdl);

    let evAi;
    let afterAi;
    if (skipPdlAiForResidential && includeAI) {
        evAi = step('ai_strict', {
            status: 'skipped',
            skipReason: 'residential_address',
            durationMs: 0
        });
        afterAi = current;
    } else {
        const r = await runStrictAiAdapter(current, ctx);
        evAi = r.envelope;
        afterAi = r.lead;
    }
    current = afterAi;
    steps.push(evAi);

    current.enrichmentSteps = steps;
    current.ownerResolution = hasStrongOwner(current) ? 'resolved' : 'unresolved';

    current.addressClassification = buildAddressClassification(current, steps);

    current.enrichmentConfigApplied = {
        hunter: opts.hunter,
        pdl: opts.pdl,
        ai: opts.ai && includeAI,
        smarty: opts.smarty,
        pdlMaxResults: opts.pdlMaxResults,
        pdlSkippedResidential: skipPdlAiForResidential,
        aiSkippedResidential: skipPdlAiForResidential && includeAI
    };

    return current;
}

async function enrichLeadBatch(leads, enrichmentOptions, clients, meta = {}) {
    const out = [];
    for (const lead of leads) {
        try {
            out.push(await enrichLead(lead, enrichmentOptions, clients, meta));

        } catch (e) {
            out.push({
                ...lead,
                enrichmentSteps: [{
                    provider: 'orchestrator',
                    status: 'error',
                    message: e.message
                }],
                ownerResolution: 'error'
            });
        }
    }
    return out;
}

module.exports = { enrichLead, enrichLeadBatch, hasStrongOwner, classificationValueFromSmarty };
