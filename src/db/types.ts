import type { ColumnType, Generated } from 'kysely';

type Ts = ColumnType<Date, Date | string | undefined, Date | string>;
type Day = ColumnType<string, string, string>;

export interface UsersTable {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  target_low: Generated<number>;
  target_high: Generated<number>;
  alert_low: Generated<number>;
  alert_high: Generated<number>;
  created_at: Generated<Date>;
}
export interface ClinicsTable {
  id: string;
  name: string;
  email: string;
  password_hash: string;
}
export interface HealthEventsTable {
  id: Generated<number>;
  user_id: string;
  event_id: string;
  kind: 'glucose' | 'meal' | 'activity';
  measured_at: Ts;
  received_at: Generated<Date>;
  glucose_mgdl: number | null;
  carbs_g: number | null;
  meal_label: string | null;
  activity_type: string | null;
  duration_min: number | null;
}
export interface OutboxTable {
  id: Generated<number>;
  type: string;
  user_id: string;
  payload: ColumnType<unknown, string, string>;
  created_at: Generated<Date>;
  published_at: Date | null;
}
export interface ProcessedMessagesTable {
  consumer: string;
  outbox_id: number;
  processed_at: Generated<Date>;
}
export interface DeadLettersTable {
  id: Generated<number>;
  outbox_id: number;
  queue: string;
  reason: string;
  attempts: number;
  payload: ColumnType<unknown, string, string>;
  failed_at: Generated<Date>;
}
export interface DailySummariesTable {
  user_id: string;
  day: Day;
  readings: number;
  avg_glucose: string | null;
  time_in_range_pct: string | null;
  post_meal_spikes: number;
  meals: number;
  updated_at: Generated<Date>;
}
export interface JourneysTable {
  user_id: string;
  program: string;
  started_on: Day;
  current_week: number;
  completed_at: Date | null;
}
export interface JourneyProgressTable {
  user_id: string;
  week: number;
  mission: string;
  value: number;
  target: number;
  updated_at: Generated<Date>;
}
export interface JourneyTransitionsTable {
  id: Generated<number>;
  user_id: string;
  from_week: number;
  to_week: number | null;
  at: Generated<Date>;
}
export interface AlertsTable {
  id: Generated<number>;
  user_id: string;
  event_id: string;
  kind: 'low' | 'high';
  glucose_mgdl: number;
  threshold: number;
  measured_at: Ts;
  created_at: Generated<Date>;
}
export interface ConsentsTable {
  user_id: string;
  clinic_id: string;
  granted_at: Generated<Date>;
  revoked_at: Date | null;
}
export interface AuditLogsTable {
  id: Generated<number>;
  clinic_id: string;
  user_id: string;
  action: string;
  allowed: boolean;
  request_id: string | null;
  at: Generated<Date>;
}

export interface DB {
  users: UsersTable;
  clinics: ClinicsTable;
  health_events: HealthEventsTable;
  outbox: OutboxTable;
  processed_messages: ProcessedMessagesTable;
  dead_letters: DeadLettersTable;
  daily_summaries: DailySummariesTable;
  journeys: JourneysTable;
  journey_progress: JourneyProgressTable;
  journey_transitions: JourneyTransitionsTable;
  alerts: AlertsTable;
  consents: ConsentsTable;
  audit_logs: AuditLogsTable;
}
