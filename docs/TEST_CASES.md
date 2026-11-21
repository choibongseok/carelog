# 테스트 케이스

모든 행은 실제 테스트 하나와 1:1 로 대응합니다. 자동화 테스트 열은 `파일::테스트 이름`(Jest 의 `it` 제목)입니다. 행 수와 실제 테스트 수는 `make verify` 가 `scripts/check-test-cases.mjs` 로 대조합니다.

통합·e2e 테스트는 실제 PostgreSQL·MongoDB·Redis 를 씁니다(`make test` 가 저장소 3종을 올립니다).

| 종류 | 개수 | 실행 |
|---|---|---|
| unit (도메인 계산·검증·커서·비밀번호, 브라우저 엔진) | 45 | `npm run test:unit` |
| integration (실제 PG·Mongo·Redis, HTTP·큐 포함) | 51 | `make test-int` |
| e2e (서버: 릴레이·워커 가동 수집→소비→조회 / 웹 데모: Playwright) | 11 | `make test-e2e`, `make test-web` |
| **합계** | **107** | `make test` / `make verify` |

| ID | 영역 | 시나리오 | 입력/조건 | 기대 결과 | 자동화 테스트(파일::함수) | 종류 |
|---|---|---|---|---|---|---|
| SUM-001 | 요약/계산 | 평균 혈당과 목표 범위 내 비율을 계산한다 | 측정 100·200·60·140, 범위 70~180 | 평균 125, 범위 내 50% | `src/domain/summary.spec.ts::평균 혈당과 목표 범위 내 비율을 계산한다` | unit |
| SUM-002 | 요약/계산 | 측정이 없으면 평균과 비율은 null 이다 | 측정 0건, 식사 1건 | 평균·비율 null, readings 0, meals 1 | `src/domain/summary.spec.ts::측정이 없으면 평균과 비율은 null 이다` | unit |
| SUM-003 | 요약/계산 | 사용자별 목표 범위를 적용한다 | 측정 75·95·125 를 70~180 과 80~110 으로 각각 계산 | 100% 와 33.3% | `src/domain/summary.spec.ts::사용자별 목표 범위를 적용한다` | unit |
| SUM-004 | 요약/계산 | 경계값(70, 180)은 범위 안으로 센다 | 측정 70, 180 | 범위 내 100% | `src/domain/summary.spec.ts::경계값(70, 180)은 범위 안으로 센다` | unit |
| SUM-005 | 요약/식후 급상승 | 식사 후 2시간 안에 식전 대비 50 이상 오르면 급상승 1회로 센다 | 식전 100, 식후 30분 150 | 급상승 true, 요약의 postMealSpikes=1 | `src/domain/summary.spec.ts::식사 후 2시간 안에 식전 대비 50 이상 오르면 급상승 1회로 센다` | unit |
| SUM-006 | 요약/식후 급상승 | 상승폭이 50 미만이면 급상승이 아니다 | 식전 100, 식후 149 | false | `src/domain/summary.spec.ts::상승폭이 50 미만이면 급상승이 아니다` | unit |
| SUM-007 | 요약/순서 역전 | 입력 순서가 뒤바뀌어도 같은 결과가 나온다 | 같은 측정을 시간순·뒤섞은 순서로 계산 | 두 결과가 동일 | `src/domain/summary.spec.ts::입력 순서가 뒤바뀌어도 같은 결과가 나온다` | unit |
| SUM-008 | 요약/식후 급상승 | 식전 기준값이 없으면 식사 직후 15분 안의 첫 측정을 기준으로 삼는다 | 식전 측정 없음, 식사 10분 뒤 100 → 50분 뒤 170 | 직후 측정이 있으면 true, 40분 뒤에 처음 측정되면 false | `src/domain/summary.spec.ts::식전 기준값이 없으면 식사 직후 15분 안의 첫 측정을 기준으로 삼는다` | unit |
| SUM-009 | 요약/식후 급상승 | 식후 2시간을 넘긴 상승은 세지 않는다 | 식전 100, 2시간 30분 뒤 200 | false | `src/domain/summary.spec.ts::식후 2시간을 넘긴 상승은 세지 않는다` | unit |
| SUM-010 | 요약/주간 | 일일 요약을 측정 개수 가중으로 합친다 | 100회·평균 100·범위 100%, 300회·평균 140·범위 60% | 400회, 평균 130, 범위 70%, 급상승 3, 식사 6 | `src/domain/summary.spec.ts::일일 요약을 측정 개수 가중으로 합친다` | unit |
| ALT-001 | 알림/판정 | 임계 미만은 low, 초과는 high 로 판정한다 | 54, 300, 120 (임계 70/250) | low, high, null | `src/domain/alerts.spec.ts::임계 미만은 low, 초과는 high 로 판정한다` | unit |
| ALT-002 | 알림/판정 | 경계값 자체는 알리지 않는다 | 70, 250, 69, 251 | null, null, low, high | `src/domain/alerts.spec.ts::경계값 자체는 알리지 않는다` | unit |
| ALT-003 | 알림/판정 | 사용자별 임계값을 따른다 | 임계 60/200 에서 65, 210 | null, high | `src/domain/alerts.spec.ts::사용자별 임계값을 따른다` | unit |
| JNY-001 | 여정/계산 | 식후 측정은 식사 30~150분 뒤의 기록만 센다 | 식사 3건과 12:29·12:30·20:31·21:10 측정 | 30분 이상 150분 이내 기록이 있는 식사 1건만 센다 | `src/domain/journey.spec.ts::식후 측정은 식사 30~150분 뒤의 기록만 센다` | unit |
| JNY-002 | 여정/계산 | 미션이 모자라면 현재 주차를 유지한다 | 1주차에 혈당 10건 | 1주차 유지, 전환 없음, 완료 아님 | `src/domain/journey.spec.ts::미션이 모자라면 현재 주차를 유지한다` | unit |
| JNY-003 | 여정/계산 | 1주차 미션을 모두 채우면 2주차로 전환한다 | 혈당 23건(기록 20+식후 3), 식사 3건 | 전환 1→2 | `src/domain/journey.spec.ts::1주차 미션을 모두 채우면 2주차로 전환한다` | unit |
| JNY-004 | 여정/계산 | 다른 주차의 기록은 해당 주차 진행에 섞이지 않는다 | 1주차 1건, 2주차 2건 | 주차별 기록 횟수 1, 2 | `src/domain/journey.spec.ts::다른 주차의 기록은 해당 주차 진행에 섞이지 않는다` | unit |
| JNY-005 | 여정/단계 전환 | 늦게 도착한 기록으로 여러 주차를 한 번에 연속 전환할 수 있다 | 1·2주차 미션을 모두 채운 기록을 한꺼번에 평가 | 전환 1→2, 2→3, 현재 3주차 | `src/domain/journey.spec.ts::늦게 도착한 기록으로 여러 주차를 한 번에 연속 전환할 수 있다` | unit |
| JNY-006 | 여정/단계 전환 | 4주차까지 모두 채우면 프로그램이 완료된다 | 4주 분량 기록 | 마지막 전환 4→완료, completed true | `src/domain/journey.spec.ts::4주차까지 모두 채우면 프로그램이 완료된다` | unit |
| JNY-007 | 여정/단계 전환 | 이미 넘어간 단계는 기록이 없어도 되돌아가지 않는다 | 현재 3주차, 기록 없음 | 3주차 유지, 전환 없음 | `src/domain/journey.spec.ts::이미 넘어간 단계는 기록이 없어도 되돌아가지 않는다` | unit |
| CUR-001 | 커서/날짜 | 인코딩한 커서를 그대로 복원한다 | {at, id} 를 인코딩 후 디코딩 | 원래 값과 동일 | `src/domain/cursor.spec.ts::인코딩한 커서를 그대로 복원한다` | unit |
| CUR-002 | 커서/날짜 | 잘못된 커서는 null 을 돌려준다 | 깨진 문자열, 잘못된 at, 문자열 id | 모두 null | `src/domain/cursor.spec.ts::잘못된 커서는 null 을 돌려준다` | unit |
| CUR-003 | 커서/날짜 | 주 시작은 월요일이다 | 월·일·다음 월요일 | 같은 주는 같은 월요일 | `src/domain/cursor.spec.ts::주 시작은 월요일이다` | unit |
| CUR-004 | 커서/날짜 | 날짜 문자열을 엄격하게 검증한다 | 2026-02-30, 2026-1-2, 연말 +1일 | 유효하지 않은 날짜는 거부, 날짜 덧셈은 연도 경계를 넘는다 | `src/domain/cursor.spec.ts::날짜 문자열을 엄격하게 검증한다` | unit |
| VAL-001 | 수집/검증 | 혈당·식사·활동 이벤트를 정규화한다 | 혈당·식사·활동 각 1건 | 종류별 필드가 정규화되고 거부 0건 | `src/domain/validation.spec.ts::혈당·식사·활동 이벤트를 정규화한다` | unit |
| VAL-002 | 수집/검증 | 잘못된 항목만 거부하고 나머지는 받는다 | 정상 2건 사이에 mgdl 문자열 1건, 문자열 항목 1건 | 정상 2건 통과, 거부 2건(인덱스·eventId 포함) | `src/domain/validation.spec.ts::잘못된 항목만 거부하고 나머지는 받는다` | unit |
| VAL-003 | 수집/검증 | 미래 시각과 30일보다 오래된 시각은 거부한다 | 현재+10분, 40일 전, 현재+4분 | +4분만 통과 | `src/domain/validation.spec.ts::미래 시각과 30일보다 오래된 시각은 거부한다` | unit |
| VAL-004 | 수집/검증 | eventId 형식이 틀리면 거부한다 | 빈 문자열, 공백 포함, 65자, 숫자 | 4건 모두 거부 | `src/domain/validation.spec.ts::eventId 형식이 틀리면 거부한다` | unit |
| VAL-005 | 수집/검증 | 혈당 값이 범위(20~600) 밖이거나 정수가 아니면 거부한다 | 19, 601, 100.5, 20 | 20 만 통과 | `src/domain/validation.spec.ts::혈당 값이 범위(20~600) 밖이거나 정수가 아니면 거부한다` | unit |
| VAL-006 | 수집/검증 | 활동 기록은 종류와 시간이 필요하다 | activityType 없음, durationMin 없음, 둘 다 있음 | 둘 다 있는 것만 통과 | `src/domain/validation.spec.ts::활동 기록은 종류와 시간이 필요하다` | unit |
| VAL-007 | 수집/검증 | events 가 배열이 아니면 예외를 던진다 | events 가 객체 | 예외, 배치 상한은 500 | `src/domain/validation.spec.ts::events 가 배열이 아니면 예외를 던진다` | unit |
| AUT-001 | 인증/비밀번호 | 맞는 비밀번호만 통과한다 | demo1234 해시에 demo1234, demo12345 검증 | true, false | `src/auth/password.spec.ts::맞는 비밀번호만 통과한다` | unit |
| AUT-002 | 인증/비밀번호 | 같은 비밀번호도 솔트가 달라 해시가 다르고, 깨진 형식은 거부한다 | 같은 비밀번호 두 번 해시, 형식이 깨진 저장값 | 해시가 서로 다름, 깨진 형식은 false | `src/auth/password.spec.ts::같은 비밀번호도 솔트가 달라 해시가 다르고, 깨진 형식은 거부한다` | unit |
| WEB-001 | 웹 엔진/멱등 | 같은 eventId 를 다시 보내면 저장하지 않고 중복으로 센다 | 30틱 진행 후 최근 10건 재전송 | accepted 0, duplicates 10, 저장 수 불변 | `web/src/engine/engine.spec.ts::같은 eventId 를 다시 보내면 저장하지 않고 중복으로 센다` | unit |
| WEB-002 | 웹 엔진/검증 | 잘못된 값은 거부하고 나머지는 저장한다 | 정상 1건, mgdl 9999, 형식 틀린 eventId | 저장 1, 거부 2 | `web/src/engine/engine.spec.ts::잘못된 값은 거부하고 나머지는 저장한다` | unit |
| WEB-003 | 웹 엔진/아웃박스 | 저장과 함께 아웃박스 행이 생기고 릴레이가 큐로 옮긴다 | 1건 수집 후 relay | 미발행 1 → 0, 큐 1 | `web/src/engine/engine.spec.ts::저장과 함께 아웃박스 행이 생기고 릴레이가 큐로 옮긴다` | unit |
| WEB-004 | 웹 엔진/요약 | 소비자가 만든 일일 요약은 서버와 같은 계산 함수의 결과와 같다 | 100틱 진행 | 엔진 요약 = computeDailySummary(src/domain) 결과 | `web/src/engine/engine.spec.ts::소비자가 만든 일일 요약은 서버와 같은 계산 함수의 결과와 같다` | unit |
| WEB-005 | 웹 엔진/멱등 | 큐가 같은 메시지를 다시 전달해도 한 번만 반영한다 | 처리된 메시지를 다시 전달 | 처리 수 불변, 건너뜀 1 | `web/src/engine/engine.spec.ts::큐가 같은 메시지를 다시 전달해도 한 번만 반영한다` | unit |
| WEB-006 | 웹 엔진/재시도 | 소비자 실패를 주입하면 재시도 끝에 dead-letter 로 가고, 해제 후 재처리하면 반영된다 | 실패 주입 후 20틱, 해제 후 재처리 | dead-letter 증가·요약 없음 → 재처리 후 요약 생성 | `web/src/engine/engine.spec.ts::소비자 실패를 주입하면 재시도 끝에 dead-letter 로 가고, 해제 후 재처리하면 반영된다` | unit |
| WEB-007 | 웹 엔진/알림 | 저혈당·고혈당 알림은 같은 기록당 한 번만 만든다 | 50, 300 기록 후 같은 메시지 재전달 | 알림 low, high 각 1 | `web/src/engine/engine.spec.ts::저혈당·고혈당 알림은 같은 기록당 한 번만 만든다` | unit |
| WEB-008 | 웹 엔진/여정 | 하루를 돌리면 1주차 미션을 채워 2주차로 전환한다 | 288틱 진행 | 현재 2주차, 전환 1→2 | `web/src/engine/engine.spec.ts::하루를 돌리면 1주차 미션을 채워 2주차로 전환한다` | unit |
| WEB-009 | 웹 엔진/병의원 | 동의가 없으면 404 이고 동의 후에는 200, 철회하면 바로 막히며 모두 감사 로그에 남는다 | 거부, 동의, 철회 순으로 조회 | 404, 200, 404, 감사 로그 허용 여부 [false,true,false] | `web/src/engine/engine.spec.ts::동의가 없으면 404 이고 동의 후에는 200, 철회하면 바로 막히며 모두 감사 로그에 남는다` | unit |
| WEB-010 | 웹 엔진/재현성 | 같은 시드로 돌리면 결과가 결정적이다 | 같은 시드 두 엔진 120틱 | 요약·저장 수 동일 | `web/src/engine/engine.spec.ts::같은 시드로 돌리면 결과가 결정적이다` | unit |
| WEB-011 | 웹 엔진/순서 역전 | 오프라인 보관 후 역순으로 보내도 최종 요약은 순서대로 보낸 것과 같고 순서 역전 반영이 집계된다 | 90틱 오프라인 후 묶음을 역순 전송 | 순서 역전 집계 > 0, 요약이 정상 순서와 동일 | `web/src/engine/engine.spec.ts::오프라인 보관 후 역순으로 보내도 최종 요약은 순서대로 보낸 것과 같고 순서 역전 반영이 집계된다` | unit |
| WEB-012 | 웹 엔진/요약 | 하루가 지나면 다음 날 요약이 따로 만들어진다 | 288+40틱 | 날짜별 요약 분리(첫날 287회) | `web/src/engine/engine.spec.ts::하루가 지나면 다음 날 요약이 따로 만들어진다` | unit |
| ING-001 | 수집/저장 | 수집한 기록은 PostgreSQL 에 정규화되고 원본은 MongoDB 에 남는다 | 혈당·식사·활동 3건 배치 | 200, accepted 3, PG 행 값 정규화, Mongo 원본(deliveries 1) | `test/ingest.int-spec.ts::수집한 기록은 PostgreSQL 에 정규화되고 원본은 MongoDB 에 남는다` | integration |
| ING-002 | 수집/멱등 | 같은 eventId 를 다시 보내면 중복으로 차단하고 행이 늘지 않는다 | 2건 전송 후 같은 2건 + 새 1건 전송 | accepted 1, duplicates 2, PG 3행, 원본 deliveries 2 | `test/ingest.int-spec.ts::같은 eventId 를 다시 보내면 중복으로 차단하고 행이 늘지 않는다` | integration |
| ING-003 | 수집/멱등 | 한 배치 안의 같은 eventId 는 한 건만 저장한다 | 같은 eventId 2건이 한 배치에 | accepted 1, duplicates 1 | `test/ingest.int-spec.ts::한 배치 안의 같은 eventId 는 한 건만 저장한다` | integration |
| ING-004 | 수집/멱등 | eventId 는 사용자별로 독립이라 다른 사용자의 같은 ID 는 영향을 주지 않는다 | 두 사용자가 같은 eventId 전송 | 둘 다 accepted 1 | `test/ingest.int-spec.ts::eventId 는 사용자별로 독립이라 다른 사용자의 같은 ID 는 영향을 주지 않는다` | integration |
| ING-005 | 수집/검증 | 잘못된 항목은 rejected 로 돌려주고 나머지는 저장한다 | 정상 2건 + mgdl 9999 1건 | accepted 2, rejected 1(인덱스·eventId·사유) | `test/ingest.int-spec.ts::잘못된 항목은 rejected 로 돌려주고 나머지는 저장한다` | integration |
| ING-006 | 수집/순서 역전 | 순서가 뒤바뀌어 늦게 도착한 기록도 측정 시각 순으로 조회된다 | 10:00 기록을 먼저, 08:00·09:00 기록을 나중에 전송 | 타임라인이 10:00, 09:00, 08:00 순 | `test/ingest.int-spec.ts::순서가 뒤바뀌어 늦게 도착한 기록도 측정 시각 순으로 조회된다` | integration |
| ING-007 | 수집/아웃박스 | 기록과 같은 트랜잭션으로 아웃박스 행이 날짜별로 만들어진다 | 자정 전후 3건 | 아웃박스 2행(날짜별), 미발행, 이벤트 수 1·2 | `test/ingest.int-spec.ts::기록과 같은 트랜잭션으로 아웃박스 행이 날짜별로 만들어진다` | integration |
| ING-008 | 수집/아웃박스 | 중복만 담긴 배치는 아웃박스 행을 만들지 않는다 | 같은 1건을 두 번 전송 | 아웃박스 1행 | `test/ingest.int-spec.ts::중복만 담긴 배치는 아웃박스 행을 만들지 않는다` | integration |
| ING-009 | 수집/권한 | 토큰이 없거나 병의원 토큰이면 수집이 거부된다 | 토큰 없음, clinic 토큰 | 401, 403 | `test/ingest.int-spec.ts::토큰이 없거나 병의원 토큰이면 수집이 거부된다` | integration |
| ING-010 | 수집/검증 | events 가 비었거나 500건을 넘으면 400 으로 거부한다 | 0건, 501건, 500건 | 400, 400, 200(accepted 500) | `test/ingest.int-spec.ts::events 가 비었거나 500건을 넘으면 400 으로 거부한다` | integration |
| OBX-001 | 아웃박스/릴레이 | 미발행 행을 큐에 넣고 발행 시각을 남긴다 | 미발행 3행에 relayOnce | 3 발행, 미발행 0, 큐 대기 3 | `test/outbox.int-spec.ts::미발행 행을 큐에 넣고 발행 시각을 남긴다` | integration |
| OBX-002 | 아웃박스/릴레이 | 이미 발행한 행은 다시 발행하지 않는다 | relayOnce 두 번 | 두 번째는 0 | `test/outbox.int-spec.ts::이미 발행한 행은 다시 발행하지 않는다` | integration |
| OBX-003 | 아웃박스/릴레이 | 릴레이 두 개가 동시에 돌아도 각 행은 한 번만 발행된다 | 20행에 relayOnce(10) 두 개 동시 | 합계 20, 큐 대기 20 | `test/outbox.int-spec.ts::릴레이 두 개가 동시에 돌아도 각 행은 한 번만 발행된다` | integration |
| OBX-004 | 아웃박스/릴레이 | 같은 아웃박스 ID 를 큐에 다시 넣어도 작업은 하나로 합쳐진다 | 발행 후 표시를 되돌려 다시 발행 | 큐 대기 1 | `test/outbox.int-spec.ts::같은 아웃박스 ID 를 큐에 다시 넣어도 작업은 하나로 합쳐진다` | integration |
| QUE-001 | 큐/재시도 | 소비자가 계속 실패하면 재시도 횟수만큼 시도하고 dead_letters 에 남긴다 | 처리기가 항상 예외, 시도 3회 설정 | 호출 3회, dead_letters 1행(attempts 3), 실패·dead-letter 지표 증가 | `test/queue.int-spec.ts::소비자가 계속 실패하면 재시도 횟수만큼 시도하고 dead_letters 에 남긴다` | integration |
| QUE-002 | 큐/재시도 | 일시적으로 실패해도 재시도로 성공하면 dead-letter 로 가지 않고 한 번만 반영된다 | 처음 2번 실패하는 처리기 | 3번째에 성공, dead_letters 0, 알림 1건 | `test/queue.int-spec.ts::일시적으로 실패해도 재시도로 성공하면 dead-letter 로 가지 않고 한 번만 반영된다` | integration |
| CON-001 | 소비자/요약 | 메시지를 처리하면 일일 요약이 저장된다 | 측정 100·200·60·140 | 측정 4회, 평균 125, 범위 내 50% | `test/consumer.int-spec.ts::메시지를 처리하면 일일 요약이 저장된다` | integration |
| CON-002 | 소비자/요약 | 식후 급상승 횟수가 요약에 반영된다 | 식전 100, 식사, 식후 170 | 급상승 1, 식사 1 | `test/consumer.int-spec.ts::식후 급상승 횟수가 요약에 반영된다` | integration |
| CON-003 | 소비자/요약 | 사용자별 목표 범위 설정이 요약에 적용된다 | 같은 기록을 범위 70~180 사용자와 80~140 사용자가 전송 | 100% 와 33.3% | `test/consumer.int-spec.ts::사용자별 목표 범위 설정이 요약에 적용된다` | integration |
| CON-004 | 소비자/멱등 | 같은 메시지를 두 번 처리해도 한 번만 반영된다 | 같은 아웃박스 메시지를 handle 두 번 | "ok", "duplicate", 알림 1, 처리 이력 1 | `test/consumer.int-spec.ts::같은 메시지를 두 번 처리해도 한 번만 반영된다` | integration |
| CON-005 | 소비자/순서 역전 | 배치가 어떤 순서로 처리돼도 요약 결과가 같다 | 같은 두 배치를 사용자별로 정순·역순 처리 | 두 사용자의 요약이 동일 | `test/consumer.int-spec.ts::배치가 어떤 순서로 처리돼도 요약 결과가 같다` | integration |
| CON-006 | 소비자/알림 | 저혈당·고혈당 기록은 알림을 만들고 경계값은 만들지 않는다 | 65, 70, 300, 250, 120 | 알림은 low 65 와 high 300 만 | `test/consumer.int-spec.ts::저혈당·고혈당 기록은 알림을 만들고 경계값은 만들지 않는다` | integration |
| CON-007 | 소비자/알림 | 같은 기록에 대한 알림은 다른 메시지로 다시 와도 한 번만 만든다 | 같은 기록을 다른 outboxId 로 재처리 | 알림 1건 | `test/consumer.int-spec.ts::같은 기록에 대한 알림은 다른 메시지로 다시 와도 한 번만 만든다` | integration |
| CON-008 | 소비자/여정 | 1주차 미션을 채우면 2주차로 전환하고 전환 이력을 남긴다 | 혈당 20건 + 식후 측정 3건 | 현재 2주차, 전환 1→2, 1주차 미션 완료 | `test/consumer.int-spec.ts::1주차 미션을 채우면 2주차로 전환하고 전환 이력을 남긴다` | integration |
| CON-009 | 소비자/여정 | 미션이 모자라면 현재 주차에 머문다 | 혈당 1건, 활동 1건 | 1주차, glucose_logs 1/20 | `test/consumer.int-spec.ts::미션이 모자라면 현재 주차에 머문다` | integration |
| CON-010 | 소비자/여정 | 1주차 중 더 오래된 기록이 늦게 도착하면 시작일을 앞당긴다 | 2일 전 기록 처리 후 5일 전 기록 도착 | startedOn 이 5일 전으로 이동 | `test/consumer.int-spec.ts::1주차 중 더 오래된 기록이 늦게 도착하면 시작일을 앞당긴다` | integration |
| CON-011 | 소비자/동시성 | 같은 사용자의 두 메시지를 동시에 처리해도 최종 요약에 모든 기록이 들어간다 | 같은 날 30건씩 두 배치를 Promise.all 로 처리 | 측정 60회, 평균 110 | `test/consumer.int-spec.ts::같은 사용자의 두 메시지를 동시에 처리해도 최종 요약에 모든 기록이 들어간다` | integration |
| CON-012 | 소비자/캐시 | 처리가 끝나면 요약 캐시가 무효화되어 최신 값이 조회된다 | 조회로 캐시 적재 후 새 기록 수집, 소비 전·후 조회 | 소비 전 1회(캐시), 소비 후 2회 | `test/consumer.int-spec.ts::처리가 끝나면 요약 캐시가 무효화되어 최신 값이 조회된다` | integration |
| QRY-001 | 조회/타임라인 | 타임라인 커서 페이지네이션은 모든 기록을 중복·누락 없이 순회한다 | 27건(측정 시각이 같은 2건 포함), limit 10 | 3페이지, 27건, 중복 없음 | `test/query.int-spec.ts::타임라인 커서 페이지네이션은 모든 기록을 중복·누락 없이 순회한다` | integration |
| QRY-002 | 조회/타임라인 | 타임라인의 limit·cursor 가 잘못되면 400 이다 | limit=0, 201, abc, cursor=garbage | 모두 400 | `test/query.int-spec.ts::타임라인의 limit·cursor 가 잘못되면 400 이다` | integration |
| QRY-003 | 조회/권한 | 사용자는 userId 를 지정해도 자기 기록만 본다 | 사용자 1 이 ?userId=user-2 로 요청 | 사용자 1 의 기록만 | `test/query.int-spec.ts::사용자는 userId 를 지정해도 자기 기록만 본다` | integration |
| QRY-004 | 조회/요약 | 주간 요약은 월요일 시작 7일 범위를 합산한다 | 지난주 월요일의 측정 3건과 식사 1건 | weekStart 가 월요일, 측정 3, 평균 146.7, 식사 1 | `test/query.int-spec.ts::주간 요약은 월요일 시작 7일 범위를 합산한다` | integration |
| QRY-005 | 조회/요약 | 날짜 형식이 틀리면 400 이다 | 2026-13-01, yesterday | 둘 다 400 | `test/query.int-spec.ts::날짜 형식이 틀리면 400 이다` | integration |
| QRY-006 | 조회/캐시 | 요약은 Redis 에 캐시되어 두 번째 조회는 DB 를 거치지 않는다 | 조회 후 DB 값을 직접 바꾸고 재조회 | 캐시 키 존재, 값은 캐시 그대로, 적중 지표 증가 | `test/query.int-spec.ts::요약은 Redis 에 캐시되어 두 번째 조회는 DB 를 거치지 않는다` | integration |
| QRY-007 | 조회/여정 | 여정 현황은 가입 전에는 enrolled=false 이다 | 기록 없는 사용자 | { enrolled: false } | `test/query.int-spec.ts::여정 현황은 가입 전에는 enrolled=false 이다` | integration |
| CLN-001 | 병의원/동의 | 동의한 병의원만 환자의 요약을 볼 수 있다 | 동의 전후에 병의원이 환자 요약 조회 | 동의 전 404, 동의 후 200 과 요약 값 | `test/clinic.int-spec.ts::동의한 병의원만 환자의 요약을 볼 수 있다` | integration |
| CLN-002 | 병의원/IDOR | 동의가 없는 사용자와 존재하지 않는 사용자는 같은 응답이라 존재 여부가 드러나지 않는다 | 동의 없는 user-2, 없는 user-999 | 둘 다 404, 본문 동일 | `test/clinic.int-spec.ts::동의가 없는 사용자와 존재하지 않는 사용자는 같은 응답이라 존재 여부가 드러나지 않는다` | integration |
| CLN-003 | 병의원/IDOR | 다른 병의원이 받은 동의로는 조회할 수 없다(IDOR) | clinic-1 에만 동의, clinic-2 가 일일·주간 조회 | 둘 다 404 | `test/clinic.int-spec.ts::다른 병의원이 받은 동의로는 조회할 수 없다(IDOR)` | integration |
| CLN-004 | 병의원/동의 | 동의를 철회하면 캐시가 남아 있어도 즉시 차단된다 | 병의원 조회로 요약 캐시 적재, 동의 철회 후 재조회 | 철회 후 404, 환자 목록 빈 배열 | `test/clinic.int-spec.ts::동의를 철회하면 캐시가 남아 있어도 즉시 차단된다` | integration |
| CLN-005 | 병의원/동의 | 철회 뒤 다시 동의하면 다시 볼 수 있다 | 동의, 철회, 재동의 | 조회 200 | `test/clinic.int-spec.ts::철회 뒤 다시 동의하면 다시 볼 수 있다` | integration |
| CLN-006 | 병의원/감사 | 조회는 허용·거부 모두 감사 로그에 남고 사용자가 확인할 수 있다 | 거부 1회, 동의, 허용 1회 | 감사 로그 2행(allowed false, true, 요청 ID 포함), 사용자 access-log 에 표시, 다른 사용자는 빈 목록 | `test/clinic.int-spec.ts::조회는 허용·거부 모두 감사 로그에 남고 사용자가 확인할 수 있다` | integration |
| CLN-007 | 병의원/동의 | 병의원 환자 목록에는 동의한 사용자만 나온다 | user-1 → clinic-1, user-2 → clinic-2 동의 | clinic-1 목록은 user-1 만 | `test/clinic.int-spec.ts::병의원 환자 목록에는 동의한 사용자만 나온다` | integration |
| CLN-008 | 병의원/권한 | 사용자 토큰으로 병의원 API 를, 병의원 토큰으로 사용자 API 를 부르면 403 이다 | 역할을 바꿔 호출 | 모두 403 | `test/clinic.int-spec.ts::사용자 토큰으로 병의원 API 를, 병의원 토큰으로 사용자 API 를 부르면 403 이다` | integration |
| CLN-009 | 병의원/동의 | 없는 병의원에 동의하거나 활성 동의가 없는데 철회하면 404 이다 | clinic-999 동의, 동의 없이 철회 | 둘 다 404 | `test/clinic.int-spec.ts::없는 병의원에 동의하거나 활성 동의가 없는데 철회하면 404 이다` | integration |
| OPS-001 | 인증/로그인 | 시드 계정으로 로그인하면 JWT 를 받고 틀린 비밀번호는 401 이다 | 정상, 틀린 비밀번호, 없는 계정, 병의원 로그인 | 200 과 토큰, 401 두 건은 같은 메시지, 병의원 role=clinic | `test/ops.int-spec.ts::시드 계정으로 로그인하면 JWT 를 받고 틀린 비밀번호는 401 이다` | integration |
| OPS-002 | 인증/토큰 | 변조되었거나 형식이 틀린 토큰은 401 이다 | 서명이 바뀐 토큰, Basic 헤더, 헤더 없음 | 모두 401 | `test/ops.int-spec.ts::변조되었거나 형식이 틀린 토큰은 401 이다` | integration |
| OPS-003 | 관측/health | /health 는 PostgreSQL·MongoDB·Redis 가 모두 정상이면 ok 를 돌려준다 | 세 저장소 정상 | 200, 세 항목 up | `test/ops.int-spec.ts::/health 는 PostgreSQL·MongoDB·Redis 가 모두 정상이면 ok 를 돌려준다` | integration |
| OPS-004 | 관측/metrics | /metrics 는 수집·중복·아웃박스 적체 지표를 노출한다 | 수집 2건·거부 1건, 중복 1건 전송 | 수집 2, 중복 1, 거부 1, 아웃박스 적체 1, HTTP 지연 히스토그램 | `test/ops.int-spec.ts::/metrics 는 수집·중복·아웃박스 적체 지표를 노출한다` | integration |
| OPS-005 | 관측/요청 ID | 요청 ID 를 응답 헤더로 돌려주고 들어온 유효한 값은 유지한다 | 헤더 없음, 유효한 x-request-id, 공백 포함 값 | UUID 생성, 값 유지, 잘못된 값은 교체 | `test/ops.int-spec.ts::요청 ID 를 응답 헤더로 돌려주고 들어온 유효한 값은 유지한다` | integration |
| OPS-006 | 관측/문서 | OpenAPI 문서에 수집·조회·병의원 경로가 들어 있다 | /docs-json | 핵심 경로 포함 | `test/ops.int-spec.ts::OpenAPI 문서에 수집·조회·병의원 경로가 들어 있다` | integration |
| OPS-007 | 관측/health | Redis 연결이 끊기면 /health 는 503 과 함께 어느 저장소가 내려갔는지 알려준다 | Redis 연결을 끊고 호출 | 503, redis down, 나머지 up | `test/ops.int-spec.ts::Redis 연결이 끊기면 /health 는 503 과 함께 어느 저장소가 내려갔는지 알려준다` | integration |
| E2E-001 | 전체 흐름 | 기록을 보내면 요약·알림이 비동기로 만들어져 조회된다 | 식전·식후·저혈당·고혈당 기록 6건 전송 후 조회(릴레이·워커 가동) | 요약 5회·급상승 1, 알림 low/high 각 1, 큐 지연·처리 지표 증가 | `test/flow.e2e-spec.ts::기록을 보내면 요약·알림이 비동기로 만들어져 조회된다` | e2e |
| E2E-002 | 전체 흐름 | 중복·지연·순서 역전이 섞인 오프라인 동기화도 순서대로 보낸 것과 같은 요약이 된다 | 사용자 A 는 한 번에 순서대로, 사용자 B 는 역순·쪼개기·재전송 | 두 요약이 동일, B 의 저장 행 43 | `test/flow.e2e-spec.ts::중복·지연·순서 역전이 섞인 오프라인 동기화도 순서대로 보낸 것과 같은 요약이 된다` | e2e |
| E2E-003 | 전체 흐름 | 기록이 누적되면 여정이 2주차로 전환된다 | 1주차 미션 분량 전송 | 현재 2주차, 전환 이력 1→2 | `test/flow.e2e-spec.ts::기록이 누적되면 여정이 2주차로 전환된다` | e2e |
| E2E-004 | 웹 데모 | 첫 화면에 시뮬레이션·합성 데이터·의료 조언 아님이 항상 보이고 콘솔 오류가 없다 | 페이지 열고 12틱 진행 | 배너 문구 표시, 콘솔·페이지 오류 0 | `web/e2e/demo.spec.ts::첫 화면에 시뮬레이션·합성 데이터·의료 조언 아님이 항상 보이고 콘솔 오류가 없다` | e2e |
| E2E-005 | 웹 데모 | 1틱씩 진행하면 곡선·타임라인·파이프라인 카운터가 늘어난다 | 9틱 진행 | 저장 수 증가, 곡선 점 9개, 타임라인·요약 표시 | `web/e2e/demo.spec.ts::1틱씩 진행하면 곡선·타임라인·파이프라인 카운터가 늘어난다` | e2e |
| E2E-006 | 웹 데모 | 중복 재전송은 저장 수를 늘리지 않고 중복 차단만 늘린다 | 12틱 후 중복 재전송 | 저장 불변, 중복 차단 12 | `web/e2e/demo.spec.ts::중복 재전송은 저장 수를 늘리지 않고 중복 차단만 늘린다` | e2e |
| E2E-007 | 웹 데모 | 오프라인으로 보관한 묶음을 늦게 보내면 곡선의 빈 구간이 채워지고 순서 역전 반영이 집계된다 | 오프라인 12틱 후 늦게 보내기 | 곡선 점 증가, 순서 역전 반영 > 0 | `web/e2e/demo.spec.ts::오프라인으로 보관한 묶음을 늦게 보내면 곡선의 빈 구간이 채워지고 순서 역전 반영이 집계된다` | e2e |
| E2E-008 | 웹 데모 | 소비자 실패를 주입하면 재시도 끝에 dead-letter 가 쌓이고, 해제 후 재처리하면 요약이 나온다 | 실패 주입 14틱, 해제 후 재처리 | 재시도·dead-letter 증가, 요약 "—" → 값 표시, dead-letter 0 | `web/e2e/demo.spec.ts::소비자 실패를 주입하면 재시도 끝에 dead-letter 가 쌓이고, 해제 후 재처리하면 요약이 나온다` | e2e |
| E2E-009 | 웹 데모 | 병의원 조회는 동의가 있어야 200 이고, 철회하면 바로 404 이며 감사 로그에 남는다 | 조회, 동의 해제 후 조회 | 200 → 404, 감사 로그 2행(거부·허용) | `web/e2e/demo.spec.ts::병의원 조회는 동의가 있어야 200 이고, 철회하면 바로 404 이며 감사 로그에 남는다` | e2e |
| E2E-010 | 웹 데모 | 재생하면 가상 시계가 저절로 흐르고 일시정지하면 멈춘다 | 64× 재생 후 일시정지 | 저장 수가 늘다가 멈춤 | `web/e2e/demo.spec.ts::재생하면 가상 시계가 저절로 흐르고 일시정지하면 멈춘다` | e2e |
| E2E-011 | 웹 데모 | 어두운 화면 전환은 유지되고 모바일 폭에서도 가로로 넘치지 않는다 | 390px 폭, 다크 전환 후 새로고침 | 다크 유지, 가로 넘침 없음 | `web/e2e/demo.spec.ts::어두운 화면 전환은 유지되고 모바일 폭에서도 가로로 넘치지 않는다` | e2e |
