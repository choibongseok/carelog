#!/usr/bin/env bash
# 저장소 3종(PostgreSQL·MongoDB·Redis)을 올리고 테스트용 DB 가 있는지 확인한다.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d --wait postgres mongo redis >/dev/null
if ! docker compose exec -T postgres psql -U carelog -d carelog -tAc "select 1 from pg_database where datname='carelog_test'" | grep -q 1; then
  docker compose exec -T postgres psql -U carelog -d carelog -c "create database carelog_test owner carelog" >/dev/null
fi
echo "infra ready (postgres :55432, mongo :55017, redis :56379)"
