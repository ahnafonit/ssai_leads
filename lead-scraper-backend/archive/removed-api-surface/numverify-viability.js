#!/usr/bin/env node
require('dotenv').config({ override: true });
const axios = require('axios');

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const NUMVERIFY_KEY = process.env.NUMVERIFY_API_KEY;

const REGIONS = [
  { label: 'Ontario, Canada',  location: 'Toronto, Ontario, Canada' },
  { label: 'New York, USA',    location: 'New York, NY' },
  { label: 'Texas, USA',       location: 'Houston, Texas' },
  { label: 'Ohio, USA',        location: 'Columbus, Ohio' },
  { label: 'Alberta, Canada',  location: 'Calgary, Alberta, Canada' },
];

// High energy consumers that are ALSO likely to have unreliable phone listings:
// - High turnover / informal operations
// - Cash-heavy, low-tech, owner-operated
// - Frequently change ownership or close/reopen
const CATEGORIES = [
  'laundromat',
  'car wash',
  'auto body shop',
  'dry cleaner',
  'bakery',
  'pizza shop',
  'nail salon',
  'tanning salon',
  'convenience store',
  'coin laundry',
  'welding shop',
  'small manufacturing',
  'cold storage warehouse',
  'ice cream shop',
  'indoor grow store',
  'smoke shop',
  'barber shop',
  'food truck commissary',
  'commercial kitchen rental',
  'printing shop',
];

const delay = ms => new Promise(r => setTimeout(r, ms));

async function searchGooglePlaces(query, maxResults = 10) {
  const url = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
  const resp = await axios.get(url, { params: { query, key: GOOGLE_KEY } });
  if (resp.data.status !== 'OK') return [];
  return resp.data.results.slice(0, maxResults);
}

async function getPlacePhone(placeId) {
  const resp = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
    params: { place_id: placeId, fields: 'name,international_phone_number,formatted_phone_number', key: GOOGLE_KEY }
  });
  if (resp.data.status !== 'OK') return null;
  return {
    name: resp.data.result.name,
    phone: resp.data.result.international_phone_number || resp.data.result.formatted_phone_number || null
  };
}

async function validateWithNumverify(phone) {
  let clean = phone.replace(/[\s\-\(\)\.]/g, '');
  if (clean.startsWith('+')) clean = clean.substring(1);
  else if (clean.startsWith('00')) clean = clean.substring(2);
  const resp = await axios.get('http://apilayer.net/api/validate', {
    params: { access_key: NUMVERIFY_KEY, number: clean, format: 1 }
  });
  return resp.data;
}

