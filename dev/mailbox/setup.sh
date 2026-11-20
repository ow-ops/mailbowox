#!/bin/sh
set -eu
cd "$(dirname "$0")"

docker compose up -d --wait stalwart
docker compose run --rm cli apply --file plan.ndjson
# Listener and auth settings only take effect after a restart.
docker compose restart stalwart
docker compose up -d --wait stalwart
