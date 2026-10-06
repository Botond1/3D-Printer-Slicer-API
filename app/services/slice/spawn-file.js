'use strict';

/**
 * `child_process.execFile` semantics over `spawn`, honouring `detached`.
 *
 * Node's `execFile` forwards only cwd/env/gid/shell/signal/uid/windowsHide/
 * windowsVerbatimArguments to `spawn` and silently drops `detached`. A native
 * started through it therefore never led its own POSIX process group, so the
 * tree terminator's `kill(-pid, ...)` reached no group (ESRCH), reported the
 * tree as settled in about a millisecond and killed nothing (3.8.1).
 *
 * This keeps execFile's observable contract for the command runner exactly:
 * utf8-buffered stdout/stderr, the `maxBuffer` cut (ERR_CHILD_PROCESS_STDIO_MAXBUFFER,
 * SIGTERM to the direct child), the `Command failed: <cmd>\n<stderr>` error with
 * `code`/`killed`/`signal`/`cmd`, and one callback on `close` or `error`.
 */

const { spawn } = require('node:child_process');
const { getSystemErrorName } = require('node:util');

const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;

function maxBufferError(streamName) {
    const error = new RangeError(`${streamName} maxBuffer length exceeded`);
    error.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
    return error;
}

function resolveMaxBuffer(value) {
    return value === Infinity || (Number.isFinite(value) && value >= 0) ? value : DEFAULT_MAX_BUFFER_BYTES;
}

/**
 * Run a file like `execFile(file, args, options, callback)`.
 * @param {string} file Executable path.
 * @param {string[]} [args] Argument array; never interpreted by a shell.
 * @param {{detached?: boolean, env?: object, cwd?: string, maxBuffer?: number, shell?: boolean, windowsHide?: boolean}} [options] Spawn options.
 * @param {(error: Error|null, stdout: string, stderr: string) => void} callback Completion callback.
 * @returns {import('node:child_process').ChildProcess} Spawned child.
 */
function spawnFile(file, args = [], options = {}, callback = () => {}) {
    const maxBuffer = resolveMaxBuffer(options.maxBuffer);
    const child = spawn(file, args, {
        cwd: options.cwd,
        env: options.env,
        shell: options.shell === true,
        detached: options.detached === true,
        windowsHide: options.windowsHide === true
    });
    const chunks = { stdout: [], stderr: [] };
    const lengths = { stdout: 0, stderr: 0 };
    let killed = false;
    let exited = false;
    let failure = null;

    function finish(code, signal) {
        if (exited) return;
        exited = true;
        const stdout = chunks.stdout.join('');
        const stderr = chunks.stderr.join('');
        if (!failure && code === 0 && signal === null) {
            callback(null, stdout, stderr);
            return;
        }
        const cmd = args.length ? `${file} ${args.join(' ')}` : file;
        if (!failure) {
            failure = new Error(`Command failed: ${cmd}\n${stderr}`);
            failure.code = code < 0 ? getSystemErrorName(code) : code;
            failure.killed = child.killed || killed;
            failure.signal = signal;
        }
        failure.cmd = cmd;
        callback(failure, stdout, stderr);
    }

    function destroyStreams() {
        child.stdout?.destroy();
        child.stderr?.destroy();
    }

    function killForOverflow() {
        destroyStreams();
        killed = true;
        try {
            child.kill('SIGTERM');
        } catch (error) {
            failure = error;
            finish();
        }
    }

    for (const name of ['stdout', 'stderr']) {
        const stream = child[name];
        if (!stream) continue;
        stream.setEncoding('utf8');
        stream.on('data', (chunk) => {
            if (maxBuffer === Infinity) {
                chunks[name].push(chunk);
                return;
            }
            const length = Buffer.byteLength(chunk, 'utf8');
            lengths[name] += length;
            if (lengths[name] > maxBuffer) {
                chunks[name].push(chunk.slice(0, maxBuffer - (lengths[name] - length)));
                failure = maxBufferError(name);
                killForOverflow();
            } else {
                chunks[name].push(chunk);
            }
        });
    }
    child.on('close', finish);
    child.on('error', (error) => {
        failure = error;
        destroyStreams();
        finish();
    });
    return child;
}

module.exports = {
    DEFAULT_MAX_BUFFER_BYTES,
    spawnFile
};
