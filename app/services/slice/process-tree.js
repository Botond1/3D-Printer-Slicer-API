/** Idempotent, exact-PID process-tree termination for native slice commands. */

const { execFile } = require('node:child_process');
const path = require('node:path');
const { createChildEnvironment } = require('./child-environment');

const DEFAULT_GRACE_MS = 1000;
/**
 * Settle budget after SIGKILL. A killed group still needs the kernel to reap
 * every member, and a large native slicer with many threads can take well
 * over one second to disappear from the process table. This must stay below
 * the container stop grace (30 s) so a quarantine can still exit in time.
 */
const DEFAULT_KILL_SETTLE_MS = 10_000;
const DEFAULT_POLL_MS = 20;

function isSafeChildPid(pid, ownPid = process.pid) {
    return Number.isSafeInteger(pid) && pid > 0 && pid !== ownPid;
}

function hasChildExited(child) {
    return Boolean(
        (child?.exitCode !== undefined && child.exitCode !== null)
        || (child?.signalCode !== undefined && child.signalCode !== null)
    );
}

function delay(ms, dependencies) {
    return new Promise((resolve) => {
        // Settlement polling is safety-critical and must keep the host alive.
        dependencies.setTimeout(resolve, ms);
    });
}

function isPosixGroupAlive(pid, kill) {
    try {
        kill(-pid, 0);
        return true;
    } catch (error) {
        if (error?.code === 'ESRCH') return false;
        throw error;
    }
}

async function waitForPosixGroupExit(pid, deadline, dependencies) {
    while (isPosixGroupAlive(pid, dependencies.kill)) {
        if (dependencies.now() >= deadline) return false;
        await delay(Math.min(dependencies.pollMs, Math.max(1, deadline - dependencies.now())), dependencies);
    }
    return true;
}

function isWindowsProcessAlive(pid, kill) {
    try {
        kill(pid, 0);
        return true;
    } catch (error) {
        if (error?.code === 'ESRCH') return false;
        throw error;
    }
}

async function waitForWindowsProcessExit(pid, deadline, dependencies) {
    while (isWindowsProcessAlive(pid, dependencies.kill)) {
        if (dependencies.now() >= deadline) return false;
        await delay(Math.min(dependencies.pollMs, Math.max(1, deadline - dependencies.now())), dependencies);
    }
    return true;
}

function sendPosixSignal(pid, signal, dependencies) {
    try {
        dependencies.kill(-pid, signal);
    } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
    }
}

function runTaskkill(pid, force, dependencies) {
    const args = ['/PID', String(pid), '/T'];
    if (force) args.push('/F');
    return new Promise((resolve, reject) => {
        dependencies.execFile(dependencies.taskkillPath, args, {
            env: dependencies.childEnvironment,
            timeout: dependencies.graceMs,
            windowsHide: true,
            shell: false
        }, (error) => {
            if (!error) return resolve();
            reject(error);
        });
    });
}

async function terminatePosix(pid, dependencies) {
    sendPosixSignal(pid, 'SIGTERM', dependencies);
    const termDeadline = dependencies.now() + dependencies.graceMs;
    if (await waitForPosixGroupExit(pid, termDeadline, dependencies)) return;
    sendPosixSignal(pid, 'SIGKILL', dependencies);
    const killDeadline = dependencies.now() + dependencies.killSettleMs;
    if (await waitForPosixGroupExit(pid, killDeadline, dependencies)) return;
    // One repeated forced pass before giving up: a member forked between the
    // first SIGKILL and the poll, or a slow reap, must not quarantine the
    // whole runtime when a second signal settles the group.
    sendPosixSignal(pid, 'SIGKILL', dependencies);
    const retryDeadline = dependencies.now() + dependencies.killSettleMs;
    if (!await waitForPosixGroupExit(pid, retryDeadline, dependencies)) {
        throw new Error('Process group did not settle after forced termination.');
    }
}

