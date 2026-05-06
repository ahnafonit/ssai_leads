'use strict';

const { mergeEnrichmentOptions } = require('../config/enrichmentDefaults');
const { runHunterAdapter } = require('../providers/hunterDomain');
const { runPdlAdapter } = require('../providers/pdlPersonSearch');
const { runStrictAiAdapter } = require('../providers/aiStrictOwner');

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

    let { envelope: evPdl, lead: afterPdl } = await runPdlAdapter(current, ctx);
    current = afterPdl;
    steps.push(evPdl);

    let { envelope: evAi, lead: afterAi } = await runStrictAiAdapter(current, ctx);
    current = afterAi;
    steps.push(evAi);

    current.enrichmentSteps = steps;
    current.ownerResolution = hasStrongOwner(current) ? 'resolved' : 'unresolved';

    current.enrichmentConfigApplied = {
        hunter: opts.hunter,
        pdl: opts.pdl,
        ai: opts.ai && includeAI,
        pdlMaxResults: opts.pdlMaxResults
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

module.exports = { enrichLead, enrichLeadBatch, hasStrongOwner };
