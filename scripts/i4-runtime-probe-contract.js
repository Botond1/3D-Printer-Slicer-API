'use strict';

const { ABORT_TRANSPORT_REPRESENTATIONS } = require('./i4-abort-transport-contract');

const CONTAINER_PROBE_FAILURES = Object.freeze([
    'kernel_identity',
    'runtime_environment',
    'immutable_mode',
    'immutable_write',
    'immutable_write_code',
    'writable_mode',
    'http_response_bound',
    'http_json',
    'slice_contract',
    'admin_json',
    'admin_contract',
    'output_entries_bound',
    'output_inventory_shape',
    'output_inventory_entry',
    'queue_status_shape',
    'abort_active_not_observed',
    'abort_signal_not_set',
    'abort_request_timeout',
    'abort_success_response',
    'abort_terminal_response_unbounded',
    'abort_transport_unexpected',
    'client_abort_not_settled',
    'post_abort_artifact_detected',
    'slice_execution'
]);

function expectedTmpfs(uid, gid) {
    const restrictive = `rw,nosuid,nodev,noexec,size=64m,uid=${uid},gid=${gid},mode=0700`;
    return {
        '/app/input': restrictive,
        '/app/output': restrictive,
        '/app/configs/pricing-state': restrictive,
        '/tmp': restrictive
    };
}

function evaluateProbeOutput(result) {
    if (result.stderr) return { ok: false, reason: 'container_probe_stderr' };
    const line = String(result.stdout || '').trimEnd();
    if (!line || line.includes('\n') || Buffer.byteLength(line, 'utf8') > 4096) {
        return { ok: false, reason: 'container_probe_output' };
    }
    let payload;
    try {
        payload = JSON.parse(line);
    } catch {
        return { ok: false, reason: 'container_probe_json' };
    }
    const fixed = {
        classification: 'success',
        immutableCount: 8,
        writableCount: 9,
        authenticatedSliceCount: 2,
        authenticatedClientAbortCount: 1,
        postAbortArtifactDelta: 0
    };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || JSON.stringify(Object.keys(payload).sort())
            !== JSON.stringify([...Object.keys(fixed), 'abortTransport'].sort())
        || Object.entries(fixed).some(([key, value]) => payload[key] !== value)
        || !ABORT_TRANSPORT_REPRESENTATIONS.includes(payload.abortTransport)) {
        return { ok: false, reason: 'container_probe_contract' };
    }
    return { ok: true, payload };
}

module.exports = {
    CONTAINER_PROBE_FAILURES,
    evaluateProbeOutput,
    expectedTmpfs
};
