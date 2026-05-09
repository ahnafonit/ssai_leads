/**
 * HTTP API: Google Places discovery and optional Smarty-based residence / commercial classification.
 */

'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config({ override: true });

const {
    scrapeGoogleMaps,
    reverseGeocode,
    calculateAreaCenter,
    delay
} = require('./src/services/googlePlaces');

const {
    classifyResidenceBatch
} = require('./src/services/residenceClassification');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(
    cors({
        origin(origin, callback) {
            const allowed = [
                'http://localhost:3005',
                'https://lead-scraper-frontend-372172131227.us-central1.run.app',
                process.env.FRONTEND_URL
            ].filter(Boolean);

            if (!origin || allowed.includes(origin) || origin.endsWith('.run.app')) {
                callback(null, true);
            } else {
                callback(null, false);
            }
        },
        credentials: true
    })
);
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use('/api/', limiter);

/**
 * When true, runs the residence classification step (Smarty RDI) after discovery.
 * `classifyResidence` is preferred. `enrichContacts` is accepted as a legacy alias.
 */
function resolveClassifyResidenceFlag(body) {
    const { classifyResidence, enrichContacts } = body;
    if (classifyResidence === false || enrichContacts === false) {
        return false;
    }
    return Boolean(classifyResidence || enrichContacts);
}

function collectIgnoredClientFlags(body) {
    const ignored = [];
    if (body.useApolloSearch === true) {
        ignored.push('useApolloSearch is ignored; discovery is Google Places only.');
    }
    if (body.enrichWithApollo === true) {
        ignored.push('enrichWithApollo is ignored; use classifyResidence for Smarty classification.');
    }
    if (body.enrichmentOptions != null && Object.keys(body.enrichmentOptions).length > 0) {
        ignored.push('enrichmentOptions is ignored; use residenceClassificationOptions.');
    }
    return ignored;
}

function firstConfigApplied(results) {
    return results.map(r => r.residenceClassificationConfigApplied).filter(Boolean)[0] || null;
}

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.post('/api/scrape', async (req, res) => {
    try {
        const {
            query,
            location,
            zipcode,
            country,
            maxLeads,
            residenceClassificationOptions: bodyRcOptions
        } = req.body;

        if (!query || !location) {
            return res.status(400).json({
                error: 'Both query and location are required'
            });
        }

        const classifyFlag = resolveClassifyResidenceFlag(req.body);
        const ignoredFlags = collectIgnoredClientFlags(req.body);

        console.log(`[Scrape:Google] ${query} @ ${location}`);

        const results = await scrapeGoogleMaps(query, location, null, zipcode, country, maxLeads || 60);

        const finalResults = classifyFlag
            ? await classifyResidenceBatch(results, bodyRcOptions || {})
            : results;

        res.json({
            success: true,
            results: finalResults,
            count: finalResults.length,
            searchSource: 'Google Places',
            pipeline: 'google',
            phase1DiscoveryOnly: true,
            ignoredFlags,
            residenceClassificationRan: classifyFlag,
            residenceClassificationApplied: classifyFlag ? firstConfigApplied(finalResults) : null,
            query,
            location,
            zipcode: zipcode || null,
            country: country || null,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Scrape error:', error);
        res.status(500).json({
            error: 'Failed to scrape data',
            message: error.message
        });
    }
});

app.post('/api/scrape-area', async (req, res) => {
    try {
        const {
            query,
            area,
            zipcode,
            country,
            maxLeads,
            residenceClassificationOptions: bodyRcOptions
        } = req.body;

        if (!query || !area) {
            return res.status(400).json({
                error: 'Both query and area are required'
            });
        }

        const classifyFlag = resolveClassifyResidenceFlag(req.body);
        const ignoredFlags = collectIgnoredClientFlags(req.body);
        const cap = maxLeads || 60;

        let allResults = [];
        const detectedLocations = [];

        async function finalizeAndSend(uniqueSlice, polygonsSearched, totalBeforeDedup) {
            const finalResults = classifyFlag
                ? await classifyResidenceBatch(uniqueSlice, bodyRcOptions || {})
                : uniqueSlice;

            res.json({
                success: true,
                results: finalResults,
                count: finalResults.length,
                searchSource: 'Google Places',
                pipeline: 'google',
                phase1DiscoveryOnly: true,
                ignoredFlags,
                residenceClassificationRan: classifyFlag,
                residenceClassificationApplied: classifyFlag ? firstConfigApplied(finalResults) : null,
                query,
                area,
                detectedLocations,
                polygonsSearched,
                totalResultsBeforeDedup: totalBeforeDedup,
                zipcode: zipcode || null,
                country: country || null,
                timestamp: new Date().toISOString()
            });
        }

        if (area.type === 'multipolygon' && area.polygons && area.polygons.length > 0) {
            const leadsPerPolygon = Math.ceil((cap * 1.5) / area.polygons.length);

            for (let i = 0; i < area.polygons.length; i++) {
                const polygon = area.polygons[i];
                const singlePolygonArea = {
                    type: 'polygon',
                    coordinates: polygon
                };

                const center = calculateAreaCenter(singlePolygonArea);

                if (!center || center.lat == null || center.lng == null) {
                    continue;
                }

                let location = await reverseGeocode(center.lat, center.lng);
                if (location) detectedLocations.push(location);

                if (!location) {
                    location = `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
                }

                const polygonResults = await scrapeGoogleMaps(
                    query,
                    location,
                    singlePolygonArea,
                    zipcode,
                    country,
                    leadsPerPolygon
                );

                allResults = allResults.concat(polygonResults);

                if (allResults.length >= cap * 1.2) {
                    break;
                }

                if (i < area.polygons.length - 1) {
                    await delay(1000);
                }
            }

            const uniqueResults = [];
            const seenPlaceIds = new Set();

            for (const result of allResults) {
                if (result.placeId && !seenPlaceIds.has(result.placeId)) {
                    seenPlaceIds.add(result.placeId);
                    uniqueResults.push(result);
                }
            }

            const finalSlice = uniqueResults.slice(0, cap);
            await finalizeAndSend(finalSlice, area.polygons.length, allResults.length);
        } else {
            const center = calculateAreaCenter(area);

            if (!center || center.lat == null || center.lng == null) {
                return res.status(400).json({
                    error: 'Could not compute center for the given area'
                });
            }

            let location = await reverseGeocode(center.lat, center.lng);
            if (location) detectedLocations.push(location);

            if (!location) {
                location = `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
            }

            const results = await scrapeGoogleMaps(query, location, area, zipcode, country, cap);

            const finalResults = classifyFlag
                ? await classifyResidenceBatch(results, bodyRcOptions || {})
                : results;

            res.json({
                success: true,
                results: finalResults,
                count: finalResults.length,
                searchSource: 'Google Places',
                pipeline: 'google',
                phase1DiscoveryOnly: true,
                ignoredFlags,
                residenceClassificationRan: classifyFlag,
                residenceClassificationApplied: classifyFlag ? firstConfigApplied(finalResults) : null,
                query,
                area,
                detectedLocation: location,
                zipcode: zipcode || null,
                country: country || null,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        console.error('Area scrape error:', error);
        res.status(500).json({
            error: 'Failed to scrape area data',
            message: error.message
        });
    }
});

app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

app.listen(PORT, () => {
    console.log(`Lead Scraper Backend running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;
