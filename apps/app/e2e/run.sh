#!/bin/sh
# Recreates the test mailbox, seeds it, and runs the Maestro flows against the app on the booted simulator.
# Extra arguments go to maestro itself, e.g. ./e2e/run.sh --device <udid>
set -eu
cd "$(dirname "$0")"
mailbox=../../../dev/mailbox
docker compose -f "$mailbox/compose.yaml" down -v >/dev/null 2>&1 || true
"$mailbox/setup.sh" >/dev/null
./seed.sh
maestro "$@" test flows
