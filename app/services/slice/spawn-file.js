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
 * Exit statuses util-linux's `choom` uses when its in-place `execvp` of the
 * wrapped program fails (`EX_EXEC_ENOENT` 127, `EX_EXEC_FAILED` 126), with the
 * line it prints. A real program can exit 126/127 itself, so both the status
 * and choom's own message must match.
 */
const WRAPPER_EXEC_FAILURE = /^choom: failed to execute /m;
const WRAPPER_EXEC_STATUS = Object.freeze({ 127: 'ENOENT', 126: 'EACCES' });

function normalizeWrapped(wrapped) {
    if (!wrapped || typeof wrapped !== 'object' || typeof wrapped.file !== 'string') return null;
    return { file: wrapped.file, args: Array.isArray(wrapped.args) ? wrapped.args : [] };
}

/**
 * The spawn error Node would have raised had the wrapped program been spawned
 * directly: choom reports a failed exec as an exit status, Node as an `error`
 * event with `code`/`errno`/`syscall`/`path`.
 * @param {{file: string, args: string[]}} wrapped Original program.
 * @param {unknown} code Wrapper exit status.
 * @param {unknown} signal Wrapper signal.
 * @param {string} stderr Wrapper stderr.
 * @returns {Error|null} Equivalent spawn error, or null when the program itself ran.
 */
function wrapperExecFailure(wrapped, code, signal, stderr) {
    if (signal !== null || !Object.prototype.hasOwnProperty.call(WRAPPER_EXEC_STATUS, code)) return null;
    if (!WRAPPER_EXEC_FAILURE.test(stderr)) return null;
    const errorCode = WRAPPER_EXEC_STATUS[code];
    const error = new Error(`spawn ${wrapped.file} ${errorCode}`);
    error.errno = errorCode === 'ENOENT' ? -2 : -13;
    error.code = errorCode;
    error.syscall = `spawn ${wrapped.file}`;
    error.path = wrapped.file;
    error.spawnargs = [...wrapped.args];
    return error;
}

/**
 * Run a file like `execFile(file, args, options, callback)`.
 *
 * `options.wrapped` names the real program when `file` is an in-place exec
 * wrapper (`choom -n <adj> -- <program> <args…>`, 3.9.0): the error's `cmd` and
 * message then name the real program, and a failed exec of it is reported as
 * the spawn error Node would have given, so classifiers see exactly what they
 * saw without the wrapper. PID, process group, exit status and signal are the
 * real program's because the wrapper replaces itself with it.
 * @param {string} file Executable path.
 * @param {string[]} [args] Argument array; never interpreted by a shell.
 * @param {{detached?: boolean, env?: object, cwd?: string, maxBuffer?: number, shell?: boolean, windowsHide?: boolean, wrapped?: {file: string, args: string[]}}} [options] Spawn options.
 * @param {(error: Error|null, stdout: string, stderr: string) => void} callback Completion callback.
 * @returns {import('node:child_process').ChildProcess} Spawned child.
 */
function spawnFile(file, args = [], options = {}, callback = () => {}) {
    const maxBuffer = resolveMaxBuffer(options.maxBuffer);
    const wrapped = normalizeWrapped(options.wrapped);
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
        const shown = wrapped || { file, args };
        const cmd = shown.args.length ? `${shown.file} ${shown.args.join(' ')}` : shown.file;
        const execFailure = !failure && wrapped ? wrapperExecFailure(wrapped, code, signal, stderr) : null;
        if (execFailure) {
            // As without the wrapper: an `error` event, empty streams.
            execFailure.cmd = cmd;
            callback(execFailure, '', '');
            return;
        }
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
    spawnFile,
    wrapperExecFailure
};
