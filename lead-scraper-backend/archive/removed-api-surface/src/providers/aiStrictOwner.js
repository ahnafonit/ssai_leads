'use strict';

const { step } = require('../utils/providerEnvelope');
const { STRICT_AI_MIN_CONFIDENCE, STRICT_AI_MIN_CONFIDENCE_WEB } = require('../config/enrichmentDefaults');

function envBool(key, defaultVal = false) {
    const v = process.env[key];
    if (v === undefined || v === '') return defaultVal;
    return /^1|true|yes|on$/i.test(String(v).trim());
}

/** Default Google-owned domains for Anthropic web_search when focusing on Maps / reviews (comma-separated override: ANTHROPIC_WEB_SEARCH_ALLOWED_DOMAINS). */
const DEFAULT_WEB_SEARCH_GOOGLE_DOMAINS = [
    'google.com',
    'www.google.com',
    'google.ca',
    'www.google.ca',
    'maps.google.com',
    'maps.google.ca',
    'business.google.com',
    'business.google.ca'
];

function anthropicWebSearchEnabled() {
    return envBool('ANTHROPIC_STRICT_WEB_SEARCH', false);
}

/**
 * Domain policy for web_search.
 * - Env unset/empty → default Google-only list.
 * - ANTHROPIC_WEB_SEARCH_ALLOWED_DOMAINS=* | all | open | any → no allowlist (general web).
 * - Otherwise comma-separated domains.
 */
function getWebSearchDomainPolicy() {
    const raw = process.env.ANTHROPIC_WEB_SEARCH_ALLOWED_DOMAINS;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return {
            mode: 'filtered',
            allowed_domains: [...DEFAULT_WEB_SEARCH_GOOGLE_DOMAINS],
            summary: 'Google-owned domains only (default).'
        };
    }
    const token = String(raw).trim().toLowerCase();
    if (token === '*' || token === 'all' || token === 'open' || token === 'any') {
        return {
            mode: 'open',
            summary: 'No domain filter — general web (news, blogs, official sites).'
        };
    }
    const allowed_domains = String(raw)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (allowed_domains.length === 0) {
        return {
            mode: 'filtered',
            allowed_domains: [...DEFAULT_WEB_SEARCH_GOOGLE_DOMAINS],
            summary: 'Google-owned domains only (fallback — empty list).'
        };
    }
    return {
        mode: 'filtered',
        allowed_domains,
        summary: `Allowed domains: ${allowed_domains.join(', ')}.`
    };
}

function webSearchMaxUsesConfig() {
    return Math.min(10, Math.max(1, Number(process.env.ANTHROPIC_WEB_SEARCH_MAX_USES) || 4));
}

/** Extract hostname for site:example.com queries (no path). */
function websiteHostForSearch(lead) {
    const w = lead.website;
    if (!w || w === 'N/A') return null;
    const s = String(w).trim();
    try {
        const u = new URL(s.startsWith('http') ? s : `https://${s}`);
        return u.hostname.replace(/^www\./i, '') || null;
    } catch {
        return null;
    }
}

function buildStrictSystemOffline() {
    return [
        'You are a careful fact assistant for business leads.',
        'You do NOT have live internet access; you only see what is in this message (plus your general training knowledge, used only as described below).',
        'You MUST NOT infer, pattern-guess, or invent owner names.',
        'NEVER treat a personal name that appears only in the business/brand/company name as proof that person is the owner (eponymous businesses: e.g. "Orhan London Tailoring", "Joe\'s Pizza"). Matching the trade name to a person is forbidden unless a separate excerpt or source explicitly states they own or run the business.',
        'When "Google Maps review excerpts" are supplied in the user message for THIS listing, PRIORITIZE those excerpts over vague training knowledge: you MAY return ownerName only if an excerpt clearly identifies someone as owner, proprietor, co-owner, or the person who runs the business (not a generic employee or first name only).',
        'When review excerpts are NOT supplied or they do not clearly identify an owner, you MAY still return an owner/decision-maker name ONLY when you have a clear, attributable public fact from training knowledge (for example widely reported leadership of a recognizable company).',
        'Do NOT derive names from the business suffix (for example guessing a surname for "Joe\'s Pizza"), ethnicity, geography, or industry stereotypes.',
        'If you are not highly certain under these rules, return ownerName null and confidence 0.',
        'publicBasis must quote or closely paraphrase the factual sentence that supports ownerName (not "the name sounds like the shop").',
        'Reply with JSON ONLY, no prose.'
    ].join('\n');
}

