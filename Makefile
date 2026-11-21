# Carelog 진입점. push 전에는 `make verify` 가 0 으로 끝나야 한다.
.PHONY: up down infra test test-unit test-int test-e2e verify seed simulate load lint

# 앱까지 포함해 전체 스택을 올린다(앱 http://localhost:53100, 문서 /docs, 지표 /metrics).
up:
	docker compose up -d --build --wait

down:
	docker compose down -v

# 저장소 3종만 올린다(테스트·로컬 개발용).
infra:
	bash scripts/infra.sh

lint:
	npm run lint

# 단위 + 통합 + e2e (저장소 3종 필요)
test: infra
	npm test

test-unit:
	npm run test:unit

test-int: infra
	npm run test:int

test-e2e: infra
	npm run test:e2e

# lint + 타입 검사 + 전체 테스트 + 테스트 케이스 문서 대조 + 빌드
verify:
	bash scripts/verify.sh

# 데모 계정(사용자 3, 병의원 2)을 심는다. make up 뒤에 실행.
seed:
	npm run seed

# 가상 CGM·식사 기록을 보내 요약·여정·알림이 만들어지는지 확인한다.
simulate: seed
	npm run simulate

# k6 부하 스크립트(수집 API). 결과는 load/result.json
load: seed
	bash load/run.sh
