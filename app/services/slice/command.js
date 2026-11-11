/** Child process execution with bounded tree cancellation and minimal environment. */

// Not child_process.execFile: it drops `detached`, so a native never led its
// own process group and the tree terminator killed nothing (3.8.1).
const fs = require('node:fs');
const path = require('node:path');
const { spawnFile } = require('./spawn-file');
const { DEFAULTS } = require('../../config/constants');
const { children: CHILDREN_POLICY } = require('../../config/release-policy');
const { parseBoundedPositiveInt } = require('./number-utils');
const { createChildEnvironment } = require('./child-environment');
const { createProcessTreeTerminator } = require('./process-tree');
const { resolvePythonHelper } = require('./helper-paths');
const { quarantineNativeRuntime } = require('./native-runtime-status');
const { nativeFinished, nativeStarted, recordNativeQuarantine } = require('../observability/metrics');
const { emitEvent } = require('../observability/events');

/** Inclusive accepted range for the native slice command budget (1 s .. 60 min). */
const SLICE_COMMAND_TIMEOUT_RANGE_MS = Object.freeze({ min: 1_000, max: 3_600_000 });

/** Lower bound of the Python helper budget; below this real CAD imports fail. */
const PYTHON_HELPER_TIMEOUT_MIN_MS = 10_000;

/** Maximum bytes accepted from a child's stdout/stderr before Node kills it. */
const DEFAULT_MAX_BUFFER_BYTES = 1024 * 10000;

/**
 * Resolve the native command timeout from the environment.
 * Negative, zero, fractional, non-canonical, or out-of-range values fall back
 * to the safe default instead of arming an immediately-firing timer.
 * @param {NodeJS.ProcessEnv | Record<string, unknown>} [env=process.env] Environment source.
 * @returns {number} Timeout in milliseconds.
 */
function resolveCommandTimeoutMs(env = process.env) {
    return parseBoundedPositiveInt(
        env.SLICE_COMMAND_TIMEOUT_MS,
        DEFAULTS.SLICE_COMMAND_TIMEOUT_MS,
        SLICE_COMMAND_TIMEOUT_RANGE_MS
    );
}

/**
 * Resolve the bounded budget for the Python preprocessing helpers (mesh2stl,
 * cad2stl, orient, scale_model) from `PYTHON_HELPER_TIMEOUT_MS`. These run
 * before any native slicer and never need the full native slice budget, so
 * the accepted range is `10 s .. SLICE_COMMAND_TIMEOUT_MS`. The default is
 * `DEFAULTS.PYTHON_HELPER_TIMEOUT_MS` capped at the native budget; invalid,
 * non-canonical, or out-of-range values fall back to that default. A run of
 * `orient.py` is further capped at `ORIENTATION_HELPER_TIMEOUT_MS`.
 * @param {NodeJS.ProcessEnv | Record<string, unknown>} [env=process.env] Environment source.
 * @returns {number} Helper timeout in milliseconds.
 */
function resolvePythonHelperTimeoutMs(env = process.env) {
    const commandTimeoutMs = resolveCommandTimeoutMs(env);
    const fallback = Math.min(DEFAULTS.PYTHON_HELPER_TIMEOUT_MS, commandTimeoutMs);
    return parseBoundedPositiveInt(
        env.PYTHON_HELPER_TIMEOUT_MS,
        fallback,
        { min: PYTHON_HELPER_TIMEOUT_MIN_MS, max: commandTimeoutMs }
    );
}

/**
 * Resolve the orientation helper's own budget from
 * `ORIENTATION_HELPER_TIMEOUT_MS`. `orient.py` ran under the shared helper
 * budget; its stable-pose heuristic most likely loops without end on a mesh
 * whose centre of mass is not strictly inside its convex hull, and live each
 * of the eight runs that did not finish held a slice slot for the whole 300 s
 * helper budget, while every heuristic run that finished took at most 27 s
 * (VPS, 2026-10-19..26). The
 * accepted range is `10 s .. PYTHON_HELPER_TIMEOUT_MS`. The default is
 * `DEFAULTS.ORIENTATION_HELPER_TIMEOUT_MS` capped at the helper budget;
 * invalid, non-canonical, or out-of-range values (a value above the helper
 * budget included) fall back to that default. Setting it equal to
 * `PYTHON_HELPER_TIMEOUT_MS` restores the 3.8.2 behaviour.
 * @param {NodeJS.ProcessEnv | Record<string, unknown>} [env=process.env] Environment source.
 * @returns {number} Orientation helper timeout in milliseconds.
 */