function buildStrictSystemWebSearch() {
    const policy = getWebSearchDomainPolicy();
    const domainScope =
        policy.mode === 'open'
            ? 'This session has NO domain allowlist on web_search — results may include local news, blogs, and official sites. Still match every claim to THIS listing (name + city + address/phone when given).'
            : `web_search results are limited to allowed domains (${policy.summary}) Prefer google.com / Maps / Business snippets when they identify this listing.`;

    return [
        'You are a careful fact assistant for business leads.',
        'You have access to the web_search tool. Use it per the numbered search plan in the user message before answering.',
        domainScope,
        'Evidence rule: ownerName must come ONLY from (a) text you see in web_search tool results in THIS conversation (snippets/titles tied to this listing), or (b) Google Maps review excerpts pasted in the user message. Do NOT fill ownerName from model memory alone — no training-data guesses.',
        'NEVER infer owner from the business/brand name alone (e.g. "Orhan London Tailoring" does not prove "Orhan" is the owner). A name in the trade name counts as ZERO evidence unless a snippet or excerpt explicitly states that person owns, runs, or is the proprietor/chef/decision-maker for this venue.',
        'Google Maps / GBP snippets count only when they explicitly describe a person\'s role or quote reviews naming them — not merely because a Maps title line echoes the brand name.',
        'Restaurants: local press or official site text naming owner/chef for THIS address/city is valid only when that wording appears in web_search results you received (quote it in publicBasis).',
        'For multiple principals (e.g. chef duo), ownerName may be one string like "First Last & First Last" — each name must appear in cited snippet/excerpt evidence.',
        'You MUST NOT invent names. Do NOT match unrelated businesses with similar names.',
        'If no snippet or excerpt explicitly supports an owner/decision-maker for THIS listing after searching, return ownerName null and confidence 0.',
        'publicBasis MUST include a short quoted or tightly paraphrased line from the snippet/excerpt that states the role — not a justification based on the business name sounding like a person.',
        'After you have used web_search as needed, reply with JSON ONLY, no other prose (your final message must be JSON only).',
        'Reply with JSON ONLY matching the schema in the user message.'
    ].join('\n');
}

