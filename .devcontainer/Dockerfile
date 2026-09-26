FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm

# Install required development utilities, C linker/compiler for cargo test, and socat for localhost forwarding
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
        build-essential \
        curl \
        git \
        libssl-dev \
        pkg-config \
        postgresql-client \
        redis-tools \
        socat \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain pinned to 1.91.0 with Soroban WASM targets matching contracts/rust-toolchain.toml
USER node
ENV RUSTUP_HOME=/home/node/.rustup \
    CARGO_HOME=/home/node/.cargo \
    PATH=/home/node/.cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    --default-toolchain 1.91.0 \
    --profile default \
    --component rustfmt clippy \
    --target wasm32-unknown-unknown wasm32v1-none
