#!/usr/bin/env node
/**
 * Simulates FE: POST /scrape then POST /verify per sampled lead.
 * Aggregates enrichmentSteps for provider frequency; "accuracy" = resolved owner rate (no ground truth).
 * Default pipeline has PDL off; pass { pdl: true } to enrichLead below to include PDL.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

const { scrapeGoogleMaps } = require('../src/services/googlePlaces');
const { enrichLead } = require('../src/services/enrichmentOrchestrator');

const clients = {
    openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
};

const REGIONS = [
    {
        name: 'Southern_ON',
        query: 'food processing',
        location: 'Hamilton, Ontario, Canada'
    },
    {
        name: 'Ohio',
        query: 'metal fabrication',
        location: 'Cleveland, Ohio, United States'
    },
    {
        name: 'New_York',
        query: 'commercial laundry',
        location: 'Buffalo, New York, United States'
    },
    {
        name: 'Texas',
        query: 'cold storage warehouse',
        location: 'Houston, Texas, United States'
    }
];

const MAX_LEADS_SCRAPE = 8;
const VERIFY_SAMPLE_PER_REGION = 3;

function tallyStep(steps, provider, agg) {
    if (!steps || !Array.isArray(steps)) return;
    const ev = steps.find(s => s.provider === provider);
    if (!ev) return;
    const key = `${provider}:${ev.status}`;
    agg[key] = (agg[key] || 0) + 1;
    if (ev.skipReason) {
        const sk = `${provider}:skip:${ev.skipReason}`;
        agg[sk] = (agg[sk] || 0) + 1;
    }
}

function enrichmentOptionsForRun() {
    if (process.env.MOCK_TEST_FULL_PIPELINE === 'true') {
        return { hunter: true, pdl: true, ai: true };
    }
    return { pdl: process.env.MOCK_TEST_INCLUDE_PDL === 'true' };
}

async function main() {
    const enrichOpts = enrichmentOptionsForRun();
    console.log('FE pipeline mock test (scrape → verify)\n');
    console.log('Enrichment options:', JSON.stringify(enrichOpts));
    console.log('(Set MOCK_TEST_FULL_PIPELINE=true for Hunter + PDL + AI all on.)\n');
    console.log('Regions:', REGIONS.map(r => r.name).join(', '));
    console.log(`Scrape maxLeads=${MAX_LEADS_SCRAPE}, verify up to ${VERIFY_SAMPLE_PER_REGION} leads per region.\n`);

    const agg = {};
    const rows = [];
    let scrapeErrors = 0;
    let verifyErrors = 0;

    for (const region of REGIONS) {
        let leads = [];

        try {
            leads = await scrapeGoogleMaps(
                region.query,
                region.location,
                null,
                null,
                null,
                MAX_LEADS_SCRAPE
            );
        } catch (e) {
            console.error(`[scrape fail] ${region.name}:`, e.message);
            scrapeErrors++;
            continue;
        }

        console.log(`[scrape ok] ${region.name}: ${leads.length} leads`);

        const sample = leads.slice(0, VERIFY_SAMPLE_PER_REGION);

        for (let i = 0; i < sample.length; i++) {
            const lead = sample[i];
            try {
                const verified = await enrichLead(
                    lead,
                    enrichOpts,
                    clients,
                    { includeAI: enrichOpts.ai !== false }
                );

                ['hunter', 'smarty', 'pdl', 'ai_strict'].forEach(p => tallyStep(verified.enrichmentSteps, p, agg));

                const resolved =
                    verified.ownerResolution === 'resolved' ||
                    (verified.ownerName &&
                        verified.ownerName !== 'N/A' &&
                        verified.ownerName !== 'Owner Not Found');

                rows.push({
                    region: region.name,
                    company: verified.companyName,
                    ownerResolution: verified.ownerResolution,
                    ownerName: verified.ownerName || null,
                    ownerDataSource: verified.ownerDataSource || null,
                    aiPublicBasis: verified.aiPublicBasis || null,
                    primaryEmail: verified.primaryEmail || verified.emails?.[0]?.email || null,
                    strictAiAttempts: verified.strictAiAttempts || null,
                    enrichmentSteps: verified.enrichmentSteps
                });

                const nameLine = resolved ? ` name=${String(verified.ownerName).slice(0, 48)}` : '';
                const srcLine = verified.ownerDataSource ? ` src=${verified.ownerDataSource.slice(0, 50)}` : '';
                console.log(
                    `  [verify] ${verified.companyName.slice(0, 42)}… → ${verified.ownerResolution}${nameLine}${srcLine}`
                );

            } catch (e) {
                console.error(`  [verify fail] ${lead.companyName}:`, e.message);
                verifyErrors++;
            }

            await delay(400);
        }
    }

    const n = rows.length;
    const resolvedCount = rows.filter(r => r.ownerResolution === 'resolved').length;

    console.log('\n--- Aggregate enrichment step counts ---');
    Object.keys(agg).sort().forEach(k => {
        console.log(`  ${k}: ${agg[k]}`);
    });

    console.log('\n--- Resolution rate (proxy "accuracy" without ground truth) ---');
    console.log(`  Verified leads: ${n}`);
    console.log(`  ownerResolution === 'resolved': ${resolvedCount} (${n ? ((resolvedCount / n) * 100).toFixed(1) : 0}%)`);

    console.log('\n--- Owner source mix (when present) ---');
    const sources = {};
    rows.forEach(r => {
        if (!r.ownerDataSource) return;
        sources[r.ownerDataSource] = (sources[r.ownerDataSource] || 0) + 1;
    });
    Object.keys(sources).sort().forEach(s => console.log(`  ${s}: ${sources[s]}`));

    console.log('\n--- Per-row name results ---');
    rows.forEach(r => {
        const steps = (r.enrichmentSteps || []).map(s => `${s.provider}:${s.status}`).join(' | ');
        console.log(`  [${r.region}] ${r.company}`);
        console.log(`    steps: ${steps}`);
        console.log(`    owner: ${r.ownerName || '—'} | source: ${r.ownerDataSource || '—'}`);
        if (r.primaryEmail) console.log(`    email: ${r.primaryEmail}`);
        if (r.aiPublicBasis) console.log(`    aiPublicBasis: ${r.aiPublicBasis.slice(0, 120)}${r.aiPublicBasis.length > 120 ? '…' : ''}`);
        if (r.strictAiAttempts && r.strictAiAttempts.length) {
            const brief = r.strictAiAttempts.map(a =>
                `${a.provider}:${a.ok ? 'ok' : 'no'}${a.confidence != null ? `(${a.confidence})` : ''}`
            ).join(', ');
            console.log(`    aiAttempts: ${brief}`);
        }
    });

    if (scrapeErrors || verifyErrors) {
        console.log('\nErrors:', { scrapeErrors, verifyErrors });
    }

    console.log('\nNote: "Accuracy" here is resolution rate only; Hunter/PDL/AI were not compared to a labeled dataset.');
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