function buildStrictUserPrompt(lead, webSearch = false) {
    const lines = [
        `Business name: ${lead.companyName}`,
        `Phone (from discovery): ${lead.phone && lead.phone !== 'N/A' ? lead.phone : 'unknown'}`,
        `Address (from discovery): ${lead.address && lead.address !== 'N/A' ? lead.address : 'unknown'}`,
        `Location: ${lead.city || 'unknown'}, ${lead.state || ''} ${lead.country || ''}`.trim(),
        `Industry / category hint: ${lead.industry || 'unknown'}`,
        lead.website && lead.website !== 'N/A' ? `Website: ${lead.website}` : 'Website: unknown'
    ];

    const excerpts = Array.isArray(lead.googleReviewExcerpts) ? lead.googleReviewExcerpts.filter(Boolean) : [];
    if (excerpts.length > 0) {
        lines.push('');
        lines.push('Google Maps review excerpts (user-generated; prioritize these for owner identification when they clearly name an owner/manager):');
        excerpts.forEach((text, i) => {
            lines.push(`[${i + 1}] ${text}`);
        });
    }

    if (webSearch) {
        const nameQ = String(lead.companyName || '').replace(/"/g, '\\"');
        const cityQ = String(lead.city || '').replace(/"/g, '\\"');
        const addrQ = lead.address && lead.address !== 'N/A' ? String(lead.address).replace(/"/g, '\\"') : '';
        const maxUses = webSearchMaxUsesConfig();
        const policy = getWebSearchDomainPolicy();
        const host = websiteHostForSearch(lead);

        lines.push('');
        lines.push(`Web search plan (max ${maxUses} web_search calls; use in order; stop early if you already have a clear owner/decision-maker with citable evidence):`);
        lines.push(
            `1) Google Maps / reviews / Business Profile — e.g. "${nameQ}" "${cityQ}" reviews` +
                (addrQ ? ` OR include "${addrQ}"` : '') +
                ' OR site:google.com/maps. Confirm same business (phone/address).'
        );
        if (host) {
            lines.push(`2) Official site — e.g. site:${host} owner OR about OR team OR chef OR contact.`);
        } else {
            lines.push('2) Official site — skip tailored site: query (no usable website URL); optionally use the business name + "official website" if needed later.');
        }
        lines.push(
            `3) Broader web / local press — e.g. "${nameQ}" "${cityQ}" owner OR chef OR founder` +
                (policy.mode === 'open'
                    ? ' (news, food blogs, city guides).'
                    : ' — note: domain filter may hide some articles; use what appears in allowed results.')
        );
        lines.push(
            `4) Remaining call(s) — disambiguate or confirm names for THIS listing only (same address/city/phone context); avoid unrelated venues with similar names.`
        );
        lines.push(`Domain policy: ${policy.summary}`);
        lines.push(
            '- Extract names only when snippets or pasted review excerpts clearly tie a person to THIS business as owner/proprietor/chef/decision-maker — not because they match the trade name.',
            `- Target confidence >= ${STRICT_AI_MIN_CONFIDENCE_WEB} only when that explicit evidence exists; otherwise ownerName null and confidence 0.`
        );
    }

    lines.push(
        '',
        'Hard rules (no guessing):',
        '- NEVER output ownerName because a personal name appears in companyName / brand alone (eponymous shop names are not evidence).',
        '- ownerName requires explicit supporting text: a sentence from web_search results or pasted excerpts that states the role or names the owner/managing chef for this listing.',
        ''
    );

    lines.push(
        `Return ONLY valid JSON matching this schema:`,
        `{"ownerName": string|null, "confidence": number 0-100, "attribution": string|null, "publicBasis": string|null}`,
        'confidence must be YOUR probability that ownerName is correct under the rules above.',
        webSearch
            ? `Use confidence 0 and ownerName null when no snippet or excerpt explicitly supports an owner for THIS listing (including: do not infer from business name alone). When explicit evidence exists in tool results or excerpts, meet or exceed ${STRICT_AI_MIN_CONFIDENCE_WEB}.`
            : `If confidence would be below ${STRICT_AI_MIN_CONFIDENCE}, set ownerName to null and confidence to 0.`
    );

    return lines.join('\n');
}

function extractAnthropicTextContent(message) {
    if (!message || !Array.isArray(message.content)) return '';
    return message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
}

function parseJsonObjectFromModelText(text) {
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || text.match(/\{[\s\S]*\}/);
    const raw = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
    return JSON.parse(raw);
}

async function openaiStrictJson(openai, lead) {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') return null;

    const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_STRICT_MODEL || 'gpt-4o',
        temperature: 0.15,
        max_tokens: 400,
        messages: [
            { role: 'system', content: buildStrictSystemOffline() },
            { role: 'user', content: buildStrictUserPrompt(lead, false) }
        ]
    });

    const response = completion.choices[0].message.content || '';
    const parsed = parseJsonObjectFromModelText(response);

    return { provider: 'openai', parsed };
}

function anthropicUserLocation(lead) {
    const city = lead.city && String(lead.city).trim() && lead.city !== 'N/A' ? String(lead.city).trim() : null;
    const region = lead.state && String(lead.state).trim() ? String(lead.state).trim() : null;
    const c = lead.country && String(lead.country).trim() ? String(lead.country).trim().toLowerCase() : '';
    let country = null;
    if (c === 'usa' || c === 'united states' || c === 'u.s.' || c === 'us') country = 'US';
    if (c === 'uk' || c === 'gb' || c === 'united kingdom' || c === 'great britain' || c === 'england') country = 'GB';
    if (c === 'canada') country = 'CA';
    if (!city && !region && !country) return undefined;
    return {
        type: 'approximate',
        city,
        region,
        country
    };
}

async function anthropicStrictJson(anthropic, lead) {
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_claude_api_key_here') {
        return null;
    }

    const webSearch = anthropicWebSearchEnabled();
    const system = webSearch ? buildStrictSystemWebSearch() : buildStrictSystemOffline();
    const userBody = `${system}\n\n${buildStrictUserPrompt(lead, webSearch)}`;

    const model = process.env.ANTHROPIC_STRICT_MODEL || 'claude-sonnet-4-20250514';
    const maxUses = webSearchMaxUsesConfig();
    const domainPolicy = getWebSearchDomainPolicy();

    const webSearchTool = webSearch
        ? (() => {
            const tool = {
                name: 'web_search',
                type: 'web_search_20250305',
                max_uses: maxUses,
                user_location: anthropicUserLocation(lead)
            };
            if (domainPolicy.mode === 'filtered' && domainPolicy.allowed_domains && domainPolicy.allowed_domains.length > 0) {
                tool.allowed_domains = domainPolicy.allowed_domains;
            }
            return tool;
        })()
        : null;

    let messages = [
        {
            role: 'user',
            content: [{ type: 'text', text: userBody }]
        }
    ];

    let msg = null;
    let webSearchToolResultBlocks = 0;
    for (let turn = 0; turn < 8; turn++) {
        const req = {
            model,
            max_tokens: webSearch ? 2048 : 800,
            temperature: 0.15,
            messages
        };
        if (webSearchTool) req.tools = [webSearchTool];

        msg = await anthropic.messages.create(req);

        for (const b of msg.content || []) {
            if (b.type === 'web_search_tool_result') webSearchToolResultBlocks++;
        }

        if (msg.stop_reason !== 'pause_turn') break;

        messages = messages.concat([{ role: 'assistant', content: msg.content }]);
    }

    const text = extractAnthropicTextContent(msg);
    if (!text) {
        throw new Error('anthropic_strict_empty_text');
    }

    const parsed = parseJsonObjectFromModelText(text);

    const su = msg.usage && msg.usage.server_tool_use;
    return {
        provider: 'anthropic',
        parsed,
        meta: {
            strictWebSearchEnabled: webSearch,
            webSearchDomainMode: domainPolicy.mode,
            webSearchRequests: su ? su.web_search_requests ?? 0 : 0,
            webFetchRequests: su ? su.web_fetch_requests ?? 0 : 0,
            webSearchToolResultBlocks,
            stopReason: msg.stop_reason
        }
    };
}

