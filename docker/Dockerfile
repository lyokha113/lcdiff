# Linux build environment for LCDiff (Tauri v2 + JVM sidecar).
# Bakes every toolchain the build needs so scripts/build-linux.sh runs --no-deps.
#   Rust (edition 2024 -> stable >= 1.85), Node 20, Maven, JDK 17 (jlink),
#   GTK3 + WebKit2GTK 4.1 stack.
#
# UBUNTU_VERSION picks the glibc floor of the produced binaries (glibc is only
# backward-compatible): 24.04 -> glibc 2.39, 22.04 -> 2.35, 20.04 -> 2.31.
# Build on the OLDEST distro your target runs, or it fails with
# "GLIBC_2.xx not found". 22.04 is the safe default (webkit2gtk-4.1 present;
# 20.04 only has webkit2gtk-4.0).
ARG UBUNTU_VERSION=22.04
FROM ubuntu:${UBUNTU_VERSION}

ENV DEBIAN_FRONTEND=noninteractive

# --- Tauri v2 Linux system deps (mirror scripts/build-linux.sh apt list) ------
# Plus: git, ca-certs, gnupg for tooling; openjdk-17 for jlink; maven.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl wget file ca-certificates git gnupg pkg-config \
      libwebkit2gtk-4.1-dev \
      libgtk-3-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libxdo-dev \
      libssl-dev \
      patchelf \
      openjdk-17-jdk \
      maven \
    && rm -rf /var/lib/apt/lists/*

# --- Runtime bits to actually LAUNCH the GUI headlessly (smoke test) ----------
# Xvfb (virtual X display), dbus, software GL, AppImage FUSE, fonts.
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb dbus dbus-x11 at-spi2-core \
      libgl1-mesa-dri libegl1 libglx-mesa0 mesa-vulkan-drivers \
      fonts-dejavu-core \
      fuse libfuse2 \
      x11-apps x11-utils imagemagick \
    && rm -rf /var/lib/apt/lists/*

# --- Node 20 (NodeSource; Ubuntu's nodejs is too old for the toolchain) -------
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# --- Rust (rustup, stable; edition 2024 needs >= 1.85) ------------------------
ENV RUSTUP_HOME=/opt/rustup \
    CARGO_HOME=/opt/cargo \
    PATH=/opt/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --default-toolchain stable --profile minimal \
    && rustc --version && cargo --version

# Build artifacts go to a mounted volume; keep host target/ (macOS) untouched.
ENV CARGO_TARGET_DIR=/work/target-linux

WORKDIR /work
CMD ["bash"]
