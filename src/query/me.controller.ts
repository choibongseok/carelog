import { BadRequestException, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { Kysely, sql } from 'kysely';
import { Auth, AuthInfo, Roles } from '../auth/auth';
import { KYSELY } from '../db/db.module';
import type { DB } from '../db/types';
import { decodeCursor, encodeCursor } from '../domain/cursor';
import { WEEKS } from '../domain/journey';
import { isDay, utcDay, weekStartMonday } from '../domain/time';
import { SummaryService } from './summary.service';

class ConsentDto {
  @ApiProperty({ example: 'clinic-1' })
  @IsString()
  @MaxLength(64)
  clinicId!: string;
}

function dayParam(v: string | undefined): string {
  const day = v ?? utcDay(new Date());
  if (!isDay(day)) throw new BadRequestException('날짜는 YYYY-MM-DD 형식이어야 한다');
  return day;
}

/** 모든 경로의 사용자는 JWT 의 sub 로만 정해진다. userId 를 입력으로 받지 않으므로 다른 사용자 데이터를 가리킬 방법이 없다. */
@ApiTags('me')
@ApiBearerAuth()
@Roles('user')
@Controller('v1/me')
export class MeController {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly summaries: SummaryService,
  ) {}

  @Get('timeline')
  @ApiOperation({ summary: '내 기록 타임라인(측정 시각 내림차순, 커서 페이지네이션)' })
  @ApiQuery({ name: 'limit', required: false, description: '1~200, 기본 50' })
  @ApiQuery({ name: 'cursor', required: false, description: '이전 응답의 nextCursor' })
  async timeline(@Auth() auth: AuthInfo, @Query('limit') limitRaw?: string, @Query('cursor') cursorRaw?: string) {
    const limit = limitRaw === undefined ? 50 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new BadRequestException('limit 은 1~200 정수');
    let q = this.db
      .selectFrom('health_events')
      .select(['id', 'event_id', 'kind', 'measured_at', 'glucose_mgdl', 'carbs_g', 'meal_label', 'activity_type', 'duration_min'])
      .where('user_id', '=', auth.sub)
      .orderBy('measured_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1);
    if (cursorRaw) {
      const c = decodeCursor(cursorRaw);
      if (!c) throw new BadRequestException('cursor 가 올바르지 않다');
      q = q.where(sql<boolean>`(measured_at, id) < (${new Date(c.at)}, ${c.id})`);
    }
    const rows = await q.execute();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id,
        eventId: r.event_id,
        kind: r.kind,
        measuredAt: r.measured_at.toISOString(),
        mgdl: r.glucose_mgdl ?? undefined,
        carbsG: r.carbs_g ?? undefined,
        label: r.meal_label ?? undefined,
        activityType: r.activity_type ?? undefined,
        durationMin: r.duration_min ?? undefined,
      })),
      nextCursor: rows.length > limit && last ? encodeCursor({ at: last.measured_at.toISOString(), id: last.id }) : null,
    };
  }

  @Get('summary/daily')
  @ApiOperation({ summary: '일일 요약(평균 혈당·목표 범위 비율·식후 급상승)' })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD(UTC), 기본 오늘' })
  daily(@Auth() auth: AuthInfo, @Query('date') date?: string) {
    return this.summaries.daily(auth.sub, dayParam(date));
  }

  @Get('summary/weekly')
  @ApiOperation({ summary: '주간 요약(월요일 시작, 일별 포함)' })
  @ApiQuery({ name: 'date', required: false, description: '주에 속한 임의의 날짜, 기본 오늘' })
  weekly(@Auth() auth: AuthInfo, @Query('date') date?: string) {
    return this.summaries.weekly(auth.sub, weekStartMonday(dayParam(date)));
  }

  @Get('journey')
  @ApiOperation({ summary: '여정(프로그램) 현황: 현재 주차와 미션 진행률' })
  async journey(@Auth() auth: AuthInfo) {
    const j = await this.db.selectFrom('journeys').selectAll().where('user_id', '=', auth.sub).executeTakeFirst();
    if (!j) return { enrolled: false };
    const progress = await this.db.selectFrom('journey_progress').selectAll().where('user_id', '=', auth.sub).orderBy('week').orderBy('mission').execute();
    const transitions = await this.db.selectFrom('journey_transitions').selectAll().where('user_id', '=', auth.sub).orderBy('from_week').execute();
    return {
      enrolled: true,
      program: j.program,
      startedOn: j.started_on,
      currentWeek: j.current_week,
      totalWeeks: WEEKS.length,
      completed: j.completed_at !== null,
      missions: progress.map((p) => ({ week: p.week, mission: p.mission, value: p.value, target: p.target, done: p.value >= p.target })),
      transitions: transitions.map((t) => ({ from: t.from_week, to: t.to_week, at: t.at.toISOString() })),
    };
  }

  @Get('alerts')
  @ApiOperation({ summary: '저혈당·고혈당 알림 목록(발송 대신 저장)' })
  async alerts(@Auth() auth: AuthInfo) {
    const rows = await this.db.selectFrom('alerts').selectAll().where('user_id', '=', auth.sub).orderBy('measured_at', 'desc').limit(100).execute();
    return rows.map((a) => ({ kind: a.kind, mgdl: a.glucose_mgdl, threshold: a.threshold, measuredAt: a.measured_at.toISOString(), eventId: a.event_id }));
  }

  @Get('consents')
  @ApiOperation({ summary: '병의원별 동의 현황' })
  async consents(@Auth() auth: AuthInfo) {
    const rows = await this.db
      .selectFrom('consents')
      .innerJoin('clinics', 'clinics.id', 'consents.clinic_id')
      .select(['consents.clinic_id', 'clinics.name', 'consents.granted_at', 'consents.revoked_at'])
      .where('consents.user_id', '=', auth.sub)
      .execute();
    return rows.map((c) => ({ clinicId: c.clinic_id, name: c.name, grantedAt: c.granted_at.toISOString(), active: c.revoked_at === null, revokedAt: c.revoked_at?.toISOString() ?? null }));
  }

  @Post('consents')
  @HttpCode(200)
  @ApiOperation({ summary: '병의원에 요약 열람 동의' })
  async grant(@Auth() auth: AuthInfo, @Body() dto: ConsentDto) {
    const clinic = await this.db.selectFrom('clinics').select('id').where('id', '=', dto.clinicId).executeTakeFirst();
    if (!clinic) throw new NotFoundException('병의원을 찾을 수 없다');
    await this.db
      .insertInto('consents')
      .values({ user_id: auth.sub, clinic_id: dto.clinicId })
      .onConflict((oc) => oc.columns(['user_id', 'clinic_id']).doUpdateSet({ granted_at: sql`now()`, revoked_at: null }))
      .execute();
    return { clinicId: dto.clinicId, active: true };
  }

  @Delete('consents/:clinicId')
  @ApiOperation({ summary: '동의 철회. 이후 병의원 요청은 즉시 막힌다' })
  async revoke(@Auth() auth: AuthInfo, @Param('clinicId') clinicId: string) {
    const res = await this.db
      .updateTable('consents')
      .set({ revoked_at: sql`now()` })
      .where('user_id', '=', auth.sub)
      .where('clinic_id', '=', clinicId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) === 0) throw new NotFoundException('활성 동의가 없다');
    return { clinicId, active: false };
  }

  @Get('access-log')
  @ApiOperation({ summary: '내 데이터를 병의원이 조회한 감사 기록(거부된 시도 포함)' })
  async accessLog(@Auth() auth: AuthInfo) {
    const rows = await this.db.selectFrom('audit_logs').selectAll().where('user_id', '=', auth.sub).orderBy('id', 'desc').limit(100).execute();
    return rows.map((a) => ({ clinicId: a.clinic_id, action: a.action, allowed: a.allowed, at: a.at.toISOString() }));
  }
}
