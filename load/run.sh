#!/usr/bin/env bash
# k6 로 수집 API 를 두들기고, 끝난 뒤 소비자가 밀린 메시지를 모두 처리하는 데 걸린 시간을 잰다.
# 환경 변수: BASE_URL, RATE(초당 요청, 기본 100), DURATION(기본 30s), BATCH(요청당 이벤트, 기본 20)
set -euo pipefail
cd "$(dirname "$0")/.."
BASE_URL="${BASE_URL:-http://localhost:53100}"
command -v k6 >/dev/null || { echo "k6 가 필요하다: https://grafana.com/docs/k6/latest/set-up/install-k6/"; exit 1; }
metric() { curl -s "$BASE_URL/metrics" | awk -v n="$1" 'index($0, n " ")==1 {s+=$2} END {print s+0}'; }
BASE_URL="$BASE_URL" k6 run --quiet --summary-export load/result.json load/ingest.js || true
start=$(date +%s.%N)
while :; do
  published=$(metric carelog_outbox_published_total)
  done_ok=$(metric 'carelog_consumer_processed_total{result="ok"}')
  done_dup=$(metric 'carelog_consumer_processed_total{result="duplicate"}')
  [ "$(metric carelog_outbox_pending)" = "0" ] && [ "$published" = "$(( done_ok + done_dup ))" ] && break
  sleep 0.25
done
echo "부하 종료 후 소비자 적체 해소까지: $(printf '%.1f' "$(echo "$(date +%s.%N) - $start" | bc)")초"
curl -s "$BASE_URL/metrics" | grep -E '^carelog_(outbox_published_total|queue_delay_seconds_(sum|count)|consumer_failures_total|dead_letters_total) '