function acceptStrictCandidate(parsed, providerLabel, meta = {}) {
    const name = parsed.ownerName === null || parsed.ownerName === undefined
        ? null
        : String(parsed.ownerName).trim();

    if (!name || name === '' || name.toLowerCase() === 'n/a' || name.toLowerCase() === 'unknown') {
        return null;
    }

    const conf = Number(parsed.confidence);
    const minConf =
        meta.strictWebSearchEnabled && Number(meta.webSearchRequests) > 0
            ? STRICT_AI_MIN_CONFIDENCE_WEB
            : STRICT_AI_MIN_CONFIDENCE;

    if (!Number.isFinite(conf) || conf < minConf) {
        return null;
    }

    const basis = parsed.publicBasis != null ? String(parsed.publicBasis).trim() : '';
    if (!basis) return null;

    return {
        ownerName: name,
        aiConfidence: conf,
        ownerDataSource: `AI (${providerLabel}, strict attribution)`,
        ownerVerified: false,
        aiAttribution: parsed.attribution ?? null,
        aiPublicBasis: basis
    };
}

async function pingOpenAI(openai) {
    if (!process.env.OPENAI_API_KEY) return { ok: false, error: 'no_key' };
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 24,
        messages: [{ role: 'user', content: 'Respond with JSON only: {"ok":true}' }]
    });
    const t = completion.choices[0].message.content || '';
    return { ok: t.includes('true') || /\{"ok"\s*:\s*true\}/i.test(t), raw: t };
}

