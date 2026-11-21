/** 기동 시 idempotent 하게 적용하는 스키마. 마이그레이션 도구 대신 단일 DDL 로 유지한다(한계 참고). */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS clinics (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  target_low    integer NOT NULL DEFAULT 70,
  target_high   integer NOT NULL DEFAULT 180,
  alert_low     integer NOT NULL DEFAULT 70,
  alert_high    integer NOT NULL DEFAULT 250,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 정규화된 기록. (user_id, event_id) 유니크가 멱등 키다.
CREATE TABLE IF NOT EXISTS health_events (
  id          bigserial PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id),
  event_id    text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('glucose','meal','activity')),
  measured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  glucose_mgdl integer,
  carbs_g     integer,
  meal_label  text,
  activity_type text,
  duration_min integer,
  UNIQUE (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS health_events_timeline ON health_events (user_id, measured_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS outbox (
  id           bigserial PRIMARY KEY,
  type         text NOT NULL,
  user_id      text NOT NULL,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (id) WHERE published_at IS NULL;

-- 소비자가 이미 처리한 메시지. (consumer, outbox_id) 가 키.
CREATE TABLE IF NOT EXISTS processed_messages (
  consumer     text NOT NULL,
  outbox_id    bigint NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, outbox_id)
);

CREATE TABLE IF NOT EXISTS dead_letters (
  id         bigserial PRIMARY KEY,
  outbox_id  bigint NOT NULL,
  queue      text NOT NULL,
  reason     text NOT NULL,
  attempts   integer NOT NULL,
  payload    jsonb NOT NULL,
  failed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_summaries (
  user_id        text NOT NULL REFERENCES users(id),
  day            date NOT NULL,
  readings       integer NOT NULL,
  avg_glucose    numeric(6,1),
  time_in_range_pct numeric(5,1),
  post_meal_spikes integer NOT NULL DEFAULT 0,
  meals          integer NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS journeys (
  user_id      text PRIMARY KEY REFERENCES users(id),
  program      text NOT NULL,
  started_on   date NOT NULL,
  current_week integer NOT NULL DEFAULT 1,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS journey_progress (
  user_id     text NOT NULL REFERENCES users(id),
  week        integer NOT NULL,
  mission     text NOT NULL,
  value       integer NOT NULL,
  target      integer NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week, mission)
);

CREATE TABLE IF NOT EXISTS journey_transitions (
  id         bigserial PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id),
  from_week  integer NOT NULL,
  to_week    integer,
  at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, from_week)
);

CREATE TABLE IF NOT EXISTS alerts (
  id          bigserial PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id),
  event_id    text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('low','high')),
  glucose_mgdl integer NOT NULL,
  threshold   integer NOT NULL,
  measured_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);

CREATE TABLE IF NOT EXISTS consents (
  user_id    text NOT NULL REFERENCES users(id),
  clinic_id  text NOT NULL REFERENCES clinics(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (user_id, clinic_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         bigserial PRIMARY KEY,
  clinic_id  text NOT NULL,
  user_id    text NOT NULL,
  action     text NOT NULL,
  allowed    boolean NOT NULL,
  request_id text,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_user ON audit_logs (user_id, at DESC);
`;
