/**
 * API server bootstrap for slicing, pricing, health, and Swagger endpoints.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { randomUUID } = require('node:crypto');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();
const createSwaggerDocument = require('./docs/swagger-docs');
const pricingRoutes = require('./routes/pricing.routes');
const { createSliceRouter } = require('./routes/slice.routes');
const systemRoutes = require('./routes/system.routes');
const errorHandler = require('./middleware/errorHandler');
const { createCorsOptionsResolver, parseAllowedOrigins } = require('./middleware/corsPolicy');
const { createRequireSliceService } = require('./middleware/requireSliceService');
const { PORT, DEFAULTS } = require('./config/constants');
const { ensureRequiredDirectories } = require('./config/paths');
const { resolveSliceServiceApiKey } = require('./config/service-auth');
const { loadPricingFromDisk, getPricing } = require('./services/pricing.service');
const { createBoundedHttpServer } = require('./services/http-server');
const { auditWorkspacesThenListen } = require('./services/slice/workspace');
const { beginSliceQueueShutdown } = require('./services/slice/queue');
const { createRuntimeLifecycle } = require('./services/runtime-lifecycle');

// Security check for critical environment variables
if (!process.env.ADMIN_API_KEY) {
    console.error('[SECURITY] ADMIN_API_KEY is missing. Refusing to start server.');
    process.exit(1);
}

let sliceServiceApiKey;
try {
    sliceServiceApiKey = resolveSliceServiceApiKey(process.env);
} catch {
    console.error('[SECURITY] Service authentication configuration is invalid. Refusing to start server.');
    process.exit(1);
}

// Initialize required directories and load pricing data
ensureRequiredDirectories();
loadPricingFromDisk();

/** @type {import('express').Express} */
const app = express();
const runtimeLifecycle = createRuntimeLifecycle({ beginQueueShutdown: beginSliceQueueShutdown });
const sliceRoutes = createSliceRouter({
    authenticate: createRequireSliceService({ apiKey: sliceServiceApiKey })
});

const standardHelmet = helmet();
const docsHelmet = helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
            scriptSrc: ["'self'", "'unsafe-inline'", 'https:'],
            connectSrc: ["'self'", 'https:'],
            fontSrc: ["'self'", 'data:', 'https:']
        }
    }
});

/**
 * Parse comma-separated origin list from environment.
 * @param {string | undefined} value Raw environment value.
 * @returns {string[]} Normalized origins.
 */
function parseCsvValues(value) {
    return String(value || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

const resolveCorsOptions = createCorsOptionsResolver({
    adminAllowedOrigins: parseAllowedOrigins(process.env.ADMIN_CORS_ALLOWED_ORIGINS),
    sliceAllowedOrigins: parseAllowedOrigins(process.env.SLICE_CORS_ALLOWED_ORIGINS)
});

/**
 * Resolve Express trust proxy setting from environment.
 * TRUST_PROXY must be explicitly set to `true` to trust forwarded headers.
 * @returns {false | string[]}
 */
function resolveTrustProxySetting() {
    if (process.env.TRUST_PROXY !== 'true') {
        return false;
    }

    const trustedCidrs = parseCsvValues(process.env.TRUST_PROXY_CIDRS);
    if (trustedCidrs.length > 0) {
        return trustedCidrs;
    }

    console.warn('[SECURITY] TRUST_PROXY=true but TRUST_PROXY_CIDRS is empty; disabling proxy trust.');
    return false;
}

const trustProxySetting = resolveTrustProxySetting();
app.set('trust proxy', trustProxySetting);

app.use((req, res, next) => {
    const isDocsRoute = req.path === '/openapi.json' || req.path.startsWith('/docs');
    if (isDocsRoute) {
        return docsHelmet(req, res, next);
    }

    return standardHelmet(req, res, next);
});

app.use(cors(resolveCorsOptions));

app.use((req, res, next) => {
    const requestId = String(req.header('x-request-id') || randomUUID());
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
});

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || DEFAULTS.JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: process.env.FORM_BODY_LIMIT || DEFAULTS.FORM_BODY_LIMIT }));

// Swagger UI setup
const swaggerUiOptions = {
    swaggerOptions: {
        url: '/openapi.json',
        docExpansion: 'none',
        operationsSorter: 'method',
        defaultModelsExpandDepth: -1
    },
    customCss: '.parameters-col_description .parameter__in { display: none !important; }'
};

/**
 * Apply no-cache headers to documentation responses.
 * @param {import('express').Response} res Express response instance.
 * @returns {void}
 */
function setNoCacheHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
}

// API Documentation endpoints
app.get('/openapi.json', (req, res) => {
    setNoCacheHeaders(res);
    return res.status(200).json(createSwaggerDocument(getPricing()));
});

// Serve Swagger UI with custom options and no-cache headers
app.use(
    '/docs',
    swaggerUi.serve,
    (req, res, next) => {
        setNoCacheHeaders(res);
        return swaggerUi.setup(undefined, swaggerUiOptions)(req, res, next);
    }
);
app.get('/', (req, res) => res.redirect('/docs'));

// API Routes
app.use(pricingRoutes);
app.use(sliceRoutes);
app.use(systemRoutes);

// Catch-all for unknown routes
app.all('*', (req, res) => {
    console.warn(`[ROUTING] Unknown or invalid request: ${req.method} ${req.originalUrl}`);
    return res.status(404).json({
        success: false,
        error: 'Route not found.',
        errorCode: 'ROUTE_NOT_FOUND'
    });
});

// Global error handler
app.use(errorHandler);

const httpServer = createBoundedHttpServer(app);

/**
 * Audit positively identified stale workspaces before accepting traffic.
 * S1a intentionally keeps production startup audit-only because total request lifetime is not bounded yet.
 */
async function startServer() {
    return auditWorkspacesThenListen({
        auditOptions: {
            staleAgeMs: process.env.JOB_WORKSPACE_STALE_AGE_MS,
            logger: console
        },
        onAudit(audit) {
            console.info('[STARTUP] Slice workspace audit complete.', audit);
        },
        listen() {
            if (runtimeLifecycle.isShuttingDown()) return null;
            httpServer.listen(PORT, () => {
                console.log(`FDM and SLA Slicer Engine running on port ${PORT}`);
                console.log(`Swagger Docs available at http://localhost:${PORT}/docs`);
            });
            return httpServer;
        }
    });
}

runtimeLifecycle.run(startServer).catch(() => {
    console.error('[STARTUP] Slice workspace audit failed. Refusing to listen.');
    process.exitCode = 1;
});