async function run() {
  console.log('='.repeat(70));
  console.log('  NUMVERIFY VIABILITY REPORT');
  console.log('  High-energy businesses with likely unreliable phone listings');
  console.log('  Regions: Ontario, NY, Texas, Ohio, Alberta');
  console.log('='.repeat(70));

  const all = [];
  const byCat = {};
  const byRegion = {};
  let totalBiz = 0, totalPhone = 0, totalNoPhone = 0;
  let totalValid = 0, totalInvalid = 0, totalErr = 0;
  const lineTypes = {};

  for (const region of REGIONS) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  REGION: ${region.label}`);
    console.log('─'.repeat(60));
    byRegion[region.label] = { total: 0, phone: 0, valid: 0, invalid: 0 };

    const pick = [...CATEGORIES].sort(() => Math.random() - 0.5).slice(0, 5);

    for (const cat of pick) {
      if (!byCat[cat]) byCat[cat] = { total: 0, phone: 0, valid: 0, invalid: 0 };

      const q = `${cat} in ${region.location}`;
      console.log(`  "${q}"...`);

      let places;
      try { places = await searchGooglePlaces(q, 6); }
      catch (e) { console.log(`    ⚠ search failed: ${e.message}`); continue; }

      console.log(`    ${places.length} results`);

      for (const place of places) {
        totalBiz++;
        byRegion[region.label].total++;
        byCat[cat].total++;

        let d;
        try { d = await getPlacePhone(place.place_id); await delay(100); }
        catch { continue; }

        if (!d || !d.phone) { totalNoPhone++; continue; }

        totalPhone++;
        byRegion[region.label].phone++;
        byCat[cat].phone++;

        let nv;
        try { nv = await validateWithNumverify(d.phone); await delay(250); }
        catch (e) { totalErr++; all.push({ region: region.label, cat, name: d.name, phone: d.phone, valid: null }); continue; }

        const lt = nv.line_type || 'unknown';
        lineTypes[lt] = (lineTypes[lt] || 0) + 1;

        if (nv.valid) {
          totalValid++;
          byRegion[region.label].valid++;
          byCat[cat].valid++;
        } else {
          totalInvalid++;
          byRegion[region.label].invalid++;
          byCat[cat].invalid++;
        }

        all.push({ region: region.label, cat, name: d.name, phone: d.phone, valid: nv.valid, lineType: lt, carrier: nv.carrier || '' });

        const icon = nv.valid ? '✓' : '✗';
        console.log(`    ${icon} ${d.name.substring(0, 28).padEnd(28)} ${d.phone.padEnd(18)} ${lt.padEnd(12)} [${cat}]`);
      }
    }
  }

  // ─── Report ───
  console.log('\n\n' + '='.repeat(70));
  console.log('  RESULTS');
  console.log('='.repeat(70));

  const pct = (n, d) => d ? ((n / d) * 100).toFixed(1) + '%' : '—';

  console.log(`\n  TOTALS`);
  console.log(`    Businesses found:    ${totalBiz}`);
  console.log(`    Had phone:           ${totalPhone}  (${pct(totalPhone, totalBiz)})`);
  console.log(`    No phone:            ${totalNoPhone}  (${pct(totalNoPhone, totalBiz)})`);
  console.log(`    Numverify VALID:     ${totalValid}  (${pct(totalValid, totalPhone)} of phones)`);
  console.log(`    Numverify INVALID:   ${totalInvalid}  (${pct(totalInvalid, totalPhone)} of phones)`);
  if (totalErr) console.log(`    Errors:              ${totalErr}`);

  console.log(`\n  BY REGION`);
  for (const [r, s] of Object.entries(byRegion)) {
    const inv = s.phone - s.valid - (totalErr ? 0 : 0);
    console.log(`    ${r.padEnd(22)} ${String(s.phone).padStart(3)} phones  ${pct(s.valid, s.phone).padStart(6)} valid  ${pct(s.invalid, s.phone).padStart(6)} invalid`);
  }

  console.log(`\n  BY CATEGORY (sorted by invalid rate)`);
  const catSorted = Object.entries(byCat)
    .map(([c, s]) => ({ cat: c, ...s, invalidRate: s.phone ? s.invalid / s.phone : 0 }))
    .sort((a, b) => b.invalidRate - a.invalidRate);
  for (const c of catSorted) {
    if (c.phone === 0) continue;
    console.log(`    ${c.cat.padEnd(26)} ${String(c.phone).padStart(3)} phones  ${pct(c.valid, c.phone).padStart(6)} valid  ${pct(c.invalid, c.phone).padStart(6)} invalid`);
  }

  console.log(`\n  LINE TYPE BREAKDOWN`);
  for (const [lt, count] of Object.entries(lineTypes).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${lt.padEnd(20)} ${count}  (${pct(count, totalPhone)})`);
  }

  // Invalid examples
  const invalids = all.filter(r => r.valid === false);
  if (invalids.length > 0) {
    console.log(`\n  INVALID NUMBERS (${invalids.length} total)`);
    for (const inv of invalids) {
      console.log(`    ${inv.region.padEnd(22)} ${inv.name.substring(0, 26).padEnd(26)} ${inv.phone.padEnd(18)} [${inv.cat}]`);
    }
  }

  console.log(`\n${'─'.repeat(70)}`);
  console.log('  VERDICT');
  console.log('─'.repeat(70));
  const invRate = totalPhone ? (totalInvalid / totalPhone) * 100 : 0;
  const valRate = totalPhone ? (totalValid / totalPhone) * 100 : 0;

  console.log(`  For high-energy businesses with unstable listings:`);
  console.log(`  ${valRate.toFixed(1)}% of Google phone numbers are Numverify-valid`);
  console.log(`  ${invRate.toFixed(1)}% flagged as INVALID`);
  console.log();
  if (invRate < 5) {
    console.log('  → LOW VALUE: Even for risky categories, Google phones pass validation.');
    console.log('    Numverify would rarely filter anything useful for your energy sales leads.');
  } else if (invRate < 15) {
    console.log('  → MODERATE VALUE: Some bad numbers caught. Could save a few wasted calls.');
    console.log('    Worth it only if call volume is high enough to justify the API cost.');
  } else {
    console.log('  → NOTABLE: Significant invalid rate. Either these businesses genuinely');
    console.log('    have bad numbers, or Numverify has false positives on VoIP/cell lines.');
    console.log('    Recommend manual spot-check before trusting Numverify as a filter.');
  }

  console.log('\n' + '='.repeat(70));
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
