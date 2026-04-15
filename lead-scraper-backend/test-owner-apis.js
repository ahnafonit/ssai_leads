// Test script to verify all APIs for owner name retrieval
require('dotenv').config();
const axios = require('axios');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

console.log('🔍 Testing Owner Name Retrieval APIs\n');
console.log('='.repeat(60));

// Test data
const testCompany = {
    companyName: "Starbucks",
    city: "Seattle",
    state: "WA",
    country: "USA",
    website: "starbucks.com"
};

// Initialize AI clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function testApollo() {
    console.log('\n1️⃣  Testing Apollo API (Person Match)...');
    try {
        const response = await axios.post(
            'https://api.apollo.io/api/v1/people/match',
            {
                first_name: "Howard",
                last_name: "Schultz",
                organization_name: "Starbucks"
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-Key': process.env.APOLLO_API_KEY
                }
            }
        );

        if (response.data && response.data.person) {
            console.log('   ✅ Apollo API: WORKING');
            console.log(`   Found: ${response.data.person.name}`);
            console.log(`   Title: ${response.data.person.title || 'N/A'}`);
            return true;
        } else {
            console.log('   ⚠️  Apollo API: Connected but no match found');
            return true; // API is working, just no match
        }
    } catch (error) {
        console.log('   ❌ Apollo API: FAILED');
        console.log(`   Error: ${error.response?.data?.error || error.message}`);
        return false;
    }
}

async function testPDL() {
    console.log('\n2️⃣  Testing People Data Labs (Owner Search)...');
    try {
        // Use LIKE for better matching (exact match often fails)
        const sqlQuery = `SELECT * FROM person WHERE job_company_name LIKE '%${testCompany.companyName}%' AND (job_title LIKE '%CEO%' OR job_title LIKE '%Owner%' OR job_title LIKE '%Founder%' OR job_title LIKE '%President%') LIMIT 5`;

        const response = await axios.get(
            'https://api.peopledatalabs.com/v5/person/search',
            {
                params: {
                    sql: sqlQuery,
                    size: 5
                },
                headers: {
                    'X-Api-Key': process.env.PDL_API_KEY
                }
            }
        );

        if (response.data && response.data.data && response.data.data.length > 0) {
            console.log('   ✅ PDL API: WORKING');
            console.log(`   Found ${response.data.data.length} person(s)`);
            const firstPerson = response.data.data[0];
            console.log(`   Example: ${firstPerson.full_name} - ${firstPerson.job_title}`);
            return true;
        } else {
            console.log('   ⚠️  PDL API: Connected but no results');
            return true; // API is working, just no results
        }
    } catch (error) {
        console.log('   ❌ PDL API: FAILED');
        console.log(`   Error: ${error.response?.data?.error?.message || error.message}`);
        return false;
    }
}

async function testHunter() {
    console.log('\n3️⃣  Testing Hunter.io (Email Finder)...');
    try {
        const response = await axios.get('https://api.hunter.io/v2/domain-search', {
            params: {
                domain: testCompany.website,
                api_key: process.env.HUNTER_API_KEY,
                limit: 5
            }
        });

        if (response.data && response.data.data) {
            console.log('   ✅ Hunter.io API: WORKING');
            const emails = response.data.data.emails || [];
            console.log(`   Found ${emails.length} email(s)`);

            // Look for owner/CEO emails
            const ownerEmails = emails.filter(e =>
                e.position && (
                    e.position.toLowerCase().includes('ceo') ||
                    e.position.toLowerCase().includes('founder') ||
                    e.position.toLowerCase().includes('owner')
                )
            );

            if (ownerEmails.length > 0) {
                console.log(`   Owner emails found: ${ownerEmails.length}`);
                console.log(`   Example: ${ownerEmails[0].first_name} ${ownerEmails[0].last_name} - ${ownerEmails[0].position}`);
            }
            return true;
        } else {
            console.log('   ⚠️  Hunter.io API: Connected but no data');
            return true;
        }
    } catch (error) {
        console.log('   ❌ Hunter.io API: FAILED');
        console.log(`   Error: ${error.response?.data?.errors?.[0]?.details || error.message}`);
        return false;
    }
}

