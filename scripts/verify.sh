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

step "테스트 케이스 문서 대조"
node scripts/check-test-cases.mjs

step "build"
npm run --silent build
test -f dist/main.js && echo "dist/main.js 생성됨"

printf '\nverify 통과\n'
