# ==============================================================================
# Stage 1: Builder - Ubuntu 24.04 + Node.js + Python deps
# ==============================================================================
FROM ubuntu:24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    LC_ALL=C.UTF-8 \
    LANG=C.UTF-8 \
    NODE_ENV=production \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app

# Setup Node.js repo and install builder deps
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg python3 python3-venv \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs

# Build Python venv
RUN python3 -m venv "$VIRTUAL_ENV"
COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip setuptools wheel \
    && pip install -r requirements.txt

# Install Node dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# ==============================================================================
# Stage 2: Runtime slicers - extract AppImages
# ==============================================================================
FROM ubuntu:24.04 AS slicer-base

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /tmp

ARG PRUSA_APPIMAGE_URL="https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/PrusaSlicer-2.8.1+linux-x64-newer-distros-GTK3-202409181416.AppImage"
ARG ORCA_APPIMAGE_URL="https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v2.3.1/OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.3.1.AppImage"
ARG BAMBU_APPIMAGE_URL="https://github.com/bambulab/BambuStudio/releases/download/v02.08.02.61/BambuStudio_ubuntu24.04-v02.08.02.61-20260820225108.AppImage"
ARG PRUSA_APPIMAGE_SHA256="565f2f4bd4dbb05904a459d54db1916b6932124709c1d17b5aacfe9f5f2f1b03"
ARG ORCA_APPIMAGE_SHA256="f199e5408914efdbbbfa4fd6752cd6ad4727209b488bc47bff9a0da5f053a701"
ARG BAMBU_APPIMAGE_SHA256="d501b103fac5424513ec0e8d6bc145fb30719de2c7d94d7320d723740c81a7fd"
# Swiper 12.1.2 (MIT), upstream tag commit 2fd88b718b6854e8d6be7f183e68b73b68dae816.
ARG SWIPER_VENDOR_URL="https://registry.npmjs.org/swiper/-/swiper-12.1.2.tgz"

COPY scripts/install-swiper-vendor.py /tmp/install-swiper-vendor.py

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 wget \
    && wget -q "$PRUSA_APPIMAGE_URL" -O PrusaSlicer.AppImage \
    && echo "$PRUSA_APPIMAGE_SHA256  PrusaSlicer.AppImage" | sha256sum -c - \
    && chmod +x PrusaSlicer.AppImage \
    && ./PrusaSlicer.AppImage --appimage-extract \
    && mv squashfs-root prusa-squashfs-root \
    && wget -q "$ORCA_APPIMAGE_URL" -O OrcaSlicer.AppImage \
    && echo "$ORCA_APPIMAGE_SHA256  OrcaSlicer.AppImage" | sha256sum -c - \
    && chmod +x OrcaSlicer.AppImage \
    && ./OrcaSlicer.AppImage --appimage-extract \
    && mv squashfs-root orca-squashfs-root \
    && wget -q "$BAMBU_APPIMAGE_URL" -O BambuStudio.AppImage \
    && echo "$BAMBU_APPIMAGE_SHA256  BambuStudio.AppImage" | sha256sum -c - \
    && chmod +x BambuStudio.AppImage \
    && ./BambuStudio.AppImage --appimage-extract \
    && mv squashfs-root bambu-squashfs-root \
    && wget -q --max-redirect=0 "$SWIPER_VENDOR_URL" -O swiper-12.1.2.tgz \
    && python3 /tmp/install-swiper-vendor.py \
        --archive /tmp/swiper-12.1.2.tgz \
        --orca-root /tmp/orca-squashfs-root \
        --bambu-root /tmp/bambu-squashfs-root \
        --source-url "$SWIPER_VENDOR_URL" \
    && rm -- /tmp/PrusaSlicer.AppImage /tmp/OrcaSlicer.AppImage /tmp/BambuStudio.AppImage \
        /tmp/swiper-12.1.2.tgz /tmp/install-swiper-vendor.py

# ==============================================================================
# Stage 3: Offline browser contract for the remediated Swiper bundle
# ==============================================================================
FROM mcr.microsoft.com/playwright:v1.55.0-noble@sha256:b27e719ecbfef153e13fd24e8341736733bf2658b229677eb21ff57ff5d7fb29 AS swiper-browser-check

WORKDIR /home/pwuser/swiper-browser-check
COPY --from=slicer-base --chown=pwuser:pwuser /tmp/orca-squashfs-root/resources/web/include/swiper/swiper-bundle.min.js ./swiper-bundle.min.js
COPY --from=slicer-base --chown=pwuser:pwuser /tmp/orca-squashfs-root/resources/web/include/swiper/swiper-bundle.min.css ./swiper-bundle.min.css
COPY --chown=pwuser:pwuser tests/s3a-v2c/browser-harness.html tests/s3a-v2c/browser-harness.js ./
USER pwuser

