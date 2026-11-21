# syntax=docker/dockerfile:1@sha256:572cebbc2b15e6f84c077742952674889cb63cd5e9b80abdffcbe587b6f19183
# check=skip=SecretsUsedInArgOrEnv

# Build from the repo root: docker build -f crates/gateway/Dockerfile .
# SecretsUsedInArgOrEnv flags SCCACHE_S3_KEY_PREFIX, a bucket path.

FROM rust:1.100.0-slim-trixie@sha256:6f14b2b4b278ec0d50aa1d69541c304ce0f95e0f6268487aa9924af1c2e9aebe AS build
ARG TARGETARCH
ARG SCCACHE_VERSION=0.18.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* \
    && case "$TARGETARCH" in \
         amd64) arch=x86_64 sha=45f1447fbe231e3037bde351ef70677dd212216c8d62ae7ca409fecc4d6acc89 ;; \
         arm64) arch=aarch64 sha=2b3284d5da3b46a47dc4229e75bb7b88ac4aa99c8d754fb7d2f84997e5a4354a ;; \
         *) echo "unsupported Docker architecture: $TARGETARCH" >&2; exit 1 ;; \
       esac \
    && name="sccache-v$SCCACHE_VERSION-$arch-unknown-linux-musl" \
    && curl -fsSLo /tmp/sccache.tar.gz "https://github.com/mozilla/sccache/releases/download/v$SCCACHE_VERSION/$name.tar.gz" \
    && echo "$sha  /tmp/sccache.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/sccache.tar.gz -C /usr/local/bin --strip-components=1 "$name/sccache" \
    && rm /tmp/sccache.tar.gz
# Set by CI along with the aws_access_key_id and aws_secret_access_key secrets.
ARG SCCACHE_BUCKET=
ARG SCCACHE_ENDPOINT=
ARG SCCACHE_REGION=
ARG SCCACHE_S3_KEY_PREFIX=
ARG SCCACHE_S3_USE_SSL=
ENV CARGO_INCREMENTAL=0 \
    SCCACHE_BUCKET=$SCCACHE_BUCKET \
    SCCACHE_ENDPOINT=$SCCACHE_ENDPOINT \
    SCCACHE_REGION=$SCCACHE_REGION \
    SCCACHE_S3_KEY_PREFIX=$SCCACHE_S3_KEY_PREFIX \
    SCCACHE_S3_USE_SSL=$SCCACHE_S3_USE_SSL
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN --mount=type=secret,id=aws_access_key_id,env=AWS_ACCESS_KEY_ID \
    --mount=type=secret,id=aws_secret_access_key,env=AWS_SECRET_ACCESS_KEY \
    if [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$SCCACHE_BUCKET" ]; then export RUSTC_WRAPPER=sccache; fi \
    && cargo build --release --locked -p mailbowox-gateway

FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2
# gcp_auth verifies Google's certificates against the system roots.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/mailbowox-gateway /usr/local/bin/
RUN mkdir /data && chown nobody /data
USER nobody
ENV BIND=0.0.0.0:8080 DATABASE_URL=sqlite:///data/gateway.db?mode=rwc
VOLUME /data
EXPOSE 8080
CMD ["mailbowox-gateway"]
