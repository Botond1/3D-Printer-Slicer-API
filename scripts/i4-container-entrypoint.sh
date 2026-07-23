#!/bin/sh
set -eu

expected_uid="${EXPECTED_SERVICE_UID-}"
expected_gid="${EXPECTED_SERVICE_GID-}"

case "$expected_uid" in
    ''|*[!0-9]*|0|0[0-9]*) exit 78 ;;
esac
case "$expected_gid" in
    ''|*[!0-9]*|0|0[0-9]*) exit 78 ;;
esac

actual_uid="$(id -u)"
actual_gid="$(id -g)"
if [ "$actual_uid" != "$expected_uid" ] || [ "$actual_gid" != "$expected_gid" ]; then
    exit 78
fi

pids_limit="${EXPECTED_PIDS_LIMIT-}"
memory_bytes="${EXPECTED_MEMORY_BYTES-}"
log_max_files="${EXPECTED_LOG_MAX_FILES-}"
for bounded_integer in "$pids_limit" "$memory_bytes" "$log_max_files"; do
    case "$bounded_integer" in
        ''|*[!0-9]*|0|0[0-9]*) exit 78 ;;
    esac
done
if [ "$pids_limit" -lt 64 ] || [ "$pids_limit" -gt 512 ] \
    || [ "$memory_bytes" -lt 1073741824 ] || [ "$memory_bytes" -gt 8589934592 ] \
    || [ "$log_max_files" -lt 1 ] || [ "$log_max_files" -gt 5 ]; then
    exit 78
fi

case "${EXPECTED_CPU_LIMIT-}" in
    0.5|1.0|1.5|2.0|2.5|3.0|3.5|4.0) ;;
    *) exit 78 ;;
esac
case "${EXPECTED_LOG_MAX_SIZE-}" in
    5m|10m|20m|50m) ;;
    *) exit 78 ;;
esac
case "${EXPECTED_STOP_GRACE_PERIOD-}" in
    10s|20s|30s|45s|60s) ;;
    *) exit 78 ;;
esac

assert_owned_writable_directory() {
    runtime_directory="$1"
    if [ -L "$runtime_directory" ] || [ ! -d "$runtime_directory" ]; then
        exit 78
    fi
    runtime_state="$(stat -c '%u:%g:%a:%F' -- "$runtime_directory")" || exit 78
    runtime_real_path="$(realpath -e -- "$runtime_directory")" || exit 78
    if [ "$runtime_state" != "$actual_uid:$actual_gid:700:directory" ] \
        || [ "$runtime_real_path" != "$runtime_directory" ] \
        || [ ! -w "$runtime_directory" ]; then
        exit 78
    fi
}

ensure_runtime_directory() {
    runtime_directory="$1"
    if [ -L "$runtime_directory" ] || { [ -e "$runtime_directory" ] && [ ! -d "$runtime_directory" ]; }; then
        exit 78
    fi
    if [ ! -d "$runtime_directory" ]; then
        mkdir -m 0700 -- "$runtime_directory" || exit 78
    fi
    assert_owned_writable_directory "$runtime_directory"
}

assert_immutable_profile_directory() {
    profile_directory="$1"
    if [ -L "$profile_directory" ] || [ ! -d "$profile_directory" ]; then
        exit 78
    fi
    profile_real_path="$(realpath -e -- "$profile_directory")" || exit 78
    profile_permissions="$(stat -c '%A' -- "$profile_directory")" || exit 78
    case "$profile_permissions" in
        ?????w????|????????w?) exit 78 ;;
    esac
    if [ "$profile_real_path" != "$profile_directory" ] || [ -w "$profile_directory" ]; then
        exit 78
    fi
}

for runtime_directory in /app/input /app/output /app/configs/pricing-state /tmp; do
    assert_owned_writable_directory "$runtime_directory"
done
for profile_directory in /app/configs/prusa /app/configs/orca; do
    assert_immutable_profile_directory "$profile_directory"
done

for runtime_directory in \
    /tmp/slice-jobs \
    /tmp/slicer-home \
    /tmp/xdg-cache \
    /tmp/xdg-config \
    /tmp/xdg-runtime
do
    ensure_runtime_directory "$runtime_directory"
done

exec "$@"