async function terminateWindows(pid, dependencies) {
    let gracefulTreeRequestSucceeded = false;
    try {
        await runTaskkill(pid, false, dependencies);
        gracefulTreeRequestSucceeded = true;
    } catch {
        // A failed graceful request still receives the same bounded settlement
        // check before escalation.
    }
    const termDeadline = dependencies.now() + dependencies.graceMs;
    const rootExitedAfterGraceful = await waitForWindowsProcessExit(pid, termDeadline, dependencies);
    if (rootExitedAfterGraceful) {
        if (gracefulTreeRequestSucceeded) return;
        throw new Error('Windows process identity was lost before tree termination was verified.');
    }
    await runTaskkill(pid, true, dependencies);
    const killDeadline = dependencies.now() + dependencies.graceMs;
    if (!await waitForWindowsProcessExit(pid, killDeadline, dependencies)) {
        throw new Error('Windows process tree did not settle after forced termination.');
    }
}

function resolveTaskkillPath(environment) {
    const systemRoot = environment.SystemRoot || environment.WINDIR;
    if (!systemRoot || !path.isAbsolute(systemRoot)) {
        throw new Error('Cannot resolve the trusted Windows taskkill executable.');
    }
    return path.join(systemRoot, 'System32', 'taskkill.exe');
}

/**
 * Create one process-tree termination coordinator for a spawned child.
 * @param {import('node:child_process').ChildProcess} child Spawned child.
 * @param {object} [overrides] Injectable process, clock, timer, and command seams.
 * @returns {{terminate: () => Promise<void>}} Idempotent coordinator.
 */
function createProcessTreeTerminator(child, overrides = {}) {
    const platform = overrides.platform || process.platform;
    const childEnvironment = overrides.childEnvironment || createChildEnvironment(process.env, platform);
    const dependencies = {
        platform,
        ownPid: overrides.ownPid ?? process.pid,
        kill: overrides.kill || process.kill.bind(process),
        execFile: overrides.execFile || execFile,
        now: overrides.now || Date.now,
        setTimeout: overrides.setTimeout || setTimeout,
        pollMs: overrides.pollMs ?? DEFAULT_POLL_MS,
        graceMs: overrides.graceMs ?? DEFAULT_GRACE_MS,
        killSettleMs: overrides.killSettleMs ?? Math.max(
            DEFAULT_KILL_SETTLE_MS,
            overrides.graceMs ?? DEFAULT_GRACE_MS
        ),
        childEnvironment,
        taskkillPath: overrides.taskkillPath
            || (platform === 'win32' ? resolveTaskkillPath(childEnvironment) : null)
    };
    let terminationPromise;

    function terminate() {
        if (terminationPromise) return terminationPromise;
        const pid = child?.pid;
        if (!isSafeChildPid(pid, dependencies.ownPid)) {
            terminationPromise = Promise.reject(new Error('Refusing to terminate an unverified process tree.'));
            return terminationPromise;
        }
        if (hasChildExited(child)) {
            if (dependencies.platform === 'win32') {
                terminationPromise = Promise.reject(
                    new Error('Process-tree identity was lost before termination could be verified.')
                );
            } else if (isPosixGroupAlive(pid, dependencies.kill)) {
                // The direct child is gone but its process group still has
                // members (orphaned grandchildren). The group id stays valid
                // while any member lives, so terminate the group instead of
                // refusing and leaving a live orphan behind.
                terminationPromise = terminatePosix(pid, dependencies);
            } else {
                terminationPromise = Promise.resolve();
            }
            return terminationPromise;
        }
        terminationPromise = dependencies.platform === 'win32'
            ? terminateWindows(pid, dependencies)
            : terminatePosix(pid, dependencies);
        return terminationPromise;
    }

    return Object.freeze({ terminate });
}

module.exports = {
    DEFAULT_GRACE_MS,
    DEFAULT_KILL_SETTLE_MS,
    createProcessTreeTerminator,
    isSafeChildPid,
    hasChildExited
};
