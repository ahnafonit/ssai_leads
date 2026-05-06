#!/usr/bin/env node
require('dotenv').config({ override: true });
const axios = require('axios');

const APOLLO_KEY = process.env.APOLLO_API_KEY;

async function test(label, fn) {
  process.stdout.write(`  ${label.padEnd(55)}`);
  try {
    const result = await fn();
    console.log(`✓ ${result}`);
  } catch (err) {
    const status = err.response?.status || 'N/A';
    const body = err.response?.data;
    const msg = typeof body === 'string' ? body.substring(0, 150)
      : body?.message || body?.error?.message || body?.error || JSON.stringify(body || '').substring(0, 150);
    console.log(`✗ (HTTP ${status}) ${msg}`);
  }
}

async function run() {
  console.log('='.repeat(75));
  console.log('  APOLLO PEOPLE SEARCH — NEW ENDPOINT TEST');
  console.log('  Testing: POST /api/v1/mixed_people/api_search');
  console.log('  (replacement for deprecated mixed_people/search)');
  console.log('='.repeat(75));
  console.log(`\n  Key: ${APOLLO_KEY ? APOLLO_KEY.substring(0, 8) + '...' : 'NOT SET'}\n`);

  const headers = { 'X-Api-Key': APOLLO_KEY, 'Content-Type': 'application/json' };
  const url = 'https://api.apollo.io/api/v1/mixed_people/api_search';

  // Test 1: Search by company domain + titles
  await test('By domain + CEO title', async () => {
    const r = await axios.post(url, {
      q_organization_domains_list: ['walmart.com'],
      person_titles: ['CEO'],
      per_page: 3
    }, { headers });
    const people = r.data.people || r.data.contacts || [];
    const names = people.map(p => `${p.name || p.first_name + ' ' + p.last_name} (${p.title || '?'})`).join(', ');
    return `${people.length} result(s): ${names}`;
  });

  // Test 2: Search by org name + seniority
  await test('By org name + owner/c_suite seniority', async () => {
    const r = await axios.post(url, {
      q_organization_name: 'Walmart',
      person_seniorities: ['owner', 'c_suite'],
      per_page: 3
    }, { headers });
    const people = r.data.people || r.data.contacts || [];
    const names = people.map(p => `${p.name || p.first_name + ' ' + p.last_name} (${p.title || '?'})`).join(', ');
    return `${people.length} result(s): ${names}`;
  });

  // Test 3: Search by organization_ids (if we have one from Org Search)
  let orgId = null;
  await test('Get org_id from Org Search first...', async () => {
    const r = await axios.post('https://api.apollo.io/api/v1/mixed_companies/search', {
      q_organization_name: 'Walmart', per_page: 1
    }, { headers });
    orgId = r.data.organizations?.[0]?.id;
    return orgId ? `org_id: ${orgId}` : 'No org found';
  });

  if (orgId) {
    await test('By organization_id + owner titles', async () => {
      const r = await axios.post(url, {
        organization_ids: [orgId],
        person_titles: ['CEO', 'Owner', 'President', 'Founder'],
        per_page: 5
      }, { headers });
      const people = r.data.people || r.data.contacts || [];
      const names = people.map(p => `${p.name || p.first_name + ' ' + p.last_name} (${p.title || '?'})`).join(', ');
      return `${people.length} result(s): ${names}`;
    });
  }

  // Test 4: Search for a small local business owner
  await test('Small biz: "Joe\'s Pizza" owner search', async () => {
    const r = await axios.post(url, {
      q_organization_name: "Joe's Pizza",
      person_seniorities: ['owner', 'founder'],
      person_locations: ['New York, United States'],
      per_page: 3
    }, { headers });
    const people = r.data.people || r.data.contacts || [];
    const names = people.map(p => `${p.name || p.first_name + ' ' + p.last_name} (${p.title || '?'})`).join(', ');
    return `${people.length} result(s)${names ? ': ' + names : ''}`;
  });

  // Test 5: Search by location + seniority (no company)
  await test('By location only: owners in Houston, TX', async () => {
    const r = await axios.post(url, {
      person_seniorities: ['owner'],
      person_locations: ['Houston, Texas, United States'],
      per_page: 3
    }, { headers });
    const people = r.data.people || r.data.contacts || [];
    const names = people.map(p => `${p.name || '?'} @ ${p.organization?.name || '?'} (${p.title || '?'})`).join(', ');
    return `${people.length} result(s)${names ? ': ' + names : ''}`;
  });

  // Test 6: Check what fields come back (no emails/phones expected per docs)
  await test('Field check: what data comes back?', async () => {
    const r = await axios.post(url, {
      q_organization_domains_list: ['walmart.com'],
      person_seniorities: ['c_suite'],
      per_page: 1
    }, { headers });
    const person = (r.data.people || r.data.contacts || [])[0];
    if (!person) return 'No results';
    const fields = Object.keys(person).filter(k => person[k] !== null && person[k] !== undefined);
    return `Fields present: ${fields.join(', ')}`;
  });

  console.log('\n' + '─'.repeat(75));
  console.log('  NOTE: Per Apollo docs, this endpoint does NOT return emails or phones.');
  console.log('  You get person IDs, names, titles — then use People Match/Enrich');
  console.log('  (which DOES work with your key) to get email + phone for each person.');
  console.log('─'.repeat(75));
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
