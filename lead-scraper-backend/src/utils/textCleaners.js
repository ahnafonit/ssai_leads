'use strict';

function cleanPhoneNumber(phone) {
    if (!phone || phone === 'N/A') return 'N/A';
    const phonePattern = /[\d\s\-\(\)\+\.]/g;
    const matches = phone.match(phonePattern);
    if (!matches) return 'N/A';
    const cleaned = matches.join('').trim();
    const digitCount = (cleaned.match(/\d/g) || []).length;
    if (digitCount < 7) return 'N/A';
    return cleaned;
}

function cleanZipcode(zipcode) {
    if (!zipcode || zipcode === 'N/A') return 'N/A';
    let cleaned = zipcode.replace(/[^0-9A-Za-z\s\-]/g, '').trim();
    if (cleaned.length > 15) return 'N/A';
    if (cleaned.match(/United|States|America|Canada|Kingdom|City|County|Street|Avenue|Road/i)) {
        return 'N/A';
    }
    return cleaned;
}

function cleanAddress(address) {
    if (!address || address === 'N/A') return 'N/A';
    const cleaned = address.trim();
    const digitCount = (cleaned.match(/\d/g) || []).length;
    const totalLength = cleaned.length;
    if (digitCount > 7 && (digitCount / totalLength) > 0.4 && totalLength < 30) {
        return 'N/A';
    }
    const phonePatterns = [
        /^\+?1?\s*\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}$/,
        /^\(\d{3}\)\s*\d{3}[\s\-]?\d{4}$/,
        /^\d{3}[\s\-]\d{3}[\s\-]\d{4}$/,
        /^\+\d{1,3}[\s\-]?\d{3,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4}$/
    ];
    for (const pattern of phonePatterns) {
        if (pattern.test(cleaned)) return 'N/A';
    }
    const words = cleaned.split(/\s+/);
    const hasStreetIndicators = /Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Circle|Place|Pl|Square|Sq|Parkway|Pkwy|\d+/i.test(cleaned);
    if (words.length >= 2 && words.length <= 4 && !hasStreetIndicators) {
        const allCapitalized = words.every(word => /^[A-Z][a-z]+$/.test(word));
        if (allCapitalized) return 'N/A';
    }
    if (cleaned.length < 10) return 'N/A';
    return cleaned;
}

module.exports = { cleanPhoneNumber, cleanZipcode, cleanAddress };
