'use strict';

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateAreaCenter(area) {
    if (!area || !area.type) return null;
    if (area.type === 'circle') {
        return area.center;
    }
    if (area.type === 'rectangle') {
        return {
            lat: (area.bounds.north + area.bounds.south) / 2,
            lng: (area.bounds.east + area.bounds.west) / 2
        };
    }
    if (area.type === 'polygon' || area.type === 'polyline') {
        const coords = area.coordinates;
        const sumLat = coords.reduce((sum, c) => sum + c.lat, 0);
        const sumLng = coords.reduce((sum, c) => sum + c.lng, 0);
        return { lat: sumLat / coords.length, lng: sumLng / coords.length };
    }
    if (area.type === 'multipolygon') {
        let totalLat = 0;
        let totalLng = 0;
        let totalPoints = 0;
        area.polygons.forEach(polygon => {
            polygon.forEach(coord => {
                totalLat += coord.lat;
                totalLng += coord.lng;
                totalPoints++;
            });
        });
        return { lat: totalLat / totalPoints, lng: totalLng / totalPoints };
    }
    return null;
}

module.exports = { delay, calculateAreaCenter };
