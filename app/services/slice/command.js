/** Child process execution with bounded tree cancellation and minimal environment. */

const { execFile } = require('node:child_process');
const { DEFAULTS } = require('../../config/constants');
const { createChildEnvironment } = require('./child-environment');
const { createProcessTreeTerminator } = require('./process-tree');

const DEBUG_COMMAND_LOGS = process.env.DEBUG_COMMAND_LOGS === 'true';
const MAX_LOG_OUTPUT = DEFAULTS.MAX_LOG_OUTPUT;
const COMMAND_TIMEOUT_MS = Number.parseInt(
    process.env.SLICE_COMMAND_TIMEOUT_MS || `${DEFAULTS.SLICE_COMMAND_TIMEOUT_MS}`,
    10
) || DEFAULTS.SLICE_COMMAND_TIMEOUT_MS;

function truncateLogOutput(text) {
    if (!text || text.length <= MAX_LOG_OUTPUT) return text;
    return `${text.slice(0, MAX_LOG_OUTPUT)}\n...[truncated]`;
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

function createTimeoutError(timeoutMs) {
    const error = new Error(`The slicing process timed out after ${Math.round(timeoutMs / 60000)} minutes.`);
    error.name = 'TimeoutError';
    error.code = 'ETIMEDOUT';
    error.killed = true;
    return error;
}

function logCommandOutput(stdout, stderr, debug) {
    if (debug && stdout) console.log(`[CMD LOG]:\n${truncateLogOutput(stdout)}`);
    if (debug && stderr) console.error(`[CMD ERR]:\n${truncateLogOutput(stderr)}`);
}

class CommandExecution {
    constructor(dependencies, executable, args, signal) {
        this.dependencies = dependencies;
        this.executable = executable;
        this.args = args;
        this.signal = signal;
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
        this.child = execute(this.executable, this.args, {
            detached: platform !== 'win32',
            env: environmentFactory(process.env, platform),
            maxBuffer: 1024 * 10000,
            shell: false,
            windowsHide: true
        }, (error, stdout = '', stderr = '') => {
            logCommandOutput(stdout, stderr, this.dependencies.debug);
            this.commandOutcome = { error, stdout, stderr };
            this.maybeSettle();
        });
    }

    armTimeout() {
        const { setTimer, timeoutMs } = this.dependencies;
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
        Promise.resolve()
            .then(() => this.dependencies.terminatorFactory(this.child).terminate())
            .then(() => {
                this.terminationComplete = true;
                this.maybeSettle();
            }, () => {
                // An unverified tree is deliberately non-terminal: retaining the
                // command promise also retains the queue slot instead of allowing
                // another native job to start beside a possible orphan.
                console.error('[EXEC ERROR] Slice subprocess tree termination failed.');
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
        if (error.killed) {
            error.message = `The slicing process timed out after ${Math.round(this.dependencies.timeoutMs / 60000)} minutes.`;
        }
        console.error('[EXEC ERROR] Contained slice subprocess failed.');
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
 * @param {object} [overrides] Test dependencies.
 * @returns {(executable: string, args?: string[], options?: {signal?: AbortSignal}) => Promise<{stdout: string, stderr: string}>}
 */
function createCommandRunner(overrides = {}) {
    const dependencies = {
        execute: overrides.execFile || execFile,
        setTimer: overrides.setTimeout || setTimeout,
        clearTimer: overrides.clearTimeout || clearTimeout,
        platform: overrides.platform || process.platform,
        timeoutMs: overrides.timeoutMs || COMMAND_TIMEOUT_MS,
        debug: overrides.debug ?? DEBUG_COMMAND_LOGS,
        environmentFactory: overrides.createChildEnvironment || createChildEnvironment,
        terminatorFactory: overrides.createProcessTreeTerminator
            || ((child) => createProcessTreeTerminator(child, overrides.terminationDependencies))
    };
    return function run(executable, args = [], options = {}) {
        if (options.signal?.aborted) return Promise.reject(abortReason(options.signal));
        return new CommandExecution(dependencies, executable, args, options.signal).run();
    };
}

const runCommand = createCommandRunner();

module.exports = {
    runCommand,
    createCommandRunner,
    abortReason,
    throwIfAborted,
    isAbortError
};