function resolveOrientationHelperTimeoutMs(env = process.env) {
    const helperTimeoutMs = resolvePythonHelperTimeoutMs(env);
    const fallback = Math.min(DEFAULTS.ORIENTATION_HELPER_TIMEOUT_MS, helperTimeoutMs);
    return parseBoundedPositiveInt(
        env.ORIENTATION_HELPER_TIMEOUT_MS,
        fallback,
        { min: PYTHON_HELPER_TIMEOUT_MIN_MS, max: helperTimeoutMs }
    );
}

const COMMAND_TIMEOUT_MS = resolveCommandTimeoutMs(process.env);
/** Process-wide Python helper budget resolved once at load, like the native budget. */
const PYTHON_HELPER_TIMEOUT_MS = resolvePythonHelperTimeoutMs(process.env);
/** Process-wide orientation helper budget resolved once at load (never above the helper budget). */
const ORIENTATION_HELPER_TIMEOUT_MS = resolveOrientationHelperTimeoutMs(process.env);

/**
 * Absolute path of `orient.py` exactly as the input pipeline passes it as the
 * first argument (`resolvePythonHelper('orient.py')`). The orientation budget
 * applies only to a command whose first argument is this path; every other
 * helper, the Bambu reference-pose export and every native slice keep their
 * own budgets.
 */
const ORIENTATION_HELPER_PATH = resolvePythonHelper('orient.py');

/**
 * Whether a command runs the orientation helper.
 * @param {unknown} args Command arguments.
 * @returns {boolean} True when the first argument is the orientation helper's path.
 */
function isOrientationHelperCommand(args) {
    return Array.isArray(args) && args[0] === ORIENTATION_HELPER_PATH;
}

/**
 * OOM score adjustment every slice child runs at (3.9.0, `CHILD_OOM_SCORE_ADJ`,
 * default 500, 0 = no wrapper). Node itself stays at the container's score, so
 * a cgroup OOM kills the largest child, never the process that holds every job.
 */
const CHILD_OOM_SCORE_ADJ = CHILDREN_POLICY.CHILD_OOM_SCORE_ADJ;

/** Budget of the startup self-test of the `choom` wrapper. */
const OOM_SELF_TEST_TIMEOUT_MS = 5_000;

/** Closed reasons the wrapper is off for (`runtime.limits_unavailable`, readiness). */
const OOM_WRAPPER_REASONS = Object.freeze([
    'disabled',
    'unsupported_platform',
    'choom_missing',
    'self_test_failed',
    'self_test_mismatch',
    'self_test_timeout'
]);

/** Reasons that are not failures: no event is emitted for them. */
const QUIET_OOM_WRAPPER_REASONS = Object.freeze(['disabled', 'unsupported_platform']);

/** Directories searched for `choom` when the child PATH is empty. */
const FALLBACK_EXECUTABLE_PATH = '/usr/local/bin:/usr/bin:/bin';

/**
 * Absolute path of an executable regular file named `name` on a POSIX PATH.
 * @param {string} name Executable name.
 * @param {string|undefined} pathValue Colon-separated PATH.
 * @returns {string|null} Absolute path, or null when none is found.
 */
function findExecutableOnPath(name, pathValue) {
    for (const directory of String(pathValue || FALLBACK_EXECUTABLE_PATH).split(':')) {
        if (!directory || !path.posix.isAbsolute(directory)) continue;
        const candidate = path.posix.join(directory, name);
        try {
            if (!fs.statSync(candidate).isFile()) continue;
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        } catch {
            // Not here; keep looking.
        }
    }
    return null;
}

