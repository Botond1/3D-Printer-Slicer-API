/**
 * API server bootstrap for slicing, pricing, health, and Swagger endpoints.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();
const { resolveServiceKeyRing } = require('./config/service-auth');

let serviceKeyRing;
try {
    serviceKeyRing = resolveServiceKeyRing(process.env);
} catch {
    console.error('[SECURITY] Service authentication configuration is invalid. Refusing to start server.');
    process.exit(1);
}

const createSwaggerDocument = require('./docs/swagger-docs');
const { createPricingRouter } = require('./routes/pricing.routes');
const { createProfileCatalogueRouter } = require('./routes/profile-catalogue.routes');
const { createSliceRouter } = require('./routes/slice.routes');
const { createRenderRouter } = require('./routes/render.routes');
const { createSystemRouter } = require('./routes/system.routes');
const errorHandler = require('./middleware/errorHandler');
const { createCorsOptionsResolver, parseAllowedOrigins } = require('./middleware/corsPolicy');
const { createRequireSliceService } = require('./middleware/requireSliceService');
const { createRequireAdminAudience } = require('./middleware/requireAdmin');
const { createRequestIdMiddleware } = require('./middleware/requestId');
const { createRequestObservabilityMiddleware } = require('./middleware/requestObservability');
const { PORT } = require('./config/constants');
const { ensureRequiredDirectories, JOB_SCRATCH_DIR } = require('./config/paths');
const { resolveTrustProxySetting } = require('./config/trust-proxy');
const { resolveResourcePolicy } = require('./config/resource-policy');
const { loadPricingFromDisk, getPricing } = require('./services/pricing.service');
const { createBoundedHttpServer } = require('./services/http-server');
const { auditStaleWorkspaces, auditWorkspacesThenListen } = require('./services/slice/workspace');
const { cleanupManagedArtifacts } = require('./services/artifact-store');
const { beginSliceQueueShutdown } = require('./services/slice/queue');
const { initializeSlicerEngineVersions } = require('./services/slice/engine-version');
const { getBambuPrinterRegistry } = require('./services/slice/bambu-printer-registry');
const { verifyBambuRegistryChains } = require('./services/slice/bambu-profile-chain');
const { configureRetentionObserver } = require('./services/slice/output-lifecycle');
const { createProfileCatalogueService } = require('./services/slice/profile-catalogue');
const { createRuntimeLifecycle } = require('./services/runtime-lifecycle');
const { createReadinessService } = require('./services/readiness.service');
const { emitEvent, setEventWriter } = require('./services/observability/events');
const {
    recordArtifactCleanup,
    setArtifactStatus
} = require('./services/observability/metrics');

setEventWriter((entry) => console.info(JSON.stringify(entry)));

// Initialize required directories and load pricing data
let resourcePolicy;
try {
    resourcePolicy = resolveResourcePolicy(process.env);
} catch {
    console.error('[SECURITY] Resource policy configuration is invalid. Refusing to start server.');
    process.exit(1);
}
ensureRequiredDirectories();
try {
    loadPricingFromDisk();
} catch (error) {
    // Fail closed: an existing pricing file that cannot be trusted is never
    // replaced with defaults. The operator repairs or removes it and restarts.
    console.error(`[SECURITY] Pricing configuration is invalid (${error?.code || 'PRICING_FILE_INVALID'}). Refusing to start server.`);
    process.exit(1);
}

/** @type {import('express').Express} */
const app = express();
let runtimeLifecycle;
const readinessService = createReadinessService({
    isShuttingDown: () => runtimeLifecycle?.isShuttingDown() === true,
    legacyMigration: serviceKeyRing.legacyMigration
});
runtimeLifecycle = createRuntimeLifecycle({
    beginQueueShutdown: beginSliceQueueShutdown,
    onShutdownStart() {
        readinessService.closeAdmission('shutdown');
        emitEvent('shutdown.started', { outcome: 'started' });
    }
});
const authLogger = Object.freeze({
    warn(message, metadata = {}) {
        void message;
        emitEvent('auth.rejected', {
            request_id: metadata.requestId,
            audience: metadata.audience,
            outcome: 'rejected',
            error_code: 'AUTH_REQUIRED'
        });
    }
});
const sliceRoutes = createSliceRouter({
    authenticate: createRequireSliceService({ keyRing: serviceKeyRing, logger: authLogger }),
    resourcePolicy
});
const renderRoutes = createRenderRouter({
    authenticate: createRequireSliceService({ keyRing: serviceKeyRing, logger: authLogger }),
    resourcePolicy
});
const pricingRoutes = createPricingRouter({
    authenticate: createRequireAdminAudience('pricing', serviceKeyRing, { logger: authLogger })
});
const profileCatalogueService = createProfileCatalogueService({
    onStatusChange(result) {
        emitEvent('profile_catalogue.changed', {
            outcome: result.ready ? 'ready' : 'unavailable',
            error_code: result.ready ? undefined : 'PROFILE_CATALOGUE_UNAVAILABLE'
        });
    }
});
const profileCatalogueRoutes = createProfileCatalogueRouter({ service: profileCatalogueService });
const systemRoutes = createSystemRouter({
    authenticateArtifact: createRequireAdminAudience('artifact', serviceKeyRing, { logger: authLogger }),
    authenticateOperations: createRequireAdminAudience('operations', serviceKeyRing, { logger: authLogger }),
    readinessService
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

const resolveCorsOptions = createCorsOptionsResolver({
    adminAllowedOrigins: parseAllowedOrigins(process.env.ADMIN_CORS_ALLOWED_ORIGINS),
    legacyAdminAudience: serviceKeyRing.legacyMigration.enabled
        ? serviceKeyRing.legacyMigration.audience
        : null,
    sliceAllowedOrigins: parseAllowedOrigins(process.env.SLICE_CORS_ALLOWED_ORIGINS),
    pricingAllowedOrigins: parseAllowedOrigins(process.env.PRICING_CORS_ALLOWED_ORIGINS),
    artifactAllowedOrigins: parseAllowedOrigins(process.env.ARTIFACT_CORS_ALLOWED_ORIGINS),
    operationsAllowedOrigins: parseAllowedOrigins(process.env.OPERATIONS_CORS_ALLOWED_ORIGINS)
});

let trustProxySetting;
try {
    trustProxySetting = resolveTrustProxySetting(process.env);
} catch {
    console.error('[SECURITY] Trust proxy configuration is invalid. Refusing to start server.');
    process.exit(1);
}
app.set('trust proxy', trustProxySetting);

app.use(createRequestIdMiddleware());
app.use(createRequestObservabilityMiddleware());

app.use((req, res, next) => {
    const isDocsRoute = req.path === '/openapi.json' || req.path.startsWith('/docs');
    if (isDocsRoute) {
        return docsHelmet(req, res, next);
    }

    return standardHelmet(req, res, next);
});

app.use(cors(resolveCorsOptions));

app.use(express.json({ limit: resourcePolicy.JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: resourcePolicy.FORM_BODY_LIMIT }));

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
app.use(profileCatalogueRoutes);
app.use(sliceRoutes);
app.use(renderRoutes);
app.use(systemRoutes);

// Catch-all for unknown routes
app.all('*', (req, res) => {
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
    const engineVersions = await initializeSlicerEngineVersions();
    // The Bambu registry and every vendor chain it references must flatten
    // before listen; a typed failure here refuses startup rather than letting
    // /bambu/slice answer 500 on its first request. The catalogue below stays
    // non-critical and merely re-exercises the same chains.
    verifyBambuRegistryChains({ registry: getBambuPrinterRegistry() });
    configureRetentionObserver(readinessService);
    await profileCatalogueService.initialize({ engineVersions });
    const scratchCleanup = await auditStaleWorkspaces({
        jobsRoot: JOB_SCRATCH_DIR,
        delete: true,
        deleteMarkedRegardlessAge: true,
        boundedLifetimeMs: resourcePolicy.UPLOAD_TOTAL_TIMEOUT_MS,
        verifyExclusiveLease: async () => true,
        resourcePolicy
    });
    emitEvent('artifact.cleanup', {
        outcome: scratchCleanup.failed ? 'failure' : 'success',
        extra: { count: scratchCleanup.removed || 0 }
    });
    const artifactCleanup = await cleanupManagedArtifacts({
        resourcePolicy
    });
    readinessService.recordRetentionResult(artifactCleanup);
    recordArtifactCleanup(
        artifactCleanup.failed === 0 ? 'success' : 'failure',
        artifactCleanup.removedArtifacts,
        artifactCleanup.removedBytes
    );
    setArtifactStatus(artifactCleanup.retainedCount, artifactCleanup.retainedBytes);
    const startupReadiness = readinessService.getStatus();
    emitEvent('readiness.changed', {
        outcome: startupReadiness.ready ? 'ready' : 'unavailable',
        error_code: startupReadiness.reasonCodes[0]
    });
    emitEvent('artifact.cleanup', {
        outcome: artifactCleanup.failed ? 'failure' : 'success',
        extra: {
            count: artifactCleanup.removedArtifacts || 0,
            bytes: artifactCleanup.removedBytes || 0
        }
    });
    return auditWorkspacesThenListen({
        auditOptions: {
            staleAgeMs: process.env.JOB_WORKSPACE_STALE_AGE_MS
        },
        onAudit(audit) {
            emitEvent('artifact.cleanup', {
                outcome: audit?.failed ? 'failure' : 'success',
                extra: { count: audit?.removed || 0 }
            });
        },
        listen() {
            if (runtimeLifecycle.isShuttingDown()) return null;
            httpServer.listen(PORT, () => {
                emitEvent('startup.completed', { outcome: 'success' });
            });
            return httpServer;
        }
    });
}

const TYPED_STARTUP_FAILURE_CODES = new Set([
    'STARTUP_SLICER_VERSION_FAILED',
    'STARTUP_BAMBU_REGISTRY_INVALID',
    'STARTUP_BAMBU_PROFILE_CHAIN_FAILED'
]);

runtimeLifecycle.run(startServer).catch((error) => {
    emitEvent('startup.completed', {
        outcome: 'failure',
        error_code: TYPED_STARTUP_FAILURE_CODES.has(error?.code)
            ? error.code
            : 'STARTUP_AUDIT_FAILED'
    });
    process.exitCode = 1;
});