RUN --network=none --mount=type=tmpfs,target=/tmp,size=67108864 <<'SWIPER_BROWSER_CHECK'
set -eu
marker=/home/pwuser/swiper-browser-check.pass
browser_list=/tmp/swiper-browser-paths
result=/tmp/swiper-browser-result.html
find /ms-playwright -type f -path '*/chrome-linux*/chrome' -perm -u+x > "$browser_list"
test "$(wc -l < "$browser_list")" -eq 1
browser="$(cat "$browser_list")"
timeout 30s "$browser" \
  --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --disable-background-networking --disable-component-update --disable-default-apps \
  --disable-extensions --disable-sync --metrics-recording-only --no-first-run \
  --no-zygote --mute-audio --user-data-dir=/tmp/swiper-browser-profile \
  --virtual-time-budget=3000 --dump-dom \
  file:///home/pwuser/swiper-browser-check/browser-harness.html > "$result"
test "$(wc -c < "$result")" -le 2097152
grep -Fq 'data-status="PASS"' "$result"
printf '%s\n' '{"contract":"swiper-browser-check","status":"PASS"}'
printf '%s\n' 'SWIPER_BROWSER_CHECK=PASS' > "$marker"
test "$(cat "$marker")" = 'SWIPER_BROWSER_CHECK=PASS'
SWIPER_BROWSER_CHECK

# ==============================================================================
# Stage 4: Final runtime - Ubuntu 24.04 (Optimized for size & security)
# ==============================================================================
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LC_ALL=C.UTF-8 \
    LANG=C.UTF-8 \
    NODE_ENV=production \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    TMPDIR=/tmp \
    HOME=/tmp/slicer-home \
    XDG_CACHE_HOME=/tmp/xdg-cache \
    XDG_CONFIG_HOME=/tmp/xdg-config \
    XDG_RUNTIME_DIR=/tmp/xdg-runtime \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app

# Require the offline browser contract without copying its marker or browser into the final image.
RUN --mount=from=swiper-browser-check,source=/home/pwuser/swiper-browser-check.pass,target=/tmp/swiper-browser-check.pass,ro \
    test "$(cat /tmp/swiper-browser-check.pass)" = 'SWIPER_BROWSER_CHECK=PASS'

# 1. Create unprivileged user first
RUN groupadd --system slicer \
    && useradd --system --gid slicer --create-home --home-dir /home/slicer --shell /usr/sbin/nologin slicer

# 2. Install all runtime dependencies, Node.js, and perform aggressive cleanup in ONE layer
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg python3 \
        libglu1-mesa libgtk-3-0 libegl1 libwebkit2gtk-4.1-0 \
        libgomp1 libosmesa6 libxft2 libxinerama1 \
        xvfb libgl1 libgl1-mesa-dri libglx-mesa0 \
        libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /usr/lib/node_modules/npm /usr/bin/npm /usr/bin/npx /usr/bin/corepack \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/* /tmp/*

# 3. Copy extracted slicers (Owned by root - slicer user only needs execute permissions)
COPY --from=slicer-base /tmp/prusa-squashfs-root /opt/prusaslicer
COPY --from=slicer-base /tmp/orca-squashfs-root /opt/orcaslicer
COPY --from=slicer-base /tmp/bambu-squashfs-root /opt/bambustudio
RUN ln -sf /opt/prusaslicer/AppRun /usr/local/bin/prusa-slicer \
    && ln -sf /opt/orcaslicer/AppRun /usr/local/bin/orca-slicer
# Bambu Studio is reached through a root-owned wrapper, not a bare symlink: it
# starts a private Xvfb only for --export-3mf (thumbnail rendering) and tears it
# down again, so the AppRun itself is never the public entry point.
COPY --chown=0:0 --chmod=0555 scripts/bambu-studio-wrapper.sh /usr/local/bin/bambu-studio

# 4. Copy dependencies (Owned by root - highly secure, read-only for app)
COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /app/node_modules ./node_modules

# 5. Copy immutable application and profile content as root-owned files
COPY --chown=0:0 app/ ./
COPY --chown=0:0 configs/ ./configs/
COPY --chown=0:0 scripts/verify-orca-profile-vendor.js /tmp/verify-orca-profile-vendor.js
RUN node /tmp/verify-orca-profile-vendor.js \
        /app/configs/orca/upstream/Custom \
        /opt/orcaslicer/resources/profiles/Custom \
    && rm -- /tmp/verify-orca-profile-vendor.js
COPY --chown=0:0 package.json package-lock.json ./
COPY --chown=0:0 --chmod=0555 scripts/i4-container-entrypoint.sh /usr/local/bin/i4-container-entrypoint

# 6. Create only the root-scoped mutable runtime surfaces for the service user.
# Production overlays configs/pricing-state with a dedicated writable bind mount;
# configs/prusa, configs/orca, and configs/bambu remain immutable profile content.
RUN chown -R root:root /app /opt/venv /opt/prusaslicer /opt/orcaslicer /opt/bambustudio \
    && chmod -R a-w /app /opt/venv /opt/prusaslicer /opt/orcaslicer /opt/bambustudio \
    && mkdir -p input output configs/pricing-state \
    && chown slicer:slicer input output configs/pricing-state \
    && chmod 0700 input output configs/pricing-state

# Switch to safe user
USER slicer

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
    CMD node -e "const http=require('http');const req=http.get('http://127.0.0.1:3000/health',res=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.setTimeout(5000,()=>{req.destroy();process.exit(1);});"

ENTRYPOINT ["/usr/local/bin/i4-container-entrypoint"]
CMD ["node", "server.js"]