async function testChatGPT() {
    console.log('\n4️⃣  Testing OpenAI ChatGPT (AI Owner Search)...');
    try {
        const prompt = `Find the owner or CEO of ${testCompany.companyName}. Return ONLY a JSON object with keys: ownerName, title, confidence (0-100). Be concise.`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are a business intelligence assistant. Return only valid JSON." },
                { role: "user", content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 200
        });

        const response = completion.choices[0].message.content;
        console.log('   ✅ ChatGPT API: WORKING');

        // Try to parse JSON
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                console.log(`   Owner: ${parsed.ownerName}`);
                console.log(`   Title: ${parsed.title}`);
                console.log(`   Confidence: ${parsed.confidence}%`);
            } else {
                console.log(`   Raw response: ${response.substring(0, 100)}...`);
            }
        } catch (e) {
            console.log(`   Response: ${response.substring(0, 100)}...`);
        }
        return true;
    } catch (error) {
        console.log('   ❌ ChatGPT API: FAILED');
        console.log(`   Error: ${error.message}`);
        return false;
    }
}

async function testClaude() {
    console.log('\n5️⃣  Testing Anthropic Claude (AI Owner Search)...');
    try {
        const prompt = `Find the owner or CEO of ${testCompany.companyName}. Return ONLY a JSON object with keys: ownerName, title, confidence (0-100). Be concise.`;

        const message = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 200,
            messages: [{ role: "user", content: prompt }]
        });

        const response = message.content[0].text;
        console.log('   ✅ Claude API: WORKING');

        // Try to parse JSON
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                console.log(`   Owner: ${parsed.ownerName}`);
                console.log(`   Title: ${parsed.title}`);
                console.log(`   Confidence: ${parsed.confidence}%`);
            } else {
                console.log(`   Raw response: ${response.substring(0, 100)}...`);
            }
        } catch (e) {
            console.log(`   Response: ${response.substring(0, 100)}...`);
        }
        return true;
    } catch (error) {
        console.log('   ❌ Claude API: FAILED');
        console.log(`   Error: ${error.message}`);
        return false;
    }
}

async function runTests() {
    console.log(`\nTesting with company: ${testCompany.companyName}`);
    console.log('='.repeat(60));

    const results = {
        apollo: await testApollo(),
        pdl: await testPDL(),
        hunter: await testHunter(),
        chatgpt: await testChatGPT(),
        claude: await testClaude()
    };

    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));

    const working = Object.values(results).filter(r => r).length;
    const total = Object.keys(results).length;

    console.log(`\n✅ Working APIs: ${working}/${total}`);
    console.log(`❌ Failed APIs: ${total - working}/${total}`);

    console.log('\nAPI Status:');
    Object.entries(results).forEach(([api, status]) => {
        console.log(`   ${status ? '✅' : '❌'} ${api.toUpperCase()}`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('💡 RECOMMENDATIONS:');
    console.log('='.repeat(60));

    if (!results.apollo) {
        console.log('\n⚠️  Apollo API Issues:');
        console.log('   - Check if API key is valid');
        console.log('   - Verify account has credits');
        console.log('   - Owner names will rely more on PDL and AI');
    }

    if (!results.pdl) {
        console.log('\n⚠️  PDL API Issues:');
        console.log('   - Check if API key is valid');
        console.log('   - Verify account has credits');
        console.log('   - This is PRIMARY source for owner names');
    }

    if (!results.hunter) {
        console.log('\n⚠️  Hunter.io API Issues:');
        console.log('   - Check if API key is valid');
        console.log('   - Verify account has credits');
        console.log('   - Email discovery will be limited');
    }

    if (!results.chatgpt) {
        console.log('\n⚠️  ChatGPT API Issues:');
        console.log('   - Check if API key is valid');
        console.log('   - Verify account has credits');
        console.log('   - This is SECONDARY AI fallback');
    }

    if (!results.claude) {
        console.log('\n⚠️  Claude API Issues:');
        console.log('   - Check if API key is valid');
        console.log('   - Verify account has credits');
        console.log('   - This is PRIMARY AI source');
    }

    if (working >= 3) {
        console.log('\n✅ Good news: You have enough working APIs for owner name retrieval!');
        console.log('   The system will work with the available APIs.');
    } else {
        console.log('\n⚠️  Warning: Only ' + working + ' APIs working.');
        console.log('   Owner name retrieval may be limited.');
    }

    console.log('\n' + '='.repeat(60));
}

// Run tests
runTests().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
});
