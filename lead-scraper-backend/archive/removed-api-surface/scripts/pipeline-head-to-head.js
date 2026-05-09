#!/usr/bin/env node
/**
 * Head-to-head: Google discovery + Phase1 enrichment vs Apollo discovery + Apollo enrichment.
 * Same query + location per region; optional enrichment on a fixed sample size (cost control).
 *
 * Usage:
 *   cd lead-scraper-backend && node scripts/pipeline-head-to-head.js
 *   node scripts/pipeline-head-to-head.js --max-discovery 12 --enrich-sample 4 --query "commercial electrical contractor"
 *   node scripts/pipeline-head-to-head.js --discovery-only
 *
 * Env: GOOGLE_PLACES_API_KEY, APOLLO_API_KEY, plus Hunter/PDL/AI keys if enriching the Google path.
 */

'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

const { scrapeGoogleMaps } = require('../src/services/googlePlaces');
const { discoverApolloOrganizations, enrichLeadApolloPipeline } = require('../src/services/apolloPipeline');
const { enrichLead, hasStrongOwner } = require('../src/services/enrichmentOrchestrator');

function parseArgs() {
    const args = process.argv.slice(2);
    const out = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
            out[key] = val;
        }
    }
    return out;
}

const args = parseArgs();

const QUERY =
    typeof args.query === 'string' && args.query.trim()
        ? args.query.trim()
        : 'electrical contractor';

const MAX_DISCOVERY = Math.min(
    60,
    Math.max(1, parseInt(args['max-discovery'], 10) || 15)
);

const ENRICH_SAMPLE =
    args['enrich-sample'] !== undefined
        ? Math.max(0, parseInt(String(args['enrich-sample']), 10) || 0)
        : 5;

const DISCOVERY_ONLY = Boolean(args['discovery-only']);

/** Same criteria everywhere: electricity-adjacent SMB discovery via unified search string + metro anchor. */
const REGIONS = [
    {
        id: 'southern_on',
        label: 'Southern Ontario',
        location: 'Hamilton, ON',
        country: 'Canada'
    },
    {
        id: 'ohio',
        label: 'Ohio',
        location: 'Columbus, OH',
        country: 'United States'
    },
    {
        id: 'ny_non_nyc',
        label: 'New York (non-NYC)',
        location: 'Buffalo, NY',
        country: 'United States'
    },
    {
        id: 'texas',
        label: 'Texas',
        location: 'Houston, TX',
        country: 'United States'
    }
];

function normName(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^a-z0-9\s]/g, '')
        .trim();
}

function discoveryStats(leads) {
    const list = leads || [];
    const withWebsite = list.filter(
        l => l.website && l.website !== 'N/A' && String(l.website).includes('.')
    ).length;
    const withPhone = list.filter(
        l => l.phone && l.phone !== 'N/A' && String(l.phone).replace(/\D/g, '').length >= 10
    ).length;
    return {
        count: list.length,
        withWebsite,
        withPhone,
        pctWebsite: list.length ? Math.round((100 * withWebsite) / list.length) : 0,
        pctPhone: list.length ? Math.round((100 * withPhone) / list.length) : 0
    };
}

function nameOverlap(googleLeads, apolloLeads) {
    const g = new Set(googleLeads.map(l => normName(l.companyName)).filter(Boolean));
    const a = new Set(apolloLeads.map(l => normName(l.companyName)).filter(Boolean));
    let overlap = 0;
    for (const n of g) {
        if (a.has(n)) {
            overlap++;
        }
    }
    return {
        googleUniqueNames: g.size,
        apolloUniqueNames: a.size,
        exactNormalizedOverlap: overlap,
        jaccard:
            g.size + a.size - overlap > 0
                ? overlap / (g.size + a.size - overlap)
                : 0
    };
}

function timed(fn) {
    const t = Date.now();
    return Promise.resolve(fn()).then((r) => ({ r, ms: Date.now() - t }));
}

