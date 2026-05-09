'use strict';

function envBool(key, defaultVal) {
    const v = process.env[key];
    if (v === undefined || v === '') return defaultVal;
    return /^1|true|yes|on$/i.test(String(v).trim());
}

function residenceClassificationEnvFlags() {
    return {
        smartyDisabled:
            envBool('RESIDENCE_CLASSIFY_DISABLE_SMARTY', false) ||
            envBool('ENRICH_DISABLE_SMARTY', false)
    };
}

/**
 * @param {object} requestOptions Partial flags from the client body (`residenceClassificationOptions`).
 * @returns {{ smarty: boolean }}
 */
function mergeResidenceClassificationOptions(requestOptions = {}) {
    const env = residenceClassificationEnvFlags();
    const smarty = requestOptions.smarty !== false && !env.smartyDisabled;
    return { smarty };
}

module.exports = {
    mergeResidenceClassificationOptions,
    residenceClassificationEnvFlags
};
