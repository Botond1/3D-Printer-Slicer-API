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

// 3.9.0 settings (app/config/release-policy.js) resolve on first require; an
// invalid value refuses startup here, before any module that reads them.
let releasePolicy;
try {
    releasePolicy = require('./config/release-policy');
} catch {
    console.error('[SECURITY] Release policy configuration is invalid. Refusing to start server.');
    process.exit(1);
}

const { monitorEventLoopDelay } = require('node:perf_hooks');
const createSwaggerDocument = require('./docs/swagger-docs');
const { createPricingRouter } = require('./routes/pricing.routes');
const { createProfileCatalogueRouter } = require('./routes/profile-catalogue.routes');
const { createSliceRouter } = require('./routes/slice.routes');
const { createSliceJobsRouter } = require('./routes/slice-jobs.routes');
const { createRenderRouter } = require('./routes/render.routes');
const { createSystemRouter } = require('./routes/system.routes');
const { createExportRouter } = require('./routes/export.routes');
const { createCapabilitiesRouter } = require('./routes/capabilities.routes');
const errorHandler = require('./middleware/errorHandler');
const { createCorsOptionsResolver, parseAllowedOrigins } = require('./middleware/corsPolicy');
const { createRequireSliceService } = require('./middleware/requireSliceService');
const { createRequireAdminAudience } = require('./middleware/requireAdmin');
const { createAuthLogAggregator } = require('./middleware/auth-log-aggregator');
const { resolveKeyRingReadinessReasons } = require('./config/service-auth');
const { createRequestIdMiddleware } = require('./middleware/requestId');
const { createRequestObservabilityMiddleware } = require('./middleware/requestObservability');
const { PORT } = require('./config/constants');
const { ensureRequiredDirectories, JOB_SCRATCH_DIR, JOB_WORKSPACES_DIR } = require('./config/paths');
const { resolveTrustProxySetting } = require('./config/trust-proxy');
const { resolveResourcePolicy } = require('./config/resource-policy');
const { loadPricingFromDisk, getPricing } = require('./services/pricing.service');
const { createBoundedHttpServer } = require('./services/http-server');
const { auditStaleWorkspaces, auditWorkspacesThenListen } = require('./services/slice/workspace');
const { cleanupManagedArtifacts } = require('./services/artifact-store');
const { createRetentionRuntime } = require('./services/retention-adapter');
const { purgeExportResults } = require('./services/export/export-files');
const { closeDefaultArchivePreflight } = require('./services/slice/archive-preflight');
const { getChildOomWrapperStatus, verifyChildOomWrapper } = require('./services/slice/command');
const { beginSliceQueueShutdown } = require('./services/slice/queue');
const { initializeSlicerEngineVersions } = require('./services/slice/engine-version');
const { getBambuPrinterRegistry } = require('./services/slice/bambu-printer-registry');
const { verifyBambuRegistryChains } = require('./services/slice/bambu-profile-chain');
const {
    getNativeIdentityStatus,
    initializeBambuGeneration,
    startNativeIdentityMonitor
} = require('./services/slice/bambu-generation');
const { createBambuReadiness } = require('./services/slice/bambu-readiness');
const { getSlaPrinterRegistry } = require('./services/slice/sla-printer-registry');
const { configureRetentionObserver } = require('./services/slice/output-lifecycle');
const { createProfileCatalogueService } = require('./services/slice/profile-catalogue');
const { createRuntimeLifecycle } = require('./services/runtime-lifecycle');
const { createReadinessService } = require('./services/readiness.service');
const { emitEvent, setEventWriter } = require('./services/observability/events');
const {
    recordArtifactCleanup,
    setArtifactStatus,
    setEventLoopDelay
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
const bambuReadiness = createBambuReadiness();
const readinessService = createReadinessService({
    getSlicerRuntimeStatus: bambuReadiness.getStatus,
    isShuttingDown: () => runtimeLifecycle?.isShuttingDown() === true,
    legacyMigration: serviceKeyRing.legacyMigration,
    // /operations/readiness only; none of these reaches /ready (3.9.0 §4.1, §4.5, §4.6).
    getNativeIdentityStatus,
    getKeyRingReasons: () => resolveKeyRingReadinessReasons(serviceKeyRing, Date.now()),
    getChildOomWrapperStatus
});
// Retention: the post-slice miss schedules a sweep instead of latching (§4.2).
const retentionRuntime = createRetentionRuntime({
    readinessService,
    sweeper: { cleanupOptions: { resourcePolicy } }
});
// One aggregated auth log for every audience (§4.5): auth.rejected and auth.slot_summary.
const authAggregator = createAuthLogAggregator();
const authLogger = authAggregator.logger;
let identityMonitor = null;
let eventLoopMonitor = null;
runtimeLifecycle = createRuntimeLifecycle({
    beginQueueShutdown: beginSliceQueueShutdown,
    onShutdownStart() {
        readinessService.closeAdmission('shutdown');
        emitEvent('shutdown.started', { outcome: 'started' });
        stopBackgroundWork();
    }
});

/**
 * Stop the 3.9.0 background timers and the preflight worker. Each is
 * unref'd, so this is tidiness; a failing stop never blocks shutdown.
 */
function stopBackgroundWork() {
    for (const stop of [
        () => retentionRuntime.sweeper.stop(),
        () => identityMonitor?.stop?.(),
        () => eventLoopMonitor?.stop(),
        () => authAggregator.stop(),
        () => closeDefaultArchivePreflight()
    ]) {
        try {
            const pending = stop();
            if (pending && typeof pending.catch === 'function') pending.catch(() => {});
        } catch {
            // Shutdown proceeds.
        }
    }
}

const EVENT_LOOP_WINDOW_MS = 60_000;
const EVENT_LOOP_STALL_SECONDS = 1;

/**
 * `slicer_event_loop_delay_seconds{stat}` over a 60 s window, reset each
 * window; one `runtime.event_loop_stall` per window whose max passes 1 s (§4.9).
 * @returns {{stop(): void}} Monitor handle.
 */
function startEventLoopMonitor() {
    const histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
    const seconds = (nanoseconds) => (Number.isFinite(nanoseconds) && nanoseconds > 0 ? nanoseconds / 1e9 : 0);
    const timer = setInterval(() => {
        const max = seconds(histogram.max);
        setEventLoopDelay({ p50: seconds(histogram.percentile(50)), p99: seconds(histogram.percentile(99)), max });
        if (max > EVENT_LOOP_STALL_SECONDS) {
            emitEvent('runtime.event_loop_stall', {
                outcome: 'stalled',
                duration_ms: Math.round(max * 1000),
                extra: { reason: 'event_loop', count: 1 }
            });
        }
        histogram.reset();
    }, EVENT_LOOP_WINDOW_MS);
    timer.unref?.();
    return Object.freeze({
        stop() {
            clearInterval(timer);
            histogram.disable();
        }
    });
}

const sliceRoutes = createSliceRouter({
    isEngineAvailable: bambuReadiness.isEngineAvailable,
    authenticate: createRequireSliceService({ keyRing: serviceKeyRing, logger: authLogger, onAccepted: authAggregator.onAccepted }),
    resourcePolicy
});
const sliceJobRoutes = createSliceJobsRouter({
    authenticate: createRequireSliceService({ keyRing: serviceKeyRing, logger: authLogger, onAccepted: authAggregator.onAccepted })
});
const renderRoutes = createRenderRouter({
    authenticate: createRequireSliceService({ keyRing: serviceKeyRing, logger: authLogger, onAccepted: authAggregator.onAccepted }),
    resourcePolicy
});
// Empty unless EXPORT_ROUTE_ENABLED=true: every export path is then today's 404.
const exportRoutes = createExportRouter({
    enabled: releasePolicy.export.EXPORT_ROUTE_ENABLED === true,
    authenticate: createRequireSliceService({ keyRing: serviceKeyRing, logger: authLogger, onAccepted: authAggregator.onAccepted }),
    isEngineAvailable: bambuReadiness.isEngineAvailable,
    resourcePolicy
});
const capabilitiesRoutes = createCapabilitiesRouter({
    authenticate: createRequireSliceService({ keyRing: serviceKeyRing, logger: authLogger, onAccepted: authAggregator.onAccepted }),
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

// No app-level JSON or form parser (3.9.0 §4.5, H8): pricing.routes.js parses
// its bodies itself after authenticatePricing; slice options are multipart only.

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
app.use(sliceJobRoutes);
app.use(renderRoutes);
app.use(exportRoutes);
app.use(capabilitiesRoutes);
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
    const engineVersions = await initializeSlicerEngineVersions({ requiredEngines: ['bambu'] });
    // The Bambu registry and every vendor chain it references must flatten
    // before listen; a typed failure here refuses startup rather than letting
    // /bambu/slice answer 500 on its first request. The catalogue below stays
    // non-critical and merely re-exercises the same chains.
    verifyBambuRegistryChains({ registry: getBambuPrinterRegistry(), freeze: true });
    initializeBambuGeneration(engineVersions.bambu);
    // One awaited streamed verification of the native files, then a background
    // re-hash; a failure leaves the 3.8.3 synchronous check in force (§4.1).
    identityMonitor = await startNativeIdentityMonitor();
    await bambuReadiness.initialize(engineVersions);
    // The SLA printer registry has no external chain to flatten (Prusa reads
    // its own bundled SLA profiles directly), so loading it once and
    // validating it strictly is the complete startup gate.
    getSlaPrinterRegistry();
    // Child OOM score wrapper self-test before any slice (§4.6); never rejects.
    await verifyChildOomWrapper();
    configureRetentionObserver(retentionRuntime.adapter);
    await profileCatalogueService.initialize({ engineVersions, allowUnavailableEngines: true });
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
    // Startup purge (§4.3): every MARKED job workspace left by a Node death or
    // a power-off is deleted; one container owns the bind and before listen no
    // job exists. Unmarked directories are left alone. No export result
    // survives a restart either.
    const orphanPurge = await auditStaleWorkspaces({
        jobsRoot: JOB_WORKSPACES_DIR,
        delete: true,
        deleteMarkedRegardlessAge: true,
        verifyExclusiveLease: async () => true,
        resourcePolicy
    });
    await purgeExportResults();
    emitEvent('artifact.cleanup', {
        outcome: orphanPurge.failed ? 'failure' : 'success',
        extra: { count: orphanPurge.removed || 0 }
    });
    authAggregator.start();
    eventLoopMonitor = startEventLoopMonitor();
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
            httpServer.listen(PORT, process.env.HTTP_BIND_HOST, () => {
                emitEvent('startup.completed', { outcome: 'success' });
            });
            // Periodic artifact sweep (§4.2); the sweeper alone selects the sweep budget.
            retentionRuntime.sweeper.start();
            return httpServer;
        }
    });
}

const TYPED_STARTUP_FAILURE_CODES = new Set([
    'STARTUP_SLICER_VERSION_FAILED',
    'STARTUP_BAMBU_REGISTRY_INVALID',
    'STARTUP_BAMBU_PROFILE_CHAIN_FAILED',
    'STARTUP_SLA_REGISTRY_INVALID'
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