/**
 * Build the `choom` OOM-score wrapper. Its verdict is decided once: the
 * configured score must be non-zero, the platform Linux, `choom` present on the
 * child PATH, and the self-test `choom -n <adj> -- /bin/sh -c 'cat
 * /proc/self/oom_score_adj'` must print exactly the configured score (an
 * unprivileged process may raise its score but not lower it below the value
 * its container started with, so the test uses the value that will be used).
 * Anything else leaves the wrapper off for the life of the process, with one
 * `runtime.limits_unavailable` event for a genuine failure. `choom` replaces
 * itself with the program (`execvp`), so PID, process group, exit status and
 * signal are the program's and descendants inherit the score.
 * @param {object} [options] Test seams.
 * @param {number} [options.scoreAdj] Score to apply (default `CHILD_OOM_SCORE_ADJ`).
 * @param {NodeJS.Platform} [options.platform] Platform (default `process.platform`).
 * @param {() => string|null} [options.locate] Finds `choom`'s absolute path.
 * @param {typeof spawnFile} [options.execute] Spawns the self-test.
 * @param {(name: string, data: object) => unknown} [options.emitEvent] Event sink.
 * @param {number} [options.selfTestTimeoutMs] Self-test budget.
 * @returns {{resolve: () => (object|Promise<object>), status: () => object, wrap: (state: object|null, executable: string, args: string[]) => {file: string, args: string[], wrapped: ({file: string, args: string[]}|null)}}}
 */
function createOomWrapper(options = {}) {
    const scoreAdj = options.scoreAdj ?? CHILD_OOM_SCORE_ADJ;
    const platform = options.platform || process.platform;
    const environmentFactory = options.createChildEnvironment || createChildEnvironment;
    const locate = options.locate
        || (() => findExecutableOnPath('choom', environmentFactory(process.env, platform).PATH));
    const execute = options.execute || spawnFile;
    const emit = options.emitEvent || emitEvent;
    const selfTestTimeoutMs = options.selfTestTimeoutMs || OOM_SELF_TEST_TIMEOUT_MS;
    let state = null;
    let pending = null;

    function decide(next) {
        state = Object.freeze(next);
        pending = null;
        if (!state.active && !QUIET_OOM_WRAPPER_REASONS.includes(state.reason)) {
            emit('runtime.limits_unavailable', {
                outcome: 'wrapper_off',
                extra: { reason: state.reason, limit: scoreAdj }
            });
        }
        return state;
    }

    function off(reason) {
        return decide({ active: false, scoreAdj, choomPath: null, reason });
    }

    function selfTest(choomPath) {
        return new Promise((resolveTest) => {
            let finished = false;
            let timer;
            const finish = (verdict) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                resolveTest(verdict);
            };
            let child;
            try {
                child = execute(choomPath,
                    ['-n', String(scoreAdj), '--', '/bin/sh', '-c', 'cat /proc/self/oom_score_adj'],
                    {
                        env: environmentFactory(process.env, platform),
                        maxBuffer: 4_096,
                        shell: false,
                        windowsHide: true
                    },
                    (error, stdout = '') => {
                        if (error) return finish(off('self_test_failed'));
                        if (String(stdout).trim() !== String(scoreAdj)) return finish(off('self_test_mismatch'));
                        return finish(decide({ active: true, scoreAdj, choomPath, reason: null }));
                    });
            } catch {
                finish(off('self_test_failed'));
                return;
            }
            timer = setTimeout(() => {
                try { child?.kill?.('SIGKILL'); } catch { /* already gone */ }
                finish(off('self_test_timeout'));
            }, selfTestTimeoutMs);
            // Kept referenced: it is the only bound on a promise the startup
            // (and the first command) awaits. Unreferenced, a self-test whose
            // child holds no handle of its own lets the event loop drain with
            // the verdict never decided. It is cleared the moment one is.
        });
    }

    /**
     * The verdict: synchronous once decided (or decidable without a child),
     * otherwise one shared promise of the self-test. Never rejects.
     */
    function resolve() {
        if (state) return state;
        if (pending) return pending;
        if (scoreAdj === 0) return off('disabled');
        if (platform !== 'linux') return off('unsupported_platform');
        let choomPath = null;
        try {
            choomPath = locate();
        } catch {
            choomPath = null;
        }
        if (!choomPath) return off('choom_missing');
        pending = selfTest(choomPath);
        return pending;
    }

    function status() {
        if (!state) {
            return { state: 'pending', active: false, oom_score_adj: scoreAdj, reason: null };
        }
        return {
            state: state.active ? 'active' : (state.reason === 'disabled' ? 'disabled' : 'off'),
            active: state.active,
            oom_score_adj: scoreAdj,
            reason: state.reason
        };
    }

    return { resolve, status, wrap: wrapCommand };
}

