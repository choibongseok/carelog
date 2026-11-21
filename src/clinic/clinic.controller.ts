import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Kysely } from 'kysely';
import { Auth, AuthInfo, Roles } from '../auth/auth';
import { currentRequestId } from '../common/request-context';
import { KYSELY } from '../db/db.module';
import type { DB } from '../db/types';
import { isDay, utcDay, weekStartMonday } from '../domain/time';
import { SummaryService } from '../query/summary.service';

/**
 * 병의원(B2B) 조회. 사용자가 동의한 환자만 볼 수 있고, 동의 여부는 요청마다 DB 에서 확인한다(캐시 없음 → 철회 즉시 반영).
 * 동의가 없는 경우와 없는 사용자는 같은 404 로 답해 존재 여부를 드러내지 않는다. 모든 시도는 감사 로그에 남긴다.
 */
@ApiTags('clinic')
@ApiBearerAuth()
@Roles('clinic')
@Controller('v1/clinic')
export class ClinicController {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly summaries: SummaryService,
  ) {}

  private async authorize(clinic: AuthInfo, userId: string, action: string): Promise<void> {
    const consent = await this.db
      .selectFrom('consents')
      .select('user_id')
      .where('clinic_id', '=', clinic.sub)
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    const allowed = consent !== undefined;
    // 존재하지 않는 사용자 ID 도 기록해야 하므로 FK 없이 문자열로 남긴다.
    await this.db.insertInto('audit_logs').values({ clinic_id: clinic.sub, user_id: userId, action, allowed, request_id: currentRequestId() ?? null }).execute();
    if (!allowed) throw new NotFoundException('환자를 찾을 수 없다');
  }

  @Get('patients')
  @ApiOperation({ summary: '동의한 환자 목록(ID·표시 이름만)' })
  async patients(@Auth() clinic: AuthInfo) {
    const rows = await this.db
      .selectFrom('consents')
      .innerJoin('users', 'users.id', 'consents.user_id')
      .select(['users.id', 'users.display_name', 'consents.granted_at'])
      .where('consents.clinic_id', '=', clinic.sub)
      .where('consents.revoked_at', 'is', null)
      .orderBy('users.id')
      .execute();
    return rows.map((r) => ({ userId: r.id, displayName: r.display_name, consentedAt: r.granted_at.toISOString() }));
  }

  @Get('patients/:userId/summary/daily')
  @ApiOperation({ summary: '동의한 환자의 일일 요약(감사 기록 남김)' })
  @ApiQuery({ name: 'date', required: false })
  async daily(@Auth() clinic: AuthInfo, @Param('userId') userId: string, @Query('date') date?: string) {
    const day = date ?? utcDay(new Date());
    if (!isDay(day)) throw new BadRequestException('날짜는 YYYY-MM-DD 형식이어야 한다');
    await this.authorize(clinic, userId, 'view_daily_summary');
    return this.summaries.daily(userId, day);
  }

  @Get('patients/:userId/summary/weekly')
  @ApiOperation({ summary: '동의한 환자의 주간 요약(감사 기록 남김)' })
  @ApiQuery({ name: 'date', required: false })
  async weekly(@Auth() clinic: AuthInfo, @Param('userId') userId: string, @Query('date') date?: string) {
    const day = date ?? utcDay(new Date());
    if (!isDay(day)) throw new BadRequestException('날짜는 YYYY-MM-DD 형식이어야 한다');
    await this.authorize(clinic, userId, 'view_weekly_summary');
    return this.summaries.weekly(userId, weekStartMonday(day));
  }
}
