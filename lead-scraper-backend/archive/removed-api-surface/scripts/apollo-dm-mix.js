#!/usr/bin/env node
/**
 * Apollo-only: mix of high–electricity-load SMB verticals; % of orgs with a DM name after people search.
 *
 *   node scripts/apollo-dm-mix.js
 *   node scripts/apollo-dm-mix.js --max 10
 *
 * DM = ownerName passing hasStrongOwner() (post Apollo org + people pipeline).
 */

'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const { discoverApolloOrganizations, enrichLeadApolloPipeline, apolloApiConfigured } = require('../src/services/apolloPipeline');
const { hasStrongOwner } = require('../src/services/enrichmentOrchestrator');

function parseArgs() {
    const args = process.argv.slice(2);
    const out = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const k = args[i].slice(2);
            const v = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
            out[k] = v;
        }
    }
    return out;
}

const args = parseArgs();
const MAX_PER_SCENARIO = Math.min(25, Math.max(1, parseInt(String(args.max || '12'), 10) || 12));

/** One scenario = keyword + metro (avoids N×M explosion; still a deliberate mix of geos + verticals). */
const SCENARIOS = [
    { id: 'laundromat', label: 'Laundromat', query: 'laundromat', location: 'Hamilton, ON', country: 'Canada' },
    { id: 'restaurant', label: 'Restaurant', query: 'restaurant', location: 'Buffalo, NY', country: 'United States' },
    { id: 'industrial', label: 'Industrial / fab', query: 'metal fabrication', location: 'Columbus, OH', country: 'United States' },
    { id: 'warehouse', label: 'Warehouse / logistics', query: 'warehouse distribution', location: 'Houston, TX', country: 'United States' },
    { id: 'food_mfg', label: 'Food processing', query: 'food manufacturing', location: 'Toronto, ON', country: 'Canada' }
];

async function main() {
    if (!apolloApiConfigured()) {
        console.error('APOLLO_API_KEY is missing or placeholder. Set a real key in .env');
        process.exit(1);
    }

    const rows = [];
    let totalLeads = 0;
    let totalWithDm = 0;

    for (const s of SCENARIOS) {
        let leads = [];
        try {
            leads = await discoverApolloOrganizations(s.query, s.location, null, s.country, MAX_PER_SCENARIO);
        } catch (e) {
            rows.push({
                ...s,
                discoveryCount: 0,
                error: e.message,
                withDm: 0,
                pctDm: null
            });
            console.error(`[${s.label}] discovery failed:`, e.message);
            continue;
        }

        let withDm = 0;
        let leadsWithPeopleHits = 0;
        let peopleRowsTotal = 0;

        for (const lead of leads) {
            try {
                const enriched = await enrichLeadApolloPipeline(lead);
                const peopleStep = (enriched.enrichmentSteps || []).find((x) => x.provider === 'apollo_people');
                const nPeople = peopleStep && typeof peopleStep.count === 'number' ? peopleStep.count : 0;
                if (nPeople > 0) {
                    leadsWithPeopleHits++;
                    peopleRowsTotal += nPeople;
                }
                if (hasStrongOwner(enriched)) {
                    withDm++;
                }
            } catch (e) {
                console.error(`[${s.label}] enrich failed for ${lead.companyName}:`, e.message);
            }
        }

        const n = leads.length;
        const pct = n ? Math.round((100 * withDm) / n) : 0;
        const pctPeopleHit = n ? Math.round((100 * leadsWithPeopleHits) / n) : 0;
        totalLeads += n;
        totalWithDm += withDm;

        rows.push({
            ...s,
            discoveryCount: n,
            withDm,
            pctDm: pct,
            leadsWithAtLeastOneApolloContact: leadsWithPeopleHits,
            pctLeadsWithContacts: pctPeopleHit,
            apolloContactRowsSummed: peopleRowsTotal
        });

        console.log(
            `${s.label.padEnd(28)} | orgs: ${String(n).padStart(2)} | contacts returned≥1: ${leadsWithPeopleHits}/${n} (${pctPeopleHit}%) | DM name: ${withDm}/${n} (${pct}%)`
        );
    }

    const overallPct = totalLeads ? Math.round((100 * totalWithDm) / totalLeads) : 0;
    const sumContactHits = rows.reduce((a, r) => a + (r.leadsWithAtLeastOneApolloContact || 0), 0);
    const pctContactHits = totalLeads ? Math.round((100 * sumContactHits) / totalLeads) : 0;

    console.log('\n---');
    console.log(
        `ALL SCENARIOS (Apollo only) | total orgs: ${totalLeads} | leads w/ ≥1 people row: ${sumContactHits}/${totalLeads} (${pctContactHits}%) | DM name: ${totalWithDm}/${totalLeads} (${overallPct}%)`
    );
    console.log('---\n');
    console.log(
        'DM = ownerName present after Apollo org match + people search (CEO/owner titles first; fallback all titles).'
    );
    console.log(
        'If DM % is low, api_search returned no people rows for those org_ids—try different metros or title filters.'
    );

    const outDir = path.join(__dirname, '..', 'reports');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(outDir, `apollo-dm-mix-${stamp}.json`);
    fs.writeFileSync(
        jsonPath,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                maxPerScenario: MAX_PER_SCENARIO,
                overall: {
                    totalOrgs: totalLeads,
                    leadsWithApolloPeopleHits: sumContactHits,
                    pctLeadsWithContacts: pctContactHits,
                    withDmName: totalWithDm,
                    pctWithDm: overallPct
                },
                byScenario: rows
            },
            null,
            2
        ),
        'utf8'
    );
    console.log(`Wrote ${jsonPath}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