async function pingAnthropic(anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'no_key' };
    const msg = await anthropic.messages.create({
        model: process.env.ANTHROPIC_STRICT_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 50,
        temperature: 0,
        messages: [{ role: 'user', content: 'Reply with JSON only: {"ok":true}' }]
    });
    const t = msg.content[0].text;
    return { ok: /"ok"\s*:\s*true/.test(t) || t.includes('"ok": true'), raw: t };
}

async function runStrictAiAdapter(lead, ctx) {
    const t0 = Date.now();
    const { openai, anthropic } = ctx.clients;

    if (!ctx.opts.ai) {
        return {
            envelope: step('ai_strict', { status: 'skipped', skipReason: 'disabled', durationMs: Date.now() - t0 }),
            lead
        };
    }

    if ((lead.ownerName && lead.ownerName !== 'Owner Not Found') && lead.ownerVerified) {
        return {
            envelope: step('ai_strict', { status: 'skipped', skipReason: 'already_resolved', durationMs: Date.now() - t0 }),
            lead
        };
    }

    const attempts = [];

    async function trial(label, runner) {
        try {
            const raw = await runner();
            if (!raw) {
                attempts.push({ provider: label, ok: false, error: 'not_configured' });
                return null;
            }
            const patch = acceptStrictCandidate(raw.parsed, raw.provider, raw.meta || {});
            const row = {
                provider: label,
                ok: !!patch,
                confidence: Number(raw.parsed?.confidence),
                rejection: patch ? undefined : parseRejection(raw.parsed)
            };
            if (raw.meta && typeof raw.meta === 'object') {
                Object.assign(row, raw.meta);
            }
            if (patch) {
                row.acceptedOwnerName = patch.ownerName;
                row.acceptedAiConfidence = patch.aiConfidence;
                row.acceptedPublicBasisPreview =
                    patch.aiPublicBasis != null ? String(patch.aiPublicBasis).slice(0, 600) : null;
            } else if (raw.parsed) {
                row.modelOwnerName =
                    raw.parsed.ownerName === null || raw.parsed.ownerName === undefined
                        ? null
                        : String(raw.parsed.ownerName);
                row.modelPublicBasisPreview =
                    raw.parsed.publicBasis != null ? String(raw.parsed.publicBasis).slice(0, 600) : null;
            }
            attempts.push(row);
            return patch;
        } catch (e) {
            attempts.push({ provider: label, ok: false, error: e.message });
            return null;
        }
    }

    let patch = null;
    const anthropicFirst = ctx.aiPreferredOrder !== 'openai_first';

    if (anthropicFirst) {
        patch = await trial('anthropic', () => anthropicStrictJson(anthropic, lead));
        if (!patch) {
            patch = await trial('openai', () => openaiStrictJson(openai, lead));
        }

    } else {
        patch = await trial('openai', () => openaiStrictJson(openai, lead));
        if (!patch) {
            patch = await trial('anthropic', () => anthropicStrictJson(anthropic, lead));
        }
    }

    if (patch) {
        return {
            envelope: step('ai_strict', {
                status: 'ok',
                message: 'accepted',
                durationMs: Date.now() - t0,
                attempts
            }),
            lead: { ...lead, ...patch }
        };
    }

    return {
        envelope: step('ai_strict', {
            status: 'ok',
            message: 'below_threshold_or_no_fact',
            durationMs: Date.now() - t0,
            attempts
        }),
        lead: {
            ...lead,
            strictAiRejected: true,
            strictAiAttempts: attempts
        }
    };
}

function parseRejection(parsed) {
    if (!parsed) return null;
    return {
        ownerNameWasNull: !parsed.ownerName,
        confidence: parsed.confidence
    };
}

module.exports = {
    runStrictAiAdapter,
    pingOpenAI,
    pingAnthropic,
    STRICT_AI_MIN_CONFIDENCE,
    STRICT_AI_MIN_CONFIDENCE_WEB
};
