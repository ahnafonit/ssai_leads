#!/usr/bin/env node
require('dotenv').config({ override: true });
const axios = require('axios');

const APOLLO_KEY = process.env.APOLLO_API_KEY;
const PDL_KEY = process.env.PDL_API_KEY;

/** Large public company used only as API shape smoke-test data (no individuals). */
const DEMO_ORG_NAME = 'Stripe';
const DEMO_DOMAIN = 'stripe.com';

async function testEndpoint(label, fn) {
  process.stdout.write(`  ${label.padEnd(50)}`);
  try {
    const result = await fn();
    console.log(`✓ ACCESS  ${result}`);
    return 'ok';
  } catch (err) {
    const status = err.response?.status || 'N/A';
    const body = err.response?.data;
    const msg = typeof body === 'string' ? body.substring(0, 120)
      : body?.message || body?.error?.message || body?.error || JSON.stringify(body || '').substring(0, 120);

    if (status === 401 || status === 403) {
      console.log(`✗ PERMISSION DENIED  (HTTP ${status}) ${msg}`);
      return 'denied';
    } else if (status === 404) {
      console.log(`? NO DATA  (HTTP ${status}) ${msg} — endpoint accessible, query found nothing`);
      return 'no_data';
    } else if (status === 422) {
      console.log(`? BAD REQUEST  (HTTP ${status}) ${msg} — endpoint reachable, input rejected`);
      return 'bad_input';
    } else {
      console.log(`? ERROR  (HTTP ${status}) ${msg}`);
      return 'error';
    }
  }
}

