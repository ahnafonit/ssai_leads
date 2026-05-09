'use strict';

/** Min model-reported confidence (0–100) to accept strict-AI ownerName. Override with STRICT_AI_MIN_CONFIDENCE. */
const STRICT_AI_MIN_CONFIDENCE = Number(process.env.STRICT_AI_MIN_CONFIDENCE) || 75;

/**
 * Min confidence when Anthropic strict mode used web_search at least once (snippets differ from full Maps UI).
 * Defaults to STRICT_AI_MIN_CONFIDENCE if unset. Override with STRICT_AI_MIN_CONFIDENCE_WEB.
 */
const STRICT_AI_MIN_CONFIDENCE_WEB =
    process.env.STRICT_AI_MIN_CONFIDENCE_WEB !== undefined && process.env.STRICT_AI_MIN_CONFIDENCE_WEB !== ''
        ? Number(process.env.STRICT_AI_MIN_CONFIDENCE_WEB)
        : STRICT_AI_MIN_CONFIDENCE;

function envBool(key, defaultVal) {
    const v = process.env[key];
    if (v === undefined || v === '') return defaultVal;
    return /^1|true|yes|on$/i.test(String(v).trim());
}

function enrichmentEnvFlags() {
    return {
        hunterDisabled: envBool('ENRICH_DISABLE_HUNTER', false),
        pdlDisabled: envBool('ENRICH_DISABLE_PDL', false),
        aiDisabled: envBool('ENRICH_DISABLE_AI', false),
        smartyDisabled: envBool('ENRICH_DISABLE_SMARTY', false),
        /** When true, PDL runs if request does not pass pdl: false */
        pdlEnableDefault: envBool('ENRICH_ENABLE_PDL', false)
    };
}

function mergeEnrichmentOptions(requestOptions = {}) {
    const env = enrichmentEnvFlags();
    const hunter = requestOptions.hunter !== false && !env.hunterDisabled;
    const pdlExplicitOff = requestOptions.pdl === false;
    const pdlExplicitOn = requestOptions.pdl === true;
    const pdl = !env.pdlDisabled && !pdlExplicitOff && (pdlExplicitOn || env.pdlEnableDefault);
    const ai = requestOptions.ai !== false && !env.aiDisabled;
    const smarty = requestOptions.smarty !== false && !env.smartyDisabled;
    const pdlMaxResults = Math.min(
        10,
        Math.max(1, Number(requestOptions.pdlMaxResults) || 1)
    );
    return {
        hunter,
        pdl,
        ai,
        smarty,
        pdlMaxResults,
        pdlMode: pdl ? 'on' : 'off'
    };
}

module.exports = {
    STRICT_AI_MIN_CONFIDENCE,
    STRICT_AI_MIN_CONFIDENCE_WEB,
    mergeEnrichmentOptions,
    enrichmentEnvFlags
};