/**
 * The argv a command runs under: `choom -n <adj> -- <file> <args…>` when the
 * wrapper is active, the command itself otherwise.
 * @param {{active?: boolean, choomPath?: string, scoreAdj?: number}|null} wrapperState Wrapper verdict.
 * @param {string} executable Program.
 * @param {string[]} args Program arguments.
 * @returns {{file: string, args: string[], wrapped: ({file: string, args: string[]}|null)}} Spawn argv.
 */
function wrapCommand(wrapperState, executable, args) {
    if (!wrapperState?.active) return { file: executable, args, wrapped: null };
    return {
        file: wrapperState.choomPath,
        args: ['-n', String(wrapperState.scoreAdj), '--', executable, ...args],
        wrapped: { file: executable, args }
    };
}

/** The process-wide wrapper every real slice child runs under. */
const defaultOomWrapper = createOomWrapper();

/**
 * Run the wrapper's startup self-test now (idempotent) and return its verdict.
 * The first command would run it otherwise; server startup calls this so the
 * verdict and any `runtime.limits_unavailable` event come before traffic.
 * @returns {Promise<object>} Frozen verdict `{active, scoreAdj, choomPath, reason}`.
 */
function verifyChildOomWrapper() {
    return Promise.resolve(defaultOomWrapper.resolve());
}

/**
 * Readiness view of the process-wide wrapper.
 * @returns {{state: 'pending'|'active'|'disabled'|'off', active: boolean, oom_score_adj: number, reason: string|null}}
 */
function getChildOomWrapperStatus() {
    return defaultOomWrapper.status();
}

function abortReason(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    const error = new Error('Slice processing was aborted.');
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw abortReason(signal);
}

function isAbortError(error, signal) {
    return Boolean(
        signal?.aborted
        || error?.name === 'AbortError'
        || error?.code === 'ABORT_ERR'
        || error?.code === 'REQUEST_ABORTED'
    );
}

function timeoutMessage(timeoutMs) {
    return `The slicing process timed out after ${Math.round(timeoutMs / 60000)} minutes.`;
}

function createTimeoutError(timeoutMs) {
    const error = new Error(timeoutMessage(timeoutMs));
    error.name = 'TimeoutError';
    error.code = 'ETIMEDOUT';
    error.killed = true;
    return error;
}

/**
 * Resolve the effective timeout for one execution. A per-call override may
 * only shorten the runner budget, never extend it.
 * @param {number} runnerTimeoutMs Runner-level timeout.
 * @param {unknown} requested Optional per-call override.
 * @returns {number} Effective timeout in milliseconds.
 */
function effectiveTimeoutMs(runnerTimeoutMs, requested) {
    if (!Number.isSafeInteger(requested) || requested <= 0) return runnerTimeoutMs;
    return Math.min(requested, runnerTimeoutMs);
}

function elapsedMilliseconds(started) {
    return Number(process.hrtime.bigint() - started) / 1e6;
}

/** Characters of a failed native's stderr kept in its structured failure event. */
const STDERR_TAIL_CHARS = 400;