async function run() {
  console.log('='.repeat(75));
  console.log('  API ENDPOINT ACCESS TEST v2');
  console.log('  Distinguishing permission errors from bad data / query issues');
  console.log('='.repeat(75));

  // ══════════════════════════════════════════════════════
  console.log('\n══ APOLLO.IO ══');
  console.log(`  Key: ${APOLLO_KEY ? `set (${APOLLO_KEY.length} chars)` : 'NOT SET'}\n`);

  if (!APOLLO_KEY) {
    console.log('  ⚠ No Apollo API key configured\n');
  } else {

    // 1. Organization Search — known working
    await testEndpoint('Org Search (mixed_companies/search)', async () => {
      const r = await axios.post('https://api.apollo.io/api/v1/mixed_companies/search', {
        q_organization_name: DEMO_ORG_NAME, page: 1, per_page: 1
      }, { headers: { 'X-Api-Key': APOLLO_KEY, 'Content-Type': 'application/json' } });
      const orgs = r.data.organizations || [];
      return `${orgs.length} result(s), total: ${r.data.pagination?.total_entries || '?'}`;
    });

    // 2. Organization Enrich — known working
    await testEndpoint('Org Enrich (organizations/enrich)', async () => {
      const r = await axios.get('https://api.apollo.io/api/v1/organizations/enrich', {
        params: { domain: DEMO_DOMAIN },
        headers: { 'X-Api-Key': APOLLO_KEY }
      });
      const org = r.data.organization;
      return org ? `${org.name}, ${org.estimated_num_employees} employees` : 'No org returned';
    });

    // 3. People Search — FAILED LAST TIME (422)
    // Try multiple query variations to rule out bad input
    console.log('\n  ── People Search: retrying with multiple query formats ──');

    await testEndpoint('  People Search: by domain + titles', async () => {
      const r = await axios.post('https://api.apollo.io/api/v1/mixed_people/search', {
        q_organization_domains_list: [DEMO_DOMAIN],
        person_titles: ['CEO'],
        page: 1, per_page: 1
      }, { headers: { 'X-Api-Key': APOLLO_KEY, 'Content-Type': 'application/json' } });
      const people = r.data.contacts || r.data.people || [];
      return `${people.length} result(s), total: ${r.data.pagination?.total_entries || '?'}`;
    });

    await testEndpoint('  People Search: by org name only', async () => {
      const r = await axios.post('https://api.apollo.io/api/v1/mixed_people/search', {
        q_organization_name: DEMO_ORG_NAME,
        page: 1, per_page: 1
      }, { headers: { 'X-Api-Key': APOLLO_KEY, 'Content-Type': 'application/json' } });
      const people = r.data.contacts || r.data.people || [];
      return `${people.length} result(s), total: ${r.data.pagination?.total_entries || '?'}`;
    });

    await testEndpoint('  People Search: by seniority + location', async () => {
      const r = await axios.post('https://api.apollo.io/api/v1/mixed_people/search', {
        person_seniorities: ['owner', 'c_suite'],
        person_locations: ['New York, United States'],
        page: 1, per_page: 1
      }, { headers: { 'X-Api-Key': APOLLO_KEY, 'Content-Type': 'application/json' } });
      const people = r.data.contacts || r.data.people || [];
      return `${people.length} result(s), total: ${r.data.pagination?.total_entries || '?'}`;
    });

    await testEndpoint('  People Search: minimal (empty body)', async () => {
      const r = await axios.post('https://api.apollo.io/api/v1/mixed_people/search', {
        page: 1, per_page: 1
      }, { headers: { 'X-Api-Key': APOLLO_KEY, 'Content-Type': 'application/json' } });
      const people = r.data.contacts || r.data.people || [];
      return `${people.length} result(s)`;
    });

    console.log('');

    // 4. People Match — domain-only fixture (no named individuals in repo)
    await testEndpoint('People Match/Enrich (people/match)', async () => {
      const r = await axios.post('https://api.apollo.io/api/v1/people/match', {
        domain: DEMO_DOMAIN
      }, { headers: { 'X-Api-Key': APOLLO_KEY, 'Content-Type': 'application/json' } });
      const p = r.data.person;
      return p ? `${p.name}, title: ${p.title}, email: ${p.email || 'none'}` : 'No person returned';
    });
  }

  // ══════════════════════════════════════════════════════
  console.log('\n══ PEOPLE DATA LABS ══');
  console.log(`  Key: ${PDL_KEY ? `set (${PDL_KEY.length} chars)` : 'NOT SET'}\n`);

  if (!PDL_KEY) {
    console.log('  ⚠ No PDL API key configured\n');
  } else {

    // 1. Person Search — FAILED LAST TIME (404 / no records)
    // Try multiple SQL queries to rule out bad query
    console.log('  ── Person Search: retrying with multiple queries ──');

    await testEndpoint('  Person Search: by company + title', async () => {
      const r = await axios.get('https://api.peopledatalabs.com/v5/person/search', {
        params: {
          sql: `SELECT * FROM person WHERE job_company_name='${DEMO_ORG_NAME}' AND job_title LIKE '%CEO%'`,
          size: 1
        },
        headers: { 'X-Api-Key': PDL_KEY }
      });
      return `${r.data.total || 0} total, returned ${r.data.data?.length || 0}`;
    });

    await testEndpoint('  Person Search: by company (broad)', async () => {
      const r = await axios.get('https://api.peopledatalabs.com/v5/person/search', {
        params: {
          sql: `SELECT * FROM person WHERE job_company_name LIKE '%${DEMO_ORG_NAME}%' AND job_title LIKE '%Owner%'`,
          size: 3
        },
        headers: { 'X-Api-Key': PDL_KEY }
      });
      return `${r.data.total || 0} total, returned ${r.data.data?.length || 0}`;
    });

    await testEndpoint('  Person Search: any CEO in New York', async () => {
      const r = await axios.get('https://api.peopledatalabs.com/v5/person/search', {
        params: {
          sql: "SELECT * FROM person WHERE job_title='CEO' AND location_locality='New York'",
          size: 1
        },
        headers: { 'X-Api-Key': PDL_KEY }
      });
      return `${r.data.total || 0} total, returned ${r.data.data?.length || 0}`;
    });

    await testEndpoint('  Person Search: minimal (all CEOs)', async () => {
      const r = await axios.get('https://api.peopledatalabs.com/v5/person/search', {
        params: {
          sql: "SELECT * FROM person WHERE job_title='CEO'",
          size: 1
        },
        headers: { 'X-Api-Key': PDL_KEY }
      });
      return `${r.data.total || 0} total, returned ${r.data.data?.length || 0}`;
    });

    console.log('');

    // 2. Person Enrich — website-only (no emails / personal URLs in repository)
    console.log('  ── Person Enrich: org-level input only ──');

    await testEndpoint('  Person Enrich: by company name', async () => {
      const r = await axios.get('https://api.peopledatalabs.com/v5/person/enrich', {
        params: { company: DEMO_ORG_NAME },
        headers: { 'X-Api-Key': PDL_KEY }
      });
      return `${r.data.full_name || '?'}, title: ${r.data.job_title || '?'}, emails: ${r.data.emails?.length || 0}`;
    });

    console.log('');

    // 3. Company Enrich — known working
    await testEndpoint('Company Enrich (company/enrich)', async () => {
      const r = await axios.get('https://api.peopledatalabs.com/v5/company/enrich', {
        params: { website: DEMO_DOMAIN },
        headers: { 'X-Api-Key': PDL_KEY }
      });
      return `${r.data.name}, size: ${r.data.size}, industry: ${r.data.industry}, founded: ${r.data.founded || '?'}`;
    });

    // 4. Company Search — known working
    await testEndpoint('Company Search (company/search)', async () => {
      const r = await axios.get('https://api.peopledatalabs.com/v5/company/search', {
        params: { sql: `SELECT * FROM company WHERE name='${DEMO_ORG_NAME}'`, size: 1 },
        headers: { 'X-Api-Key': PDL_KEY }
      });
      const co = r.data.data?.[0];
      return `${r.data.total || 0} total. First: ${co?.name || '?'}, size: ${co?.size || '?'}, industry: ${co?.industry || '?'}`;
    });
  }

  console.log('\n' + '='.repeat(75));
  console.log('  LEGEND:');
  console.log('  ✓ ACCESS         = endpoint works with your key');
  console.log('  ✗ PERMISSION     = your plan does not include this endpoint');
  console.log('  ? NO DATA        = endpoint reachable, but query matched nothing');
  console.log('  ? BAD REQUEST    = endpoint reachable, but rejected the input format');
  console.log('='.repeat(75));
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
