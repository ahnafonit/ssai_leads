'use strict';

const { step } = require('../utils/providerEnvelope');
const { STRICT_AI_MIN_CONFIDENCE } = require('../config/enrichmentDefaults');

const STRICT_SYSTEM = [
    'You are a careful fact assistant for business leads.',
    'You MUST NOT infer, pattern-guess, or invent owner names.',
    'You MAY return an owner/decision-maker name ONLY when you have a clear, attributable public fact from your training knowledge (for example widely reported leadership of a recognizable company).',
    'Do NOT derive names from the business suffix (for example guessing a surname for "Joe\'s Pizza"), ethnicity, geography, or industry stereotypes.',
    'If you are not highly certain from public knowledge, return ownerName null and confidence 0.',
    'Reply with JSON ONLY, no prose.'
].join('\n');

function buildStrictUserPrompt(lead) {
    return [
        `Business name: ${lead.companyName}`,
        `Location: ${lead.city || 'unknown'}, ${lead.state || ''} ${lead.country || ''}`.trim(),
        `Industry / category hint: ${lead.industry || 'unknown'}`,
        lead.website && lead.website !== 'N/A' ? `Website: ${lead.website}` : 'Website: unknown',
        '',
        `Return ONLY valid JSON matching this schema:`,
        `{"ownerName": string|null, "confidence": number 0-100, "attribution": string|null, "publicBasis": string|null}`,
        'confidence must be YOUR probability that ownerName exactly matches publicly reported leadership.',
        `If confidence would be below ${STRICT_AI_MIN_CONFIDENCE}, set ownerName to null and confidence to 0.`
    ].join('\n');
}

async function openaiStrictJson(openai, lead) {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') return null;

    const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_STRICT_MODEL || 'gpt-4o',
        temperature: 0.15,
        max_tokens: 400,
        messages: [
            { role: 'system', content: STRICT_SYSTEM },
            { role: 'user', content: buildStrictUserPrompt(lead) }
        ]
    });

    let response = completion.choices[0].message.content || '';
    const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        response = jsonMatch[1] || jsonMatch[0];
    }
    const parsed = JSON.parse(response);

    return { provider: 'openai', parsed };
}

async function anthropicStrictJson(anthropic, lead) {
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_claude_api_key_here') {
        return null;
    }

    const msg = await anthropic.messages.create({
        model: process.env.ANTHROPIC_STRICT_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 500,
        temperature: 0.15,
        messages: [
            {
                role: 'user',
                content: [{ type: 'text', text: `${STRICT_SYSTEM}\n\n${buildStrictUserPrompt(lead)}` }]
            }
        ]
    });

    let text = msg.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) text = jsonMatch[0];

    const parsed = JSON.parse(text);

    return { provider: 'anthropic', parsed };
}

function acceptStrictCandidate(parsed, providerLabel) {
    const name = parsed.ownerName === null || parsed.ownerName === undefined
        ? null
        : String(parsed.ownerName).trim();

    if (!name || name === '' || name.toLowerCase() === 'n/a' || name.toLowerCase() === 'unknown') {
        return null;
    }

    const conf = Number(parsed.confidence);
    if (!Number.isFinite(conf) || conf < STRICT_AI_MIN_CONFIDENCE) {
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
            const patch = acceptStrictCandidate(raw.parsed, raw.provider);
            attempts.push({
                provider: label,
                ok: !!patch,
                confidence: Number(raw.parsed?.confidence),
                rejection: patch ? undefined : parseRejection(raw.parsed)
            });
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
    STRICT_AI_MIN_CONFIDENCE
};