/**
 * Last `STDERR_TAIL_CHARS` characters of a native's stderr, reduced to
 * printable ASCII with whitespace collapsed, so one log line carries it.
 * @param {unknown} stderr Raw stderr text.
 * @returns {string} Bounded printable tail ('' when there was none).
 */
function printableStderrTail(stderr) {
    const text = typeof stderr === 'string' ? stderr : '';
    return text.slice(-STDERR_TAIL_CHARS).replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Exit facts of a failed native command: how it ended and whether this
 * runner (rather than the system, e.g. the cgroup OOM killer) killed it.
 * @param {{code?: unknown, signal?: unknown, killed?: unknown}} error Command error.
 * @returns {{exit_code: number|string|null, signal: string|null, killed_by_runner: boolean}} Exit facts.
 */
function nativeExitFacts(error) {
    const code = error?.code;
    return {
        exit_code: (typeof code === 'number' && Number.isFinite(code)) || typeof code === 'string' ? code : null,
        signal: typeof error?.signal === 'string' ? error.signal : null,
        killed_by_runner: Boolean(error?.killed)
    };
}

function nativeErrorCode(outcome, error) {
    if (outcome === 'timeout') return 'NATIVE_TIMEOUT';
    if (outcome === 'aborted') return 'NATIVE_ABORTED';
    if (error?.code === 'NATIVE_OUTPUT_OVERFLOW') return 'NATIVE_OUTPUT_OVERFLOW';
    return 'NATIVE_PROCESSING_FAILED';
}

class CommandExecution {
    constructor(dependencies, executable, args, signal, timeoutMs, wrapperState = null) {
        this.dependencies = dependencies;
        this.executable = executable;
        this.args = args;
        this.signal = signal;
        this.timeoutMs = timeoutMs;
        this.wrapperState = wrapperState;
        this.onAbort = this.onAbort.bind(this);
    }

    run() {
        return new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
            this.signal?.addEventListener('abort', this.onAbort, { once: true });
            if (this.signal?.aborted) return this.settle(reject, abortReason(this.signal));
            try {
                this.spawn();
            } catch (error) {
                return this.settle(reject, error);
            }
            if (!this.settled) this.armTimeout();
            if (this.signal?.aborted) this.onAbort();
        });
    }

    spawn() {
        const { execute, platform, environmentFactory } = this.dependencies;
        // The budget was chosen from the original argv; only the spawn is wrapped.
        const command = wrapCommand(this.wrapperState, this.executable, this.args);
        const spawnOptions = {
            detached: platform !== 'win32',
            env: environmentFactory(process.env, platform),
            maxBuffer: this.dependencies.maxBuffer,
            shell: false,
            windowsHide: true
        };
        if (command.wrapped) spawnOptions.wrapped = command.wrapped;
        this.child = execute(command.file, command.args, spawnOptions, (error, stdout = '', stderr = '') => {
            this.commandOutcome = { error, stdout, stderr };
            this.maybeSettle();
        });
    }

    armTimeout() {
        const { setTimer } = this.dependencies;
        const timeoutMs = this.timeoutMs;
        this.timeoutTimer = setTimer(() => this.beginTermination(createTimeoutError(timeoutMs)), timeoutMs);
        this.timeoutTimer?.unref?.();
    }

    clearTimeout() {
        if (this.timeoutTimer !== undefined) this.dependencies.clearTimer(this.timeoutTimer);
        this.timeoutTimer = undefined;
    }

    onAbort() {
        this.beginTermination(abortReason(this.signal));
    }

    beginTermination(reason) {
        if (this.settled) return;
        this.terminationReason = this.signal?.aborted ? abortReason(this.signal) : (this.terminationReason || reason);
        this.clearTimeout();
        this.signal?.removeEventListener('abort', this.onAbort);
        if (this.terminationStarted) return;
        this.terminationStarted = true;
        const terminationStarted = process.hrtime.bigint();
        Promise.resolve()
            .then(() => this.dependencies.terminatorFactory(this.child).terminate())
            .then(() => {
                this.terminationComplete = true;
                if (this.dependencies.telemetry === 'slice') {
                    emitEvent('native.termination_settled', {
                        audience: 'slice',
                        outcome: 'success',
                        duration_ms: elapsedMilliseconds(terminationStarted)
                    });
                }
                this.maybeSettle();
            }, () => {
                // An unverified tree is deliberately non-terminal: retaining the
                // command promise also retains the queue slot instead of allowing
                // another native job to start beside a possible orphan.
                quarantineNativeRuntime();
                if (this.dependencies.telemetry === 'slice') {
                    recordNativeQuarantine();
                    emitEvent('native.quarantined', {
                        audience: 'slice',
                        outcome: 'quarantined',
                        error_code: 'NATIVE_TERMINATION_UNVERIFIED'
                    });
                }
            });
    }

    maybeSettle() {
        if (!this.commandOutcome) return;
        if (this.terminationReason) {
            if (this.terminationComplete) this.settle(this.reject, this.effectiveTerminationReason());
            return;
        }
        const { error, stdout, stderr } = this.commandOutcome;
        if (error) return this.rejectCommandError(error, stdout, stderr);
        this.settle(this.resolve, { stdout, stderr });
    }

    effectiveTerminationReason() {
        return this.signal?.aborted ? abortReason(this.signal) : this.terminationReason;
    }

    rejectCommandError(error, stdout, stderr) {
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            // Node killed the child because it exceeded the bounded output
            // buffer. That is neither a timeout nor an abort, so it keeps its
            // own stable code instead of the misleading timeout wording.
            error.code = 'NATIVE_OUTPUT_OVERFLOW';
            error.message = 'The slicing process produced more output than the bounded buffer allows.';
        } else if (error.killed && this.terminationReason?.code === 'ETIMEDOUT') {
            error.message = timeoutMessage(this.timeoutMs);
        }
        // Preserve both bounded execFile streams independently. Existing
        // classifiers retain the historical stderr fallback, while consumers
        // that own stdout-only native diagnostics no longer lose them when an
        // unrelated warning is also emitted on stderr.
        error.stdout = stdout || '';
        error.stderr = stderr || stdout || error.message;
        this.settle(this.reject, error);
    }

    settle(callback, value) {
        if (this.settled) return;
        this.settled = true;
        this.clearTimeout();
        this.signal?.removeEventListener('abort', this.onAbort);
        callback(value);
    }
}

