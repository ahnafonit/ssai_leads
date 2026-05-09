'use strict';

function step(provider, partial) {
    const base = {
        provider,
        status: 'error',
        durationMs: 0,
        ...partial
    };
    return base;
}

function classifyHttpError(err) {
    const status = err.response?.status;
    if (status === 429 || status === 402) return { skipReason: 'quota', httpStatus: status };
    if (status === 401 || status === 403) return { skipReason: 'http_4xx', httpStatus: status };
    if (status >= 400 && status < 500) return { skipReason: 'http_4xx', httpStatus: status };
    return { skipReason: 'timeout', message: err.message };
}

module.exports = { step, classifyHttpError };
