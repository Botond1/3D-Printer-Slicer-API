'use strict';

/** Public conditional-GET surface for the immutable startup profile catalogue. */

const express = require('express');

function normalizeEntityTag(value) {
    return String(value || '').trim().replace(/^W\//i, '');
}

function matchesIfNoneMatch(headerValue, currentEtag) {
    if (typeof headerValue !== 'string' || !headerValue.trim()) return false;
    return headerValue.split(',').some((candidate) => {
        const normalized = candidate.trim();
        return normalized === '*' || normalizeEntityTag(normalized) === currentEtag;
    });
}

function createProfileCatalogueRouter(options = {}) {
    const service = options.service;
    if (!service || typeof service.getSnapshot !== 'function') {
        throw new Error('Profile catalogue service is required.');
    }
    const router = express.Router();
    router.get('/profiles', (req, res) => {
        const snapshot = service.getSnapshot();
        if (!snapshot) {
            res.setHeader('Cache-Control', 'no-store');
            return res.status(503).json({
                success: false,
                error: 'Profile catalogue is unavailable.',
                errorCode: 'PROFILE_CATALOGUE_UNAVAILABLE'
            });
        }
        res.setHeader('ETag', snapshot.etag);
        res.setHeader('Access-Control-Expose-Headers', 'ETag');
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        if (matchesIfNoneMatch(req.get('If-None-Match'), snapshot.etag)) {
            return res.status(304).end();
        }
        return res.status(200).type('application/json').send(snapshot.serializedBody);
    });
    return router;
}

module.exports = {
    createProfileCatalogueRouter,
    matchesIfNoneMatch,
    normalizeEntityTag
};
