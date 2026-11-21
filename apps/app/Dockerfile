# syntax=docker/dockerfile:1

# Build from the repo root: docker build -f apps/app/Dockerfile .

FROM rust:1.100.0-slim-trixie@sha256:6f14b2b4b278ec0d50aa1d69541c304ce0f95e0f6268487aa9924af1c2e9aebe AS rust

FROM node:24-trixie-slim AS build
ENV CI=1 EXPO_NO_TELEMETRY=1 \
    CARGO_HOME=/usr/local/cargo RUSTUP_HOME=/usr/local/rustup PATH=/usr/local/cargo/bin:$PATH
COPY --from=rust /usr/local/cargo /usr/local/cargo
COPY --from=rust /usr/local/rustup /usr/local/rustup
# ring compiles C for wasm32, which needs clang.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates clang gcc libc6-dev && rm -rf /var/lib/apt/lists/* \
    && rustup target add wasm32-unknown-unknown \
    && corepack enable
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
# The CLI has to be the version of the wasm-bindgen crate the core is built with.
RUN cargo install --locked wasm-bindgen-cli \
      --version "$(grep -A1 '^name = "wasm-bindgen"$' Cargo.lock | sed -n 's/^version = "\(.*\)"$/\1/p')"
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/app/package.json apps/app/
COPY packages/core-native/package.json packages/core-native/
RUN pnpm install --frozen-lockfile
COPY crates ./crates
COPY packages ./packages
COPY apps ./apps
RUN cd packages/core-native && CC_wasm32_unknown_unknown=clang pnpm ubrn:web
ARG EXPO_PUBLIC_SENTRY_DSN=
ARG EXPO_PUBLIC_RELAY_URL=
RUN cd apps/app && EXPO_PUBLIC_SENTRY_DSN=$EXPO_PUBLIC_SENTRY_DSN EXPO_PUBLIC_RELAY_URL=$EXPO_PUBLIC_RELAY_URL pnpm exec expo export -p web

FROM caddy:2.11-alpine AS caddy

FROM alpine:3.24
RUN adduser -D -u 10001 -h /nonexistent -s /sbin/nologin app
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY apps/app/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/app/dist /srv
ENV XDG_DATA_HOME=/tmp XDG_CONFIG_HOME=/tmp
USER 10001
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
