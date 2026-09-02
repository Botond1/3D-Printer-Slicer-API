#!/bin/sh
# /usr/local/bin/bambu-studio - headless Bambu Studio launcher for the image.
#
# Plain slicing (--slice/--outputdir) needs no display and is exec'd directly.
# `--export-3mf` renders plate thumbnails through GL and therefore needs an X
# server: for that call only, a private Xvfb is started on a free display and
# always torn down afterwards. xvfb-run is deliberately not used because it
# hangs inside this container envelope.
#
# Runtime envelope: read-only root, unprivileged uid, /tmp tmpfs. Xvfb writes
# only /tmp/.X11-unix/X<n> and /tmp/.X<n>-lock; nothing else is touched.
# Tools used: coreutils/dash builtins plus Xvfb. No shell interpolation of the
# caller's arguments ever happens; "$@" is passed through verbatim.
set -eu

apprun=/opt/bambustudio/AppRun
xvfb=/usr/bin/Xvfb
socket_dir=/tmp/.X11-unix

needs_display=0
for argument in "$@"; do
    case "$argument" in
        --export-3mf|--export-3mf=*) needs_display=1 ;;
    esac
done

if [ "$needs_display" -eq 0 ]; then
    exec "$apprun" "$@"
fi

xvfb_pid=
child_pid=

cleanup() {
    if [ -n "$xvfb_pid" ]; then
        kill "$xvfb_pid" 2>/dev/null || true
        wait "$xvfb_pid" 2>/dev/null || true
        xvfb_pid=
    fi
}

forward() {
    forwarded_signal="$1"
    if [ -n "$child_pid" ]; then
        kill -s "$forwarded_signal" "$child_pid" 2>/dev/null || true
        wait "$child_pid" 2>/dev/null || true
        child_pid=
    fi
    cleanup
}

trap cleanup EXIT
trap 'forward TERM; exit 143' TERM
trap 'forward INT; exit 130' INT

# Pick a display number derived from our PID so concurrent jobs do not race
# for the same socket; on collision (socket/lock present, or Xvfb exiting
# early) move to the next number. Each attempt waits at most ~5 s for the
# socket to appear.
display=$(( $$ % 900 + 100 ))
attempt=0
while [ "$attempt" -lt 8 ]; do
    attempt=$(( attempt + 1 ))
    if [ ! -e "$socket_dir/X$display" ] && [ ! -e "/tmp/.X$display-lock" ]; then
        "$xvfb" ":$display" -screen 0 1280x1024x24 -nolisten tcp >/dev/null 2>&1 &
        xvfb_pid=$!
        waited=0
        while [ "$waited" -lt 50 ]; do
            if [ -S "$socket_dir/X$display" ]; then
                break
            fi
            if ! kill -0 "$xvfb_pid" 2>/dev/null; then
                break
            fi
            sleep 0.1
            waited=$(( waited + 1 ))
        done
        if [ -S "$socket_dir/X$display" ] && kill -0 "$xvfb_pid" 2>/dev/null; then
            break
        fi
        cleanup
    fi
    display=$(( (display - 100 + 1) % 900 + 100 ))
done

if [ -z "$xvfb_pid" ]; then
    printf '%s\n' 'bambu-studio-wrapper: xvfb_unavailable' >&2
    exit 70
fi

DISPLAY=":$display"
LIBGL_ALWAYS_SOFTWARE=1
GALLIUM_DRIVER=llvmpipe
export DISPLAY LIBGL_ALWAYS_SOFTWARE GALLIUM_DRIVER

# Run the slicer as a child (not exec) so Xvfb can be reaped afterwards, and
# propagate its exit status exactly.
"$apprun" "$@" &
child_pid=$!
status=0
wait "$child_pid" || status=$?
child_pid=
cleanup
exit "$status"