/**
 * Build a command runner with injectable spawn, timer, platform, and termination seams.
 * A run of the orientation helper is additionally capped at the orientation
 * budget (`overrides.orientationTimeoutMs`, default `ORIENTATION_HELPER_TIMEOUT_MS`).
 * @param {object} [overrides] Test dependencies.
 * @returns {(executable: string, args?: string[], options?: {signal?: AbortSignal}) => Promise<{stdout: string, stderr: string}>}
 */
function createCommandRunner(overrides = {}) {
    const telemetry = overrides.telemetry ?? 'slice';
    if (telemetry !== 'slice' && telemetry !== 'none') {
        throw new Error('Unsupported native command telemetry mode.');
    }
    const dependencies = {
        telemetry,
        execute: overrides.execFile || spawnFile,
        setTimer: overrides.setTimeout || setTimeout,
        clearTimer: overrides.clearTimeout || clearTimeout,
        platform: overrides.platform || process.platform,
        timeoutMs: overrides.timeoutMs || COMMAND_TIMEOUT_MS,
        orientationTimeoutMs: overrides.orientationTimeoutMs || ORIENTATION_HELPER_TIMEOUT_MS,
        maxBuffer: overrides.maxBuffer || DEFAULT_MAX_BUFFER_BYTES,
        environmentFactory: overrides.createChildEnvironment || createChildEnvironment,
        terminatorFactory: overrides.createProcessTreeTerminator
            || ((child) => createProcessTreeTerminator(child, overrides.terminationDependencies)),
        // Real slice children run under the process-wide `choom` wrapper; an
        // injected spawn seam or the startup probe does not unless a test
        // passes `oomWrapper` (null = never wrap).
        oomWrapper: overrides.oomWrapper !== undefined
            ? overrides.oomWrapper
            : (overrides.execFile || telemetry === 'none' ? null : defaultOomWrapper)
    };
    return function run(executable, args = [], options = {}) {
        if (options.signal?.aborted) return Promise.reject(abortReason(options.signal));
        const started = telemetry === 'slice' ? process.hrtime.bigint() : null;
        if (telemetry === 'slice') {
            nativeStarted();
            emitEvent('native.started', { audience: 'slice', outcome: 'started' });
        }
        const runnerTimeoutMs = isOrientationHelperCommand(args)
            ? Math.min(dependencies.timeoutMs, dependencies.orientationTimeoutMs)
            : dependencies.timeoutMs;
        const timeoutMs = effectiveTimeoutMs(runnerTimeoutMs, options.timeoutMs);
        const execute = (wrapperState) => new CommandExecution(
            dependencies, executable, args, options.signal, timeoutMs, wrapperState
        ).run();
        // Synchronous once the wrapper's verdict is known; only the very first
        // command of a process may wait for the self-test.
        const verdict = dependencies.oomWrapper ? dependencies.oomWrapper.resolve() : null;
        const execution = verdict && typeof verdict.then === 'function'
            ? verdict.then(execute)
            : execute(verdict);
        return execution.then(
            (value) => {
                if (telemetry === 'none') return value;
                const duration = elapsedMilliseconds(started);
                nativeFinished('success', duration);
                emitEvent('native.completed', {
                    audience: 'slice', outcome: 'success', duration_ms: duration
                });
                return value;
            },
            (error) => {
                if (telemetry === 'none') throw error;
                const outcome = error?.code === 'ETIMEDOUT'
                    ? 'timeout'
                    : isAbortError(error, options.signal) ? 'aborted' : 'failure';
                const duration = elapsedMilliseconds(started);
                nativeFinished(outcome, duration);
                emitEvent('native.completed', {
                    audience: 'slice',
                    outcome,
                    error_code: nativeErrorCode(outcome, error),
                    duration_ms: duration,
                    ...(outcome === 'failure'
                        ? { extra: { ...nativeExitFacts(error), stderr_tail: printableStderrTail(error?.stderr) } }
                        : {})
                });
                throw error;
            }
        );
    };
}

