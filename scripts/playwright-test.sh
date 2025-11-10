#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ]; then
  cat <<'EOF'
Usage: scripts/playwright-test.sh [playwright command]

Runs the specified Playwright/PNPM command inside the official Playwright Docker image
defined in docker-compose.playwright.yml. If no command is provided, the Prince George
scraper Vitest suite is executed.
EOF
  exit 0
fi

if [ "$#" -gt 0 ]; then
  TEST_CMD="$*"
else
  TEST_CMD="pnpm --filter @eventscrape/worker exec vitest run src/modules/prince_george_ca/prince_george_ca.test.ts"
fi

FULL_CMD="corepack enable pnpm && pnpm install --frozen-lockfile && ${TEST_CMD}"

# Pass through TEST_EVENT_URL if set
if [ -n "${TEST_EVENT_URL:-}" ]; then
  docker compose -f docker-compose.playwright.yml run --rm -e TEST_EVENT_URL="${TEST_EVENT_URL}" playwright "${FULL_CMD}"
else
  docker compose -f docker-compose.playwright.yml run --rm playwright "${FULL_CMD}"
fi
