'use strict';

/** Min model-reported confidence (0–100) to accept strict-AI ownerName. Override with STRICT_AI_MIN_CONFIDENCE. */
const STRICT_AI_MIN_CONFIDENCE = Number(process.env.STRICT_AI_MIN_CONFIDENCE) || 75;

function envBool(key, defaultVal) {
    const v = process.env[key];
    if (v === undefined || v === '') return defaultVal;
    return /^1|true|yes|on$/i.test(String(v).trim());
}

function enrichmentEnvFlags() {
    return {
        hunterDisabled: envBool('ENRICH_DISABLE_HUNTER', false),
        pdlDisabled: envBool('ENRICH_DISABLE_PDL', false),
        aiDisabled: envBool('ENRICH_DISABLE_AI', false)
    };
}

function mergeEnrichmentOptions(requestOptions = {}) {
    const env = enrichmentEnvFlags();
    const hunter = requestOptions.hunter !== false && !env.hunterDisabled;
    const pdl = requestOptions.pdl !== false && !env.pdlDisabled;
    const ai = requestOptions.ai !== false && !env.aiDisabled;
    const pdlMaxResults = Math.min(
        10,
        Math.max(1, Number(requestOptions.pdlMaxResults) || 1)
    );
    return {
        hunter,
        pdl,
        ai,
        pdlMaxResults
    };
}

module.exports = {
    STRICT_AI_MIN_CONFIDENCE,
    mergeEnrichmentOptions,
    enrichmentEnvFlags
};