/** Build a bounded startup preflight runner that cannot alter slice telemetry. */
function createStartupProbeRunner(overrides = {}) {
    return createCommandRunner({ ...overrides, telemetry: 'none' });
}

/**
 * Build a runner whose budget is the shorter Python helper timeout.
 * @param {object} [overrides] Test dependencies; `timeoutMs` is fixed to the resolved helper budget.
 * @returns {ReturnType<typeof createCommandRunner>} Helper command runner.
 */
function createPythonHelperRunner(overrides = {}) {
    return createCommandRunner({ ...overrides, timeoutMs: PYTHON_HELPER_TIMEOUT_MS });
}

const runCommand = createCommandRunner();

module.exports = {
    CHILD_OOM_SCORE_ADJ,
    OOM_SELF_TEST_TIMEOUT_MS,
    OOM_WRAPPER_REASONS,
    createOomWrapper,
    findExecutableOnPath,
    getChildOomWrapperStatus,
    verifyChildOomWrapper,
    wrapCommand,
    STDERR_TAIL_CHARS,
    nativeExitFacts,
    printableStderrTail,
    ORIENTATION_HELPER_PATH,
    ORIENTATION_HELPER_TIMEOUT_MS,
    PYTHON_HELPER_TIMEOUT_MIN_MS,
    PYTHON_HELPER_TIMEOUT_MS,
    SLICE_COMMAND_TIMEOUT_RANGE_MS,
    runCommand,
    createCommandRunner,
    createPythonHelperRunner,
    createStartupProbeRunner,
    isOrientationHelperCommand,
    resolveCommandTimeoutMs,
    resolveOrientationHelperTimeoutMs,
    resolvePythonHelperTimeoutMs,
    abortReason,
    throwIfAborted,
    isAbortError
};