async function main() {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const clients = { openai, anthropic };

    const missing = [];
    if (!process.env.GOOGLE_PLACES_API_KEY) {
        missing.push('GOOGLE_PLACES_API_KEY');
    }
    if (!process.env.APOLLO_API_KEY || String(process.env.APOLLO_API_KEY).length < 12) {
        missing.push('APOLLO_API_KEY');
    }
    if (missing.length) {
        console.error('Missing env:', missing.join(', '));
        process.exit(1);
    }

    const report = {
        generatedAt: new Date().toISOString(),
        query: QUERY,
        maxDiscovery: MAX_DISCOVERY,
        enrichSample: DISCOVERY_ONLY ? 0 : ENRICH_SAMPLE,
        discoveryOnly: DISCOVERY_ONLY,
        regions: []
    };

    let totals = {
        google: { companies: 0, enrichAttempted: 0, strongOwner: 0 },
        apollo: { companies: 0, enrichAttempted: 0, strongOwner: 0 }
    };

    for (const region of REGIONS) {
        const row = {
            region: region.id,
            label: region.label,
            location: region.location,
            google: {},
            apollo: {},
            overlap: null,
            enrichment: { google: [], apollo: [] }
        };

        let googleLeads = [];
        let apolloLeads = [];

        try {
            const tg = await timed(() =>
                scrapeGoogleMaps(QUERY, region.location, null, null, region.country, MAX_DISCOVERY)
            );
            googleLeads = tg.r;
            row.google.discoveryMs = tg.ms;
        } catch (e) {
            row.google.discoveryError = e.message;
        }

        try {
            const ta = await timed(() =>
                discoverApolloOrganizations(QUERY, region.location, null, region.country, MAX_DISCOVERY)
            );
            apolloLeads = ta.r;
            row.apollo.discoveryMs = ta.ms;
        } catch (e) {
            row.apollo.discoveryError = e.message;
        }

        row.google.discovery = discoveryStats(googleLeads);
        row.apollo.discovery = discoveryStats(apolloLeads);
        row.overlap = nameOverlap(googleLeads, apolloLeads);

        totals.google.companies += row.google.discovery.count;
        totals.apollo.companies += row.apollo.discovery.count;

        const sample = DISCOVERY_ONLY ? 0 : ENRICH_SAMPLE;

        if (sample > 0) {
            const gSlice = googleLeads.slice(0, sample);
            const aSlice = apolloLeads.slice(0, sample);

            for (const lead of gSlice) {
                try {
                    const { r: enriched, ms } = await timed(() =>
                        enrichLead(lead, {}, clients, { includeAI: true })
                    );
                    const strong = hasStrongOwner(enriched);
                    totals.google.enrichAttempted++;
                    if (strong) {
                        totals.google.strongOwner++;
                    }
                    row.enrichment.google.push({
                        companyName: lead.companyName,
                        ms,
                        strongOwner: strong,
                        ownerName: enriched.ownerName || null,
                        sources: (enriched.enrichmentSteps || []).map((s) => s.provider)
                    });
                } catch (e) {
                    row.enrichment.google.push({
                        companyName: lead.companyName,
                        error: e.message
                    });
                }
            }

            for (const lead of aSlice) {
                try {
                    const { r: enriched, ms } = await timed(() => enrichLeadApolloPipeline(lead));
                    const strong = hasStrongOwner(enriched);
                    totals.apollo.enrichAttempted++;
                    if (strong) {
                        totals.apollo.strongOwner++;
                    }
                    row.enrichment.apollo.push({
                        companyName: lead.companyName,
                        ms,
                        strongOwner: strong,
                        ownerName: enriched.ownerName || null,
                        steps: (enriched.enrichmentSteps || []).map((s) => ({
                            provider: s.provider,
                            status: s.status
                        }))
                    });
                } catch (e) {
                    row.enrichment.apollo.push({
                        companyName: lead.companyName,
                        error: e.message
                    });
                }
            }
        }

        report.regions.push(row);
    }

    report.totals = totals;
    report.summary = {
        googleDiscoveryCompanies: totals.google.companies,
        apolloDiscoveryCompanies: totals.apollo.companies,
        googleStrongOwnersInSample: totals.google.strongOwner,
        apolloStrongOwnersInSample: totals.apollo.strongOwner,
        note:
            'Strong owner = non-empty owner name after full enrich (Google path) or Apollo people merge (Apollo path). Discovery counts sum across regions (not deduped across regions).'
    };

    const outDir = path.join(__dirname, '..', 'reports');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(outDir, `pipeline-head-to-head-${stamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

    console.log('\n=== Pipeline head-to-head ===\n');
    console.log(`Query: "${QUERY}"   Max discovery/region: ${MAX_DISCOVERY}`);
    console.log(
        DISCOVERY_ONLY
            ? 'Enrichment: skipped (--discovery-only)'
            : `Enrichment sample/region/path: ${ENRICH_SAMPLE}`
    );
    console.log('');

    for (const r of report.regions) {
        console.log(`--- ${r.label} (${r.location}) ---`);
        if (r.google.discoveryError) {
            console.log(`  Google discovery ERROR: ${r.google.discoveryError}`);
        } else {
            const d = r.google.discovery;
            console.log(
                `  Google: ${d.count} companies | website ${d.pctWebsite}% | phone ${d.pctPhone}% | ${r.google.discoveryMs}ms`
            );
        }
        if (r.apollo.discoveryError) {
            console.log(`  Apollo  discovery ERROR: ${r.apollo.discoveryError}`);
        } else {
            const d = r.apollo.discovery;
            console.log(
                `  Apollo:  ${d.count} companies | website ${d.pctWebsite}% | phone ${d.pctPhone}% | ${r.apollo.discoveryMs}ms`
            );
        }
        if (r.overlap) {
            console.log(
                `  List overlap (normalized company names): ${r.overlap.exactNormalizedOverlap} exact matches | Jaccard ~ ${r.overlap.jaccard.toFixed(2)}`
            );
        }
        if (!DISCOVERY_ONLY && ENRICH_SAMPLE > 0) {
            const gOk = r.enrichment.google.filter((x) => x.strongOwner).length;
            const aOk = r.enrichment.apollo.filter((x) => x.strongOwner).length;
            console.log(
                `  Decision-makers (sample ${ENRICH_SAMPLE}): Google path strong owner ${gOk}/${r.enrichment.google.length} | Apollo path ${aOk}/${r.enrichment.apollo.length}`
            );
        }
        console.log('');
    }

    console.log('Cross-region totals (discovery counts summed):');
    console.log(`  Google companies: ${report.totals.google.companies}`);
    console.log(`  Apollo companies: ${report.totals.apollo.companies}`);
    if (!DISCOVERY_ONLY && ENRICH_SAMPLE > 0) {
        console.log(
            `  Strong owner hits (enriched samples): Google ${report.totals.google.strongOwner}/${report.totals.google.enrichAttempted} | Apollo ${report.totals.apollo.strongOwner}/${report.totals.apollo.enrichAttempted}`
        );
    }
    console.log(`\nFull JSON: ${jsonPath}\n`);

    const mdPath = path.join(outDir, `pipeline-head-to-head-${stamp}.md`);
    const md = [
        `# Pipeline head-to-head`,
        ``,
        `- Generated: ${report.generatedAt}`,
        `- Query: \`${QUERY}\``,
        `- Max companies per region (discovery): ${MAX_DISCOVERY}`,
        DISCOVERY_ONLY
            ? '- Enrichment: **skipped**'
            : `- Enrichment sample size per path per region: **${ENRICH_SAMPLE}**`,
        ``,
        `## Summary`,
        ``,
        `| Metric | Google pipeline | Apollo pipeline |`,
        `|--------|-----------------|-----------------|`,
        `| Companies discovered (sum of 4 regions) | ${report.totals.google.companies} | ${report.totals.apollo.companies} |`,
        DISCOVERY_ONLY
            ? ''
            : `| Strong owner / DM (${ENRICH_SAMPLE}×4 regions max) | ${report.totals.google.strongOwner} / ${report.totals.google.enrichAttempted} | ${report.totals.apollo.strongOwner} / ${report.totals.apollo.enrichAttempted} |`,
        ``,
        `## By region`,
        ``,
        ...report.regions.flatMap((r) => [
            `### ${r.label}`,
            ``,
            `- Google discovery: ${r.google.discoveryError || `${r.google.discovery.count} companies`}`,
            `- Apollo discovery: ${r.apollo.discoveryError || `${r.apollo.discovery.count} companies`}`,
            r.overlap
                ? `- Name overlap (normalized): ${r.overlap.exactNormalizedOverlap} | Jaccard ${r.overlap.jaccard.toFixed(2)}`
                : '',
            ``
        ]),
        report.summary.note,
        ``,
        `Raw JSON: \`${path.basename(jsonPath)}\``
    ]
        .filter(Boolean)
        .join('\n');

    fs.writeFileSync(mdPath, md, 'utf8');
    console.log(`Markdown: ${mdPath}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
