#!/usr/bin/env bash
# 로컬 검증: lint, 타입 검사, 전체 테스트(unit·integration·e2e), 테스트 케이스 문서 대조, 빌드.
# 통합·e2e 는 PostgreSQL·MongoDB·Redis 가 필요해서 docker compose 로 올린다(없으면 시작).
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n== %s ==\n' "$*"; }

step "lint"
npm run --silent lint

step "typecheck"
npm run --silent typecheck

step "저장소 3종 준비"
bash scripts/infra.sh

step "테스트 (unit + integration + e2e)"
rm -f .jest-results.json
NODE_OPTIONS="--experimental-vm-modules --disable-warning=ExperimentalWarning" \
  npx jest --runInBand --json --outputFile=.jest-results.json --silent 2>&1 | grep -E '^(Tests|Test Suites):' || true
node -e '
const r = require("./.jest-results.json");
console.log(`테스트 ${r.numPassedTests}/${r.numTotalTests} 통과, 실패 ${r.numFailedTests}`);
process.exit(r.success ? 0 : 1);
'

step "web: 빌드(타입 검사 포함)"
(cd web && npm ci --no-audit --no-fund >/dev/null && npm run --silent build 2>&1 | grep -E 'built in|error' )
test -f web/dist/index.html && echo "web/dist/index.html 생성됨"

rm -f .pw-results.json
if [ -d "/Applications/Google Chrome.app" ] || command -v google-chrome >/dev/null 2>&1 || [ -n "${PW_CHANNEL+x}" ]; then
  step "web: 브라우저 E2E (Playwright)"
  (cd web && npx playwright test 2>&1 | grep -E '✓|✘|passed|failed')
else
  echo; echo "브라우저 E2E 건너뜀: Chrome 이 없습니다 (PW_CHANNEL= 로 Playwright Chromium 사용 가능)"
fi

step "테스트 케이스 문서 대조"
node scripts/check-test-cases.mjs

step "build"
npm run --silent build
test -f dist/main.js && echo "dist/main.js 생성됨"

printf '\nverify 통과\n'
